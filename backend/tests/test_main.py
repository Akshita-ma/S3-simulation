import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from models import Bucket, S3Object
from main import app

# Test SQLite in-memory database
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


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "Smart Vault API"
    assert data["database"] == "connected"


def test_models_bucket_and_object(db_session):
    # Test Bucket creation
    bucket = Bucket(name="prod-assets", region="us-west-2")
    db_session.add(bucket)
    db_session.commit()
    db_session.refresh(bucket)

    assert bucket.id is not None
    assert bucket.name == "prod-assets"
    assert bucket.region == "us-west-2"
    assert bucket.created_at is not None

    # Test S3Object creation
    s3_obj = S3Object(
        bucket_id=bucket.id,
        key="images/logo.png",
        size_bytes=2048,
        mime_type="image/png",
        content_hash="b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        storage_path="storage/prod-assets/images/logo.png",
        is_encrypted=False,
    )
    db_session.add(s3_obj)
    db_session.commit()
    db_session.refresh(s3_obj)

    assert s3_obj.id is not None
    assert s3_obj.bucket_id == bucket.id
    assert s3_obj.bucket.name == "prod-assets"
    assert len(bucket.objects) == 1
    assert bucket.objects[0].key == "images/logo.png"
