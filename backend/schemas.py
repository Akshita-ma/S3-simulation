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
