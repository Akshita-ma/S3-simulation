import io
import os
import hashlib
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from models import Bucket, S3Object
from main import app
from routers.objects import get_blobs_storage_dir

TEST_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session():
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def stage5_buckets(client):
    client.post("/api/buckets", json={"name": "dedup-vault-alpha", "region": "us-east-1"})
    client.post("/api/buckets", json={"name": "dedup-vault-beta", "region": "us-west-2"})
    return ["dedup-vault-alpha", "dedup-vault-beta"]


def test_content_addressable_deduplication(client, stage5_buckets):
    payload = b"Exact identical binary dataset payload repeated across multiple files."
    expected_hash = hashlib.sha256(payload).hexdigest()
    blobs_dir = get_blobs_storage_dir()
    expected_blob_path = os.path.join(blobs_dir, expected_hash)

    # 1. Upload to bucket alpha
    file1 = {"file": ("dataset_v1.bin", io.BytesIO(payload), "application/octet-stream")}
    res1 = client.post("/api/buckets/dedup-vault-alpha/objects", files=file1)
    assert res1.status_code == 201
    assert res1.json()["content_hash"] == expected_hash

    # Blob must exist on disk
    assert os.path.exists(expected_blob_path)
    initial_mtime = os.path.getmtime(expected_blob_path)

    # 2. Upload identical content to bucket beta
    file2 = {"file": ("copy_of_dataset.bin", io.BytesIO(payload), "application/octet-stream")}
    res2 = client.post("/api/buckets/dedup-vault-beta/objects", files=file2)
    assert res2.status_code == 201
    assert res2.json()["content_hash"] == expected_hash

    # Still only ONE blob file on disk
    assert os.path.exists(expected_blob_path)

    # 3. Check stats endpoint reflects deduplication savings
    res_stats = client.get("/api/stats")
    assert res_stats.status_code == 200
    stats = res_stats.json()
    assert stats["logical_size_bytes"] >= len(payload) * 2
    assert stats["saved_space_bytes"] >= len(payload)
    assert stats["unique_blobs"] >= 1


def test_reference_counted_deletion(client, stage5_buckets):
    payload = b"Unique reference counting verification file."
    expected_hash = hashlib.sha256(payload).hexdigest()
    blobs_dir = get_blobs_storage_dir()
    expected_blob_path = os.path.join(blobs_dir, expected_hash)

    # Upload two objects pointing to same blob
    f1 = {"file": ("ref1.dat", io.BytesIO(payload), "application/octet-stream")}
    f2 = {"file": ("ref2.dat", io.BytesIO(payload), "application/octet-stream")}
    client.post("/api/buckets/dedup-vault-alpha/objects", files=f1)
    client.post("/api/buckets/dedup-vault-alpha/objects", files=f2)

    assert os.path.exists(expected_blob_path)

    # Delete first object
    res_del1 = client.delete("/api/buckets/dedup-vault-alpha/objects/ref1.dat")
    assert res_del1.status_code == 204

    # Physical blob MUST STILL EXIST because ref2.dat references it
    assert os.path.exists(expected_blob_path)

    # Delete second object
    res_del2 = client.delete("/api/buckets/dedup-vault-alpha/objects/ref2.dat")
    assert res_del2.status_code == 204

    # Physical blob MUST BE DELETED because ref count reached 0
    assert not os.path.exists(expected_blob_path)


def test_client_side_encryption_flag(client, stage5_buckets):
    content = b"AES-GCM-256 encrypted ciphertext representation"
    f = {"file": ("secret.enc", io.BytesIO(content), "application/octet-stream")}
    res = client.post(
        "/api/buckets/dedup-vault-alpha/objects",
        files=f,
        data={"is_encrypted": "true"}
    )
    assert res.status_code == 201
    assert res.json()["is_encrypted"] is True

    # Verify flag appears in list
    res_list = client.get("/api/buckets/dedup-vault-alpha/objects")
    assert res_list.status_code == 200
    target = next(o for o in res_list.json() if o["key"] == "secret.enc")
    assert target["is_encrypted"] is True

    # Verify stats reflects encrypted count
    res_stats = client.get("/api/stats")
    assert res_stats.json()["encrypted_objects_count"] >= 1
