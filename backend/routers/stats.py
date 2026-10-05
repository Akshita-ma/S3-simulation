import os
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

try:
    from database import get_db
    import models
    from schemas import StatsResponse
except ImportError:
    from backend.database import get_db
    import backend.models as models
    from backend.schemas import StatsResponse

router = APIRouter(prefix="/stats", tags=["Analytics"])


@router.get(
    "",
    response_model=StatsResponse,
    summary="Get global storage deduplication and encryption analytics"
)
def get_storage_stats(db: Session = Depends(get_db)) -> StatsResponse:
    """
    Returns global storage metrics:
    - logical_size_bytes: Total cumulative size of all objects across all buckets
    - physical_size_bytes: Total physical disk size of unique content-addressed blobs
    - saved_space_bytes: Bytes saved through content-addressable deduplication
    - dedup_ratio: Percentage of storage saved
    - total_objects: Total count of object metadata records
    - unique_blobs: Number of unique physical content-addressed blobs
    - encrypted_objects_count: Number of objects secured with client-side encryption
    """
    # 1. Total logical size and object counts
    logical_size = db.query(func.coalesce(func.sum(models.S3Object.size_bytes), 0)).scalar() or 0
    total_objects = db.query(func.count(models.S3Object.id)).scalar() or 0
    encrypted_count = (
        db.query(func.count(models.S3Object.id))
        .filter(models.S3Object.is_encrypted == True)
        .scalar() or 0
    )

    # 2. Distinct content-addressed blobs calculation using group_by for portable SQL
    unique_objects = (
        db.query(
            models.S3Object.content_hash,
            func.max(models.S3Object.size_bytes),
            func.max(models.S3Object.storage_path)
        )
        .group_by(models.S3Object.content_hash)
        .all()
    )

    unique_blobs = len(unique_objects)
    physical_size = 0

    for _, fallback_size, storage_path in unique_objects:
        if storage_path and os.path.exists(storage_path):
            try:
                physical_size += os.path.getsize(storage_path)
            except OSError:
                physical_size += (fallback_size or 0)
        else:
            physical_size += (fallback_size or 0)

    saved_space = max(0, int(logical_size - physical_size))
    dedup_ratio = f"{(saved_space / logical_size * 100):.1f}%" if logical_size > 0 else "0.0%"

    return StatsResponse(
        logical_size_bytes=int(logical_size),
        physical_size_bytes=int(physical_size),
        saved_space_bytes=int(saved_space),
        dedup_ratio=dedup_ratio,
        total_objects=int(total_objects),
        unique_blobs=int(unique_blobs),
        encrypted_objects_count=int(encrypted_count),
    )
