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
def test_bucket(client, db_session):
    # Ensure test bucket exists in DB
    b = Bucket(name="object-test-vault", region="us-east-1")
    db_session.add(b)
    db_session.commit()
    db_session.refresh(b)
    return b


def test_upload_object_success(client, test_bucket):
    content = b"Hello Smart Vault! S3 simulation binary content."
    expected_hash = hashlib.sha256(content).hexdigest()

    file_payload = {"file": ("sample.txt", io.BytesIO(content), "text/plain")}
    res = client.post(
        f"/api/buckets/{test_bucket.name}/objects",
        files=file_payload,
        data={"key": "docs/sample.txt"}
    )
    assert res.status_code == 201
    data = res.json()
    assert data["key"] == "docs/sample.txt"
    assert data["size_bytes"] == len(content)
    assert data["content_hash"] == expected_hash
    assert data["mime_type"] == "text/plain"


def test_upload_object_nonexistent_bucket(client):
    file_payload = {"file": ("sample.txt", io.BytesIO(b"content"), "text/plain")}
    res = client.post(
        "/api/buckets/ghost-bucket-999/objects",
        files=file_payload
    )
    assert res.status_code == 404


def test_upload_path_traversal_prevention(client, test_bucket):
    file_payload = {"file": ("malicious.txt", io.BytesIO(b"bad content"), "text/plain")}
    res = client.post(
        f"/api/buckets/{test_bucket.name}/objects",
        files=file_payload,
        data={"key": "../../outside.txt"}
    )
    assert res.status_code == 400


def test_list_objects(client, test_bucket):
    # Upload an object
    content = b"List objects verification"
    file_payload = {"file": ("list_test.json", io.BytesIO(content), "application/json")}
    res_upload = client.post(
        f"/api/buckets/{test_bucket.name}/objects",
        files=file_payload
    )
    assert res_upload.status_code == 201

    # List objects
    res_list = client.get(f"/api/buckets/{test_bucket.name}/objects")
    assert res_list.status_code == 200
    items = res_list.json()
    assert any(item["key"] == "list_test.json" for item in items)


def test_get_object_stream_inline(client, test_bucket):
    content = b"Inline preview stream content for Smart Vault"
    file_payload = {"file": ("preview.txt", io.BytesIO(content), "text/plain")}
    client.post(f"/api/buckets/{test_bucket.name}/objects", files=file_payload)

    res = client.get(f"/api/buckets/{test_bucket.name}/objects/preview.txt")
    assert res.status_code == 200
    assert res.content == content
    assert "text/plain" in res.headers["content-type"]
    assert "inline" in res.headers.get("content-disposition", "")


def test_delete_object_and_update_metrics(client, test_bucket):
    content = b"File to be deleted"
    file_payload = {"file": ("delete_me.bin", io.BytesIO(content), "application/octet-stream")}
    res_up = client.post(f"/api/buckets/{test_bucket.name}/objects", files=file_payload)
    assert res_up.status_code == 201

    # Check metrics before delete
    res_bucket_before = client.get("/api/buckets")
    b_before = next(b for b in res_bucket_before.json() if b["name"] == test_bucket.name)
    assert b_before["object_count"] >= 1

    # Delete object
    res_del = client.delete(f"/api/buckets/{test_bucket.name}/objects/delete_me.bin")
    assert res_del.status_code == 204

    # Verify object is gone
    res_get = client.get(f"/api/buckets/{test_bucket.name}/objects/delete_me.bin")
    assert res_get.status_code == 404
