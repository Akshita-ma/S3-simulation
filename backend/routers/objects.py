import os
import uuid
import hashlib
import mimetypes
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status, Response
from fastapi.responses import FileResponse
from sqlalchemy import func
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


def get_blobs_storage_dir() -> str:
    """Returns absolute path to the content-addressable blobs directory."""
    storage_root = os.path.abspath(os.getenv("STORAGE_DIR", "./storage"))
    blobs_dir = os.path.join(storage_root, "blobs")
    os.makedirs(blobs_dir, exist_ok=True)
    return blobs_dir


@router.post(
    "",
    response_model=S3ObjectResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an object with Content-Addressable Deduplication"
)
async def upload_object(
    bucket_name: str,
    file: UploadFile = File(..., description="Binary file upload"),
    key: Optional[str] = Form(None, description="Optional custom object key/path"),
    is_encrypted: bool = Form(False, description="Flag indicating client-side zero-knowledge encryption"),
    db: Session = Depends(get_db)
) -> S3ObjectResponse:
    """
    Uploads a file via multipart/form-data.
    Computes SHA-256 hash and stores physical file under /storage/blobs/<sha256>.
    If identical hash already exists on disk, avoids writing duplicate bytes (Deduplication).
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

    # Path traversal validation on the logical key name
    if ".." in object_key.split("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid object key path (path traversal detected)."
        )

    blobs_dir = get_blobs_storage_dir()
    temp_filename = f".tmp_{uuid.uuid4().hex}"
    temp_path = os.path.join(blobs_dir, temp_filename)

    hasher = hashlib.sha256()
    size_bytes = 0

    # 3. Stream incoming chunks to temporary file while calculating SHA-256
    try:
        with open(temp_path, "wb") as buffer:
            while chunk := await file.read(64 * 1024):
                hasher.update(chunk)
                size_bytes += len(chunk)
                buffer.write(chunk)
    except Exception as exc:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process incoming payload: {str(exc)}"
        )

    content_hash = hasher.hexdigest()
    blob_target_path = os.path.join(blobs_dir, content_hash)

    # 4. Content-Addressable Block Deduplication
    if os.path.exists(blob_target_path):
        # Identical blob exists on disk: discard temp file and reuse existing blob
        os.remove(temp_path)
    else:
        # First occurrence of this blob: promote temp file to content-addressed name
        os.replace(temp_path, blob_target_path)

    # 5. Detect MIME type
    mime_type = file.content_type
    if not mime_type or mime_type == "application/octet-stream":
        guessed_type, _ = mimetypes.guess_type(object_key)
        mime_type = guessed_type or "application/octet-stream"

    # 6. Save or update S3Object metadata in SQLite
    s3_obj = (
        db.query(models.S3Object)
        .filter(models.S3Object.bucket_id == bucket.id, models.S3Object.key == object_key)
        .first()
    )

    if s3_obj:
        s3_obj.size_bytes = size_bytes
        s3_obj.mime_type = mime_type
        s3_obj.content_hash = content_hash
        s3_obj.storage_path = blob_target_path
        s3_obj.is_encrypted = is_encrypted
        s3_obj.created_at = datetime.now(timezone.utc)
    else:
        s3_obj = models.S3Object(
            bucket_id=bucket.id,
            key=object_key,
            size_bytes=size_bytes,
            mime_type=mime_type,
            content_hash=content_hash,
            storage_path=blob_target_path,
            is_encrypted=is_encrypted
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
            detail=f"Physical blob missing for object '{sanitized_key}'."
        )

    filename = os.path.basename(s3_obj.key)

    return FileResponse(
        path=s3_obj.storage_path,
        media_type=s3_obj.mime_type,
        filename=filename,
        content_disposition_type="inline"
    )


@router.delete(
    "/{key:path}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an object (Deduplication reference counted)"
)
def delete_object(
    bucket_name: str,
    key: str,
    db: Session = Depends(get_db)
) -> Response:
    """
    Deletes object metadata from database.
    Only removes the physical blob on disk if NO OTHER object record in any bucket references the same content_hash.
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

    # Check if other objects reference this identical content_hash
    other_references_count = (
        db.query(func.count(models.S3Object.id))
        .filter(
            models.S3Object.content_hash == s3_obj.content_hash,
            models.S3Object.id != s3_obj.id
        )
        .scalar() or 0
    )

    # Only delete physical blob if this was the last reference
    if other_references_count == 0 and os.path.exists(s3_obj.storage_path):
        try:
            os.remove(s3_obj.storage_path)
        except OSError:
            pass

    # Delete metadata record
    db.delete(s3_obj)
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
