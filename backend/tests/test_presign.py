import io
import time
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from models import Bucket, S3Object
from main import app
from routers.presign import generate_presigned_token

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
def test_setup(client):
    # Create bucket
    client.post("/api/buckets", json={"name": "presign-test-vault", "region": "us-east-1"})

    # Upload test object
    content = b"Confidential document for presigned sharing test."
    file_payload = {"file": ("report.pdf", io.BytesIO(content), "application/pdf")}
    client.post(
        "/api/buckets/presign-test-vault/objects",
        files=file_payload,
        data={"key": "docs/report.pdf"}
    )
    return {"bucket": "presign-test-vault", "key": "docs/report.pdf", "content": content}


def test_create_presigned_url_default(client, test_setup):
    bucket = test_setup["bucket"]
    key = test_setup["key"]

    res = client.post(f"/api/buckets/{bucket}/objects/{key}/presign")
    assert res.status_code == 200
    data = res.json()
    assert "presigned_url" in data
    assert data["presigned_url"].startswith("/api/shared/download?token=")
    assert data["expires_in"] == 300
    assert "expires_at" in data


def test_create_presigned_url_custom_body_and_query(client, test_setup):
    bucket = test_setup["bucket"]
    key = test_setup["key"]

    # Test via JSON body
    res_body = client.post(
        f"/api/buckets/{bucket}/objects/{key}/presign",
        json={"expires_in": 60}
    )
    assert res_body.status_code == 200
    assert res_body.json()["expires_in"] == 60

    # Test via query param
    res_query = client.post(
        f"/api/buckets/{bucket}/objects/{key}/presign?expires_in=3600"
    )
    assert res_query.status_code == 200
    assert res_query.json()["expires_in"] == 3600


def test_create_presigned_url_nonexistent(client):
    res_b = client.post("/api/buckets/ghost-vault/objects/test.txt/presign")
    assert res_b.status_code == 404

    client.post("/api/buckets", json={"name": "empty-vault", "region": "us-east-1"})
    res_o = client.post("/api/buckets/empty-vault/objects/ghost.txt/presign")
    assert res_o.status_code == 404


def test_download_presigned_url_success(client, test_setup):
    bucket = test_setup["bucket"]
    key = test_setup["key"]

    res_presign = client.post(f"/api/buckets/{bucket}/objects/{key}/presign?expires_in=100")
    presigned_url = res_presign.json()["presigned_url"]

    # Perform download
    res_download = client.get(presigned_url)
    assert res_download.status_code == 200
    assert res_download.content == test_setup["content"]
    assert "attachment" in res_download.headers.get("content-disposition", "")
    assert "report.pdf" in res_download.headers.get("content-disposition", "")
    assert res_download.headers.get("content-type") == "application/pdf"


def test_download_invalid_token(client):
    res = client.get("/api/shared/download?token=completely-invalid-token")
    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid token or signature."

    res_fake_sig = client.get("/api/shared/download?token=eyJmb28iOiJiYXIifQ.fake-signature")
    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid token or signature."


def test_download_expired_token(client, test_setup):
    bucket = test_setup["bucket"]
    key = test_setup["key"]

    # Generate an expired token (10 seconds in the past)
    expired_ts = int(datetime.now(timezone.utc).timestamp()) - 10
    expired_token = generate_presigned_token(bucket, key, expired_ts)

    res = client.get(f"/api/shared/download?token={expired_token}")
    assert res.status_code == 403
    assert res.json()["detail"] == "The pre-signed URL has expired."
