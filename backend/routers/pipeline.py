import os
import io
import csv
import json
import time
import uuid
import hashlib
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from PIL import Image

try:
    from database import SessionLocal, get_db
    import models
    import schemas
except ImportError:
    from backend.database import SessionLocal, get_db
    import backend.models as models
    import backend.schemas as schemas

router = APIRouter(tags=["Lambda & CloudWatch Pipeline"])


def get_blobs_storage_dir() -> str:
    """Returns absolute path to the content-addressable blobs directory."""
    storage_root = os.path.abspath(os.getenv("STORAGE_DIR", "./storage"))
    blobs_dir = os.path.join(storage_root, "blobs")
    os.makedirs(blobs_dir, exist_ok=True)
    return blobs_dir


def _save_derived_object(
    db: Session,
    bucket: models.Bucket,
    derived_key: str,
    data: bytes,
    mime_type: str
) -> models.S3Object:
    """
    Saves a derived object (thumbnail or parsed JSON) directly to content-addressed storage
    and creates or updates its record in the database.
    """
    blobs_dir = get_blobs_storage_dir()
    content_hash = hashlib.sha256(data).hexdigest()
    blob_target_path = os.path.join(blobs_dir, content_hash)

    if not os.path.exists(blob_target_path):
        with open(blob_target_path, "wb") as f:
            f.write(data)

    existing_obj = (
        db.query(models.S3Object)
        .filter(models.S3Object.bucket_id == bucket.id, models.S3Object.key == derived_key)
        .first()
    )

    if existing_obj:
        existing_obj.size_bytes = len(data)
        existing_obj.mime_type = mime_type
        existing_obj.content_hash = content_hash
        existing_obj.storage_path = blob_target_path
        existing_obj.is_encrypted = False
        existing_obj.created_at = datetime.now(timezone.utc)
        s3_obj = existing_obj
    else:
        s3_obj = models.S3Object(
            bucket_id=bucket.id,
            key=derived_key,
            size_bytes=len(data),
            mime_type=mime_type,
            content_hash=content_hash,
            storage_path=blob_target_path,
            is_encrypted=False,
        )
        db.add(s3_obj)

    db.commit()
    db.refresh(s3_obj)
    return s3_obj


