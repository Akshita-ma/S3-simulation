from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class BucketBase(BaseModel):
    name: str = Field(..., description="S3 bucket name")
    region: Optional[str] = Field("us-east-1", description="AWS region where bucket is hosted")


class BucketCreate(BucketBase):
    pass


class BucketResponse(BucketBase):
    id: int
    created_at: datetime
    object_count: int = Field(0, description="Total number of objects stored in this bucket")
    total_size_bytes: int = Field(0, description="Cumulative size of all objects in bytes")

    model_config = ConfigDict(from_attributes=True)


class S3ObjectResponse(BaseModel):
    id: int
    bucket_id: int
    key: str
    size_bytes: int
    mime_type: str
    content_hash: str
    is_encrypted: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PresignRequest(BaseModel):
    expires_in: int = Field(300, ge=1, le=604800, description="Token expiration window in seconds")


class PresignResponse(BaseModel):
    presigned_url: str = Field(..., description="Pre-signed download URL")
    expires_at: str = Field(..., description="ISO 8601 expiration timestamp")
    expires_in: int = Field(..., description="Token lifespan in seconds")
