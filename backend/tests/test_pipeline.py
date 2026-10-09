import os
import io
import json
import shutil
from PIL import Image
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

try:
    from database import Base, get_db
    from main import app
    import models
    from routers.pipeline import process_s3_event
    import routers.pipeline as pipeline_mod
except ImportError:
    from backend.database import Base, get_db
    from backend.main import app
    import backend.models as models
    from backend.routers.pipeline import process_s3_event
    import backend.routers.pipeline as pipeline_mod

# Shared in-memory database with StaticPool so BackgroundTasks thread shares the same DB
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session", autouse=True)
def init_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def setup_storage(monkeypatch):
    test_storage = "./test_pipeline_storage"
    monkeypatch.setenv("STORAGE_DIR", test_storage)
    monkeypatch.setattr(pipeline_mod, "SessionLocal", TestingSessionLocal)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    if os.path.exists(test_storage):
        shutil.rmtree(test_storage, ignore_errors=True)


client = TestClient(app)


def test_image_thumbnail_pipeline():
    """Test that uploading an image triggers Lambda thumbnail generation and CloudWatch logging."""
    bucket_name = "test-lambda-images"
    create_res = client.post("/api/buckets", json={"name": bucket_name, "region": "us-east-1"})
    assert create_res.status_code == 201

    # Create dummy PNG image (400x300)
    img_buf = io.BytesIO()
    img = Image.new("RGB", (400, 300), color="blue")
    img.save(img_buf, format="PNG")
    img_bytes = img_buf.getvalue()

    # Upload via POST endpoint (BackgroundTasks will run)
    upload_res = client.post(
        f"/api/buckets/{bucket_name}/objects",
        files={"file": ("photo.png", img_bytes, "image/png")},
    )
    assert upload_res.status_code == 201

    # Verify thumbnail object exists
    list_res = client.get(f"/api/buckets/{bucket_name}/objects")
    assert list_res.status_code == 200
    objs = list_res.json()
    keys = [o["key"] for o in objs]
    assert "photo.png" in keys
    assert "thumb_photo.png" in keys

    # Verify thumbnail dimensions
    thumb_obj = next(o for o in objs if o["key"] == "thumb_photo.png")
    thumb_dl = client.get(f"/api/buckets/{bucket_name}/objects/{thumb_obj['key']}")
    assert thumb_dl.status_code == 200
    with Image.open(io.BytesIO(thumb_dl.content)) as thumb_img:
        w, h = thumb_img.size
        assert w <= 200 and h <= 200

    # Verify CloudWatch Execution Log
    logs_res = client.get(f"/api/buckets/{bucket_name}/logs")
    assert logs_res.status_code == 200
    logs = logs_res.json()
    assert len(logs) >= 1
    latest_log = logs[0]
    assert latest_log["event_type"] == "s3:ObjectCreated:Put"
    assert latest_log["status"] == "SUCCESS"
    assert latest_log["key"] == "photo.png"
    assert "START RequestId:" in latest_log["message"]
    assert "REPORT RequestId:" in latest_log["message"]
    assert "Generated compressed 200x200 thumbnail" in latest_log["message"]


def test_csv_parsing_pipeline():
    """Test that uploading a CSV generates companion parsed_<key>.json with parsed rows."""
    bucket_name = "test-lambda-csv"
    client.post("/api/buckets", json={"name": bucket_name, "region": "us-east-1"})

    csv_content = "id,name,role\n1,Alice,Engineer\n2,Bob,Designer\n3,Charlie,Product\n"
    upload_res = client.post(
        f"/api/buckets/{bucket_name}/objects",
        files={"file": ("users.csv", csv_content.encode("utf-8"), "text/csv")},
    )
    assert upload_res.status_code == 201

    list_res = client.get(f"/api/buckets/{bucket_name}/objects")
    objs = list_res.json()
    keys = [o["key"] for o in objs]
    assert "users.csv" in keys
    assert "parsed_users.csv.json" in keys

    # Verify companion parsed JSON content
    json_dl = client.get(f"/api/buckets/{bucket_name}/objects/parsed_users.csv.json")
    assert json_dl.status_code == 200
    parsed_data = json_dl.json()
    assert parsed_data["parsed_rows_count"] == 3
    assert parsed_data["preview_rows"][0]["name"] == "Alice"

    # Verify CloudWatch log
    logs_res = client.get(f"/api/buckets/{bucket_name}/logs")
    assert logs_res.status_code == 200
    logs = logs_res.json()
    assert len(logs) >= 1
    assert "Parsed 3 CSV rows into JSON companion" in logs[0]["message"]


def test_plaintext_metrics_pipeline():
    """Test that uploading a plaintext file calculates line count and word count in logs."""
    bucket_name = "test-lambda-text"
    client.post("/api/buckets", json={"name": bucket_name, "region": "us-east-1"})

    text_data = "Hello world!\nThis is a sample text file.\nLine three."
    upload_res = client.post(
        f"/api/buckets/{bucket_name}/objects",
        files={"file": ("notes.txt", text_data.encode("utf-8"), "text/plain")},
    )
    assert upload_res.status_code == 201

    logs_res = client.get(f"/api/buckets/{bucket_name}/logs")
    assert logs_res.status_code == 200
    logs = logs_res.json()
    assert len(logs) >= 1
    assert "Text analysis complete: 3 lines" in logs[0]["message"]
    assert "10 words" in logs[0]["message"]


def test_logs_endpoint_404():
    """Test that GET /api/buckets/{bucket_name}/logs returns 404 for missing bucket."""
    res = client.get("/api/buckets/nonexistent-bucket-xyz/logs")
    assert res.status_code == 404
