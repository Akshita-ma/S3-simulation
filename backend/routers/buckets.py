import os
import re
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

try:
    from database import get_db
    import models
    from schemas import BucketCreate, BucketResponse
except ImportError:
    from backend.database import get_db
    import backend.models as models
    from backend.schemas import BucketCreate, BucketResponse

router = APIRouter(prefix="/buckets", tags=["Buckets"])

# Regex for S3 bucket name validation:
# - Length 3-63
# - Only lowercase letters, numbers, and hyphens
# - Cannot start or end with a hyphen
S3_BUCKET_NAME_REGEX = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")


def validate_s3_bucket_name(name: str) -> None:
    """
    Validates S3 bucket naming rules:
    - Length between 3 and 63 characters
    - Lowercase letters, numbers, and hyphens only
    - Cannot start or end with a hyphen
    """
    if not name or not isinstance(name, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bucket name is required."
        )

    if len(name) < 3 or len(name) > 63:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Bucket name length must be between 3 and 63 characters (got {len(name)})."
        )

    if name.startswith("-") or name.endswith("-"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bucket name cannot start or end with a hyphen."
        )

    if not S3_BUCKET_NAME_REGEX.match(name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bucket name must consist only of lowercase letters, numbers, and hyphens."
        )


@router.post(
    "",
    response_model=BucketResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new bucket"
)
def create_bucket(
    payload: BucketCreate,
    db: Session = Depends(get_db)
) -> BucketResponse:
    """
    Creates a new S3 bucket with name validation and default region 'us-east-1'.
    Returns 409 Conflict if the bucket name already exists.
    """
    # 1. Validate bucket name according to S3 rules
    validate_s3_bucket_name(payload.name)

    # 2. Check for existing bucket name (unique conflict)
    existing_bucket = db.query(models.Bucket).filter(models.Bucket.name == payload.name).first()
    if existing_bucket:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bucket with name '{payload.name}' already exists."
        )

    region = payload.region.strip() if payload.region and payload.region.strip() else "us-east-1"

    # 3. Create bucket record
    bucket = models.Bucket(name=payload.name, region=region)
    db.add(bucket)
    db.commit()
    db.refresh(bucket)

    # 4. Ensure physical storage directory exists for the bucket
    storage_root = os.getenv("STORAGE_DIR", "./storage")
    bucket_storage_dir = os.path.join(storage_root, payload.name)
    os.makedirs(bucket_storage_dir, exist_ok=True)

    return BucketResponse(
        id=bucket.id,
        name=bucket.name,
        region=bucket.region,
        created_at=bucket.created_at,
        object_count=0,
        total_size_bytes=0
    )


@router.get(
    "",
    response_model=List[BucketResponse],
    summary="List all buckets"
)
def list_buckets(db: Session = Depends(get_db)) -> List[BucketResponse]:
    """
    Returns a list of all buckets with aggregated object counts and total size in bytes.
    """
    query = (
        db.query(
            models.Bucket,
            func.count(models.S3Object.id).label("object_count"),
            func.coalesce(func.sum(models.S3Object.size_bytes), 0).label("total_size_bytes")
        )
        .outerjoin(models.S3Object, models.Bucket.id == models.S3Object.bucket_id)
        .group_by(models.Bucket.id)
        .order_by(models.Bucket.created_at.desc())
    )

    rows = query.all()

    return [
        BucketResponse(
            id=bucket.id,
            name=bucket.name,
            region=bucket.region,
            created_at=bucket.created_at,
            object_count=int(obj_count),
            total_size_bytes=int(tot_size)
        )
        for bucket, obj_count, tot_size in rows
    ]


@router.delete(
    "/{bucket_name}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an empty bucket"
)
def delete_bucket(
    bucket_name: str,
    db: Session = Depends(get_db)
) -> Response:
    """
    Deletes a bucket by name.
    If the bucket contains objects, returns 400 Bad Request ("Bucket is not empty").
    If the bucket does not exist, returns 404 Not Found.
    """
    bucket = db.query(models.Bucket).filter(models.Bucket.name == bucket_name).first()
    if not bucket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bucket '{bucket_name}' not found."
        )

    # Check if bucket contains any objects
    object_count = (
        db.query(func.count(models.S3Object.id))
        .filter(models.S3Object.bucket_id == bucket.id)
        .scalar() or 0
    )

    if object_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bucket is not empty"
        )

    # Delete the bucket record
    db.delete(bucket)
    db.commit()

    # Clean up physical storage directory if empty
    storage_root = os.getenv("STORAGE_DIR", "./storage")
    bucket_storage_dir = os.path.join(storage_root, bucket_name)
    if os.path.exists(bucket_storage_dir) and not os.listdir(bucket_storage_dir):
        try:
            os.rmdir(bucket_storage_dir)
        except OSError:
            pass

    return Response(status_code=status.HTTP_204_NO_CONTENT)
