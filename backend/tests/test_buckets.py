import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from models import Bucket, S3Object
from main import app

# In-memory SQLite for testing
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


def test_create_bucket_success(client):
    res = client.post("/api/buckets", json={"name": "valid-bucket-123", "region": "us-east-1"})
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "valid-bucket-123"
    assert data["region"] == "us-east-1"
    assert data["object_count"] == 0
    assert data["total_size_bytes"] == 0
    assert "id" in data
    assert "created_at" in data


def test_create_bucket_default_region(client):
    res = client.post("/api/buckets", json={"name": "default-region-bucket"})
    assert res.status_code == 201
    data = res.json()
    assert data["region"] == "us-east-1"


@pytest.mark.parametrize(
    "invalid_name",
    [
        "ab",  # Too short (< 3)
        "a" * 64,  # Too long (> 63)
        "Invalid-Uppercase",  # Contains uppercase
        "-leading-hyphen",  # Starts with hyphen
        "trailing-hyphen-",  # Ends with hyphen
        "has_underscore",  # Invalid char
        "has.period",  # Invalid char
        "spaces not allowed",  # Spaces
    ]
)
def test_create_bucket_invalid_names(client, invalid_name):
    res = client.post("/api/buckets", json={"name": invalid_name})
    assert res.status_code == 400


def test_create_bucket_conflict(client):
    client.post("/api/buckets", json={"name": "duplicate-bucket"})
    res2 = client.post("/api/buckets", json={"name": "duplicate-bucket"})
    assert res2.status_code == 409
    assert "already exists" in res2.json()["detail"]


def test_get_buckets_list(client, db_session):
    # Create bucket and an object in it
    bucket = Bucket(name="metrics-bucket", region="eu-west-1")
    db_session.add(bucket)
    db_session.commit()
    db_session.refresh(bucket)

    s3_obj = S3Object(
        bucket_id=bucket.id,
        key="data/report.csv",
        size_bytes=4096,
        mime_type="text/csv",
        content_hash="mocksha256hash",
        storage_path="storage/metrics-bucket/data/report.csv",
        is_encrypted=False,
    )
    db_session.add(s3_obj)
    db_session.commit()

    res = client.get("/api/buckets")
    assert res.status_code == 200
    buckets = res.json()
    target = next((b for b in buckets if b["name"] == "metrics-bucket"), None)
    assert target is not None
    assert target["object_count"] == 1
    assert target["total_size_bytes"] == 4096


def test_delete_bucket_not_found(client):
    res = client.delete("/api/buckets/non-existent-bucket")
    assert res.status_code == 404


def test_delete_bucket_not_empty_error(client, db_session):
    bucket = Bucket(name="non-empty-bucket", region="us-east-1")
    db_session.add(bucket)
    db_session.commit()
    db_session.refresh(bucket)

    s3_obj = S3Object(
        bucket_id=bucket.id,
        key="test.txt",
        size_bytes=100,
        mime_type="text/plain",
        content_hash="mockhash",
        storage_path="storage/non-empty-bucket/test.txt",
        is_encrypted=False,
    )
    db_session.add(s3_obj)
    db_session.commit()

    res = client.delete("/api/buckets/non-empty-bucket")
    assert res.status_code == 400
    assert res.json()["detail"] == "Bucket is not empty"


def test_delete_empty_bucket_success(client):
    # Create empty bucket
    res_create = client.post("/api/buckets", json={"name": "to-delete-bucket"})
    assert res_create.status_code == 201

    # Delete bucket
    res_del = client.delete("/api/buckets/to-delete-bucket")
    assert res_del.status_code == 204

    # Verify bucket is gone
    res_list = client.get("/api/buckets")
    bucket_names = [b["name"] for b in res_list.json()]
    assert "to-delete-bucket" not in bucket_names
