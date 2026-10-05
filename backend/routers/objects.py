import os
import hashlib
import mimetypes
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

try:
    from database import get_db
    import models
    from schemas import S3ObjectResponse
except ImportError:
    from backend.database import get_db
    import backend.models as models
    from backend.schemas import S3ObjectResponse

router = APIRouter(prefix="/buckets/{bucket_name}/objects", tags=["Objects"])


def get_bucket_storage_dir(bucket_name: str) -> str:
    """Returns absolute path to the bucket's storage directory."""
    storage_root = os.path.abspath(os.getenv("STORAGE_DIR", "./storage"))
    bucket_dir = os.path.join(storage_root, bucket_name)
    os.makedirs(bucket_dir, exist_ok=True)
    return bucket_dir


def resolve_object_path(bucket_name: str, key: str) -> str:
    """
    Safely resolves object key to a physical storage path,
    preventing path traversal attacks.
    """
    bucket_dir = get_bucket_storage_dir(bucket_name)
    sanitized_key = key.lstrip("/")
    target_path = os.path.abspath(os.path.join(bucket_dir, sanitized_key))

    # Path traversal validation
    if not target_path.startswith(bucket_dir):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid object key path (path traversal detected)."
        )
    return target_path


@router.post(
    "",
    response_model=S3ObjectResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an object to bucket"
)
async def upload_object(
    bucket_name: str,
    file: UploadFile = File(..., description="Binary file upload"),
    key: Optional[str] = Form(None, description="Optional custom object key/path"),
    db: Session = Depends(get_db)
) -> S3ObjectResponse:
    """
    Uploads a file to the specified bucket via multipart/form-data.
    Computes SHA-256 hash, detects MIME type, saves physical file, and creates/updates DB record.
    """
    # 1. Verify bucket exists
    bucket = db.query(models.Bucket).filter(models.Bucket.name == bucket_name).first()
    if not bucket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bucket '{bucket_name}' not found."
        )

    # 2. Determine and sanitize object key
    raw_key = key.strip() if key and key.strip() else file.filename
    if not raw_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Object key or filename must be provided."
        )
    object_key = raw_key.lstrip("/")

    # 3. Resolve target storage path
    target_path = resolve_object_path(bucket_name, object_key)
    os.makedirs(os.path.dirname(target_path), exist_ok=True)

    # 4. Stream file to disk and calculate SHA-256 hash
    hasher = hashlib.sha256()
    size_bytes = 0

    try:
        with open(target_path, "wb") as buffer:
            while chunk := await file.read(64 * 1024):  # 64 KB chunks
                hasher.update(chunk)
                size_bytes += len(chunk)
                buffer.write(chunk)
    except Exception as exc:
        if os.path.exists(target_path):
            os.remove(target_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write file to storage: {str(exc)}"
        )

    content_hash = hasher.hexdigest()

    # 5. Detect MIME type
    mime_type = file.content_type
    if not mime_type or mime_type == "application/octet-stream":
        guessed_type, _ = mimetypes.guess_type(object_key)
        mime_type = guessed_type or "application/octet-stream"

    # 6. Save or update S3Object metadata in DB
    s3_obj = (
        db.query(models.S3Object)
        .filter(models.S3Object.bucket_id == bucket.id, models.S3Object.key == object_key)
        .first()
    )

    if s3_obj:
        s3_obj.size_bytes = size_bytes
        s3_obj.mime_type = mime_type
        s3_obj.content_hash = content_hash
        s3_obj.storage_path = target_path
        s3_obj.created_at = datetime.now(timezone.utc)
    else:
        s3_obj = models.S3Object(
            bucket_id=bucket.id,
            key=object_key,
            size_bytes=size_bytes,
            mime_type=mime_type,
            content_hash=content_hash,
            storage_path=target_path,
            is_encrypted=False
        )
        db.add(s3_obj)

    db.commit()
    db.refresh(s3_obj)

    return s3_obj


@router.get(
    "",
    response_model=List[S3ObjectResponse],
    summary="List objects in a bucket"
)
def list_objects(
    bucket_name: str,
    db: Session = Depends(get_db)
) -> List[S3ObjectResponse]:
    """
    Returns a list of all objects stored in the specified bucket.
    """
    bucket = db.query(models.Bucket).filter(models.Bucket.name == bucket_name).first()
    if not bucket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bucket '{bucket_name}' not found."
        )

    objects = (
        db.query(models.S3Object)
        .filter(models.S3Object.bucket_id == bucket.id)
        .order_by(models.S3Object.created_at.desc())
        .all()
    )

    return objects


@router.get(
    "/{key:path}",
    summary="Get or stream object binary"
)
def get_object(
    bucket_name: str,
    key: str,
    db: Session = Depends(get_db)
):
    """
    Streams file binary for inline browser preview or download with proper Content-Type headers.
    """
    bucket = db.query(models.Bucket).filter(models.Bucket.name == bucket_name).first()
    if not bucket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bucket '{bucket_name}' not found."
        )

    sanitized_key = key.lstrip("/")
    s3_obj = (
        db.query(models.S3Object)
        .filter(models.S3Object.bucket_id == bucket.id, models.S3Object.key == sanitized_key)
        .first()
    )

    if not s3_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Object '{sanitized_key}' not found in bucket '{bucket_name}'."
        )

    if not os.path.exists(s3_obj.storage_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Physical file missing for object '{sanitized_key}'."
        )

    filename = os.path.basename(s3_obj.key)

    # Use inline content disposition so browsers can preview images/text/PDFs directly
    return FileResponse(
        path=s3_obj.storage_path,
        media_type=s3_obj.mime_type,
        filename=filename,
        content_disposition_type="inline"
    )


@router.delete(
    "/{key:path}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an object"
)
def delete_object(
    bucket_name: str,
    key: str,
    db: Session = Depends(get_db)
) -> Response:
    """
    Deletes the object metadata from SQLite and removes physical file from disk.
    """
    bucket = db.query(models.Bucket).filter(models.Bucket.name == bucket_name).first()
    if not bucket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bucket '{bucket_name}' not found."
        )

    sanitized_key = key.lstrip("/")
    s3_obj = (
        db.query(models.S3Object)
        .filter(models.S3Object.bucket_id == bucket.id, models.S3Object.key == sanitized_key)
        .first()
    )

    if not s3_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Object '{sanitized_key}' not found in bucket '{bucket_name}'."
        )

    # Delete physical file from disk if present
    if os.path.exists(s3_obj.storage_path):
        try:
            os.remove(s3_obj.storage_path)
            # Remove parent directory if empty and within bucket directory
            parent_dir = os.path.dirname(s3_obj.storage_path)
            bucket_dir = get_bucket_storage_dir(bucket_name)
            if parent_dir != bucket_dir and os.path.exists(parent_dir) and not os.listdir(parent_dir):
                os.rmdir(parent_dir)
        except OSError:
            pass

    # Delete database record
    db.delete(s3_obj)
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