def process_s3_event(bucket_name: str, key: str) -> None:
    """
    Simulated AWS Lambda handler invoked asynchronously by FastAPI BackgroundTasks
    on every s3:ObjectCreated:Put event.

    Processing Rules:
    1. Image (image/png, image/jpeg): Generate compressed 200x200 thumbnail -> thumb_<key>
    2. CSV (text/csv): Parse first 50 rows into JSON -> parsed_<key>.json
    3. Plaintext (text/plain, text/markdown): Calculate word count and line count.
    4. Execution Log: Store detailed CloudWatch log stream with START/REPORT metrics in DB.
    """
    # Prevent infinite recursive triggers on internally generated companion objects
    if key.startswith("thumb_") or key.startswith("parsed_"):
        return

    start_wall_time = time.time()
    request_id = str(uuid.uuid4())
    now_utc = datetime.now(timezone.utc)
    ts_str = now_utc.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    log_lines: List[str] = [
        f"START RequestId: {request_id} Version: $LATEST",
        f"{ts_str} {request_id} INFO Received event: s3:ObjectCreated:Put on bucket '{bucket_name}', object key '{key}'",
    ]

    status_result = "SUCCESS"
    db = SessionLocal()

    try:
        bucket = db.query(models.Bucket).filter(models.Bucket.name == bucket_name).first()
        if not bucket:
            raise ValueError(f"Bucket '{bucket_name}' not found during Lambda invocation.")

        s3_obj = (
            db.query(models.S3Object)
            .filter(models.S3Object.bucket_id == bucket.id, models.S3Object.key == key)
            .first()
        )
        if not s3_obj:
            raise ValueError(f"Object '{key}' not found in bucket '{bucket_name}'.")

        cur_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

        if s3_obj.is_encrypted:
            log_lines.append(
                f"{cur_ts} {request_id} INFO Object is client-side encrypted (Zero-Knowledge AES-GCM). "
                f"Skipping automated payload parsing to preserve confidentiality."
            )
        else:
            mime_lower = (s3_obj.mime_type or "").lower()
            key_lower = key.lower()

            is_image = (
                mime_lower in ("image/png", "image/jpeg", "image/jpg", "image/webp")
                or key_lower.endswith((".png", ".jpg", ".jpeg", ".webp"))
            )
            is_csv = (
                mime_lower in ("text/csv", "application/csv")
                or key_lower.endswith(".csv")
            )
            is_text = (
                mime_lower in ("text/plain", "text/markdown", "text/x-markdown")
                or key_lower.endswith((".txt", ".md", ".markdown", ".log"))
            )

            if is_image:
                log_lines.append(f"{cur_ts} {request_id} INFO Trigger matched Image handler. Loading image bytes...")
                with Image.open(s3_obj.storage_path) as img:
                    img_thumb = img.copy()
                    img_thumb.thumbnail((200, 200), Image.Resampling.LANCZOS)

                    orig_format = (img.format or "").upper()
                    out_format = "PNG" if (orig_format == "PNG" or img_thumb.mode in ("RGBA", "LA", "P")) else "JPEG"

                    if out_format == "JPEG" and img_thumb.mode != "RGB":
                        img_thumb = img_thumb.convert("RGB")

                    buf = io.BytesIO()
                    if out_format == "JPEG":
                        img_thumb.save(buf, format="JPEG", quality=85, optimize=True)
                        thumb_mime = "image/jpeg"
                    else:
                        img_thumb.save(buf, format="PNG", optimize=True)
                        thumb_mime = "image/png"

                    thumb_bytes = buf.getvalue()

                thumb_key = f"thumb_{key}"
                _save_derived_object(db, bucket, thumb_key, thumb_bytes, thumb_mime)

                cur_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
                log_lines.append(
                    f"{cur_ts} {request_id} INFO Generated compressed 200x200 thumbnail: '{thumb_key}' "
                    f"({len(thumb_bytes)} bytes, format: {out_format}). Saved to bucket '{bucket_name}'."
                )

            elif is_csv:
                log_lines.append(f"{cur_ts} {request_id} INFO Trigger matched CSV parser handler. Parsing rows...")
                rows = []
                fieldnames = []
                with open(s3_obj.storage_path, "r", encoding="utf-8", errors="replace") as f:
                    reader = csv.DictReader(f)
                    fieldnames = reader.fieldnames or []
                    for idx, row in enumerate(reader):
                        if idx >= 50:
                            break
                        rows.append(row)

                parsed_doc = {
                    "source_key": key,
                    "bucket_name": bucket_name,
                    "parsed_rows_count": len(rows),
                    "total_columns": len(fieldnames),
                    "fields": fieldnames,
                    "preview_rows": rows,
                    "parsed_at": datetime.now(timezone.utc).isoformat(),
                }
                json_bytes = json.dumps(parsed_doc, indent=2).encode("utf-8")
                parsed_key = f"parsed_{key}.json"
                _save_derived_object(db, bucket, parsed_key, json_bytes, "application/json")

                cur_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
                log_lines.append(
                    f"{cur_ts} {request_id} INFO Parsed {len(rows)} CSV rows into JSON companion: '{parsed_key}' "
                    f"({len(json_bytes)} bytes). Saved to bucket '{bucket_name}'."
                )

            elif is_text:
                log_lines.append(f"{cur_ts} {request_id} INFO Trigger matched Plaintext metrics handler.")
                with open(s3_obj.storage_path, "r", encoding="utf-8", errors="replace") as f:
                    text_content = f.read()

                lines = text_content.splitlines()
                words = text_content.split()
                line_count = len(lines)
                word_count = len(words)
                char_count = len(text_content)

                cur_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
                log_lines.append(
                    f"{cur_ts} {request_id} INFO Text analysis complete: {line_count} lines, "
                    f"{word_count} words, {char_count} characters across {s3_obj.size_bytes} bytes."
                )

            else:
                log_lines.append(
                    f"{cur_ts} {request_id} INFO Binary object ({s3_obj.mime_type}, {s3_obj.size_bytes} bytes) "
                    f"processed successfully. No custom handler configured."
                )

    except Exception as exc:
        status_result = "FAILED"
        err_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        log_lines.append(f"{err_ts} {request_id} ERROR Lambda handler failed: {str(exc)}")

    finally:
        duration_ms = max(1, int((time.time() - start_wall_time) * 1000))
        billed_duration = ((duration_ms + 99) // 100) * 100 if duration_ms > 0 else 100

        log_lines.append(f"END RequestId: {request_id}")
        log_lines.append(
            f"REPORT RequestId: {request_id}\tDuration: {duration_ms}.00 ms\t"
            f"Billed Duration: {billed_duration} ms\tMemory Size: 128 MB\tMax Memory Used: 64 MB"
        )

        full_message = "\n".join(log_lines)

        try:
            exec_log = models.ExecutionLog(
                event_type="s3:ObjectCreated:Put",
                bucket_name=bucket_name,
                key=key,
                status=status_result,
                duration_ms=duration_ms,
                message=full_message,
            )
            db.add(exec_log)
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()


@router.get(
    "/buckets/{bucket_name}/logs",
    response_model=List[schemas.ExecutionLogResponse],
    summary="Get recent CloudWatch execution logs for a bucket",
)
def get_bucket_execution_logs(
    bucket_name: str,
    limit: int = Query(50, ge=1, le=200, description="Maximum number of logs to return"),
    db: Session = Depends(get_db),
) -> List[schemas.ExecutionLogResponse]:
    """
    Returns recent simulated CloudWatch execution logs for AWS Lambda functions
    triggered by S3 events in the specified bucket.
    """
    bucket = db.query(models.Bucket).filter(models.Bucket.name == bucket_name).first()
    if not bucket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bucket '{bucket_name}' not found.",
        )

    logs = (
        db.query(models.ExecutionLog)
        .filter(models.ExecutionLog.bucket_name == bucket_name)
        .order_by(models.ExecutionLog.timestamp.desc(), models.ExecutionLog.id.desc())
        .limit(limit)
        .all()
    )

    return logs


@router.delete(
    "/buckets/{bucket_name}/logs",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Clear execution logs for a bucket",
)
def clear_bucket_execution_logs(
    bucket_name: str,
    db: Session = Depends(get_db),
) -> Response:
    """
    Clears all execution logs recorded for the specified bucket.
    """
    bucket = db.query(models.Bucket).filter(models.Bucket.name == bucket_name).first()
    if not bucket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bucket '{bucket_name}' not found.",
        )

    db.query(models.ExecutionLog).filter(models.ExecutionLog.bucket_name == bucket_name).delete()
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
