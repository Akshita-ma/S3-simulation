from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    func
)
from sqlalchemy.orm import relationship

try:
    from database import Base
except ImportError:
    from backend.database import Base


class Bucket(Base):
    __tablename__ = "buckets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(63), unique=True, index=True, nullable=False)
    region = Column(String(32), nullable=False, default="us-east-1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # One bucket can contain many S3 objects; deleting bucket cascades deletion of metadata
    objects = relationship(
        "S3Object",
        back_populates="bucket",
        cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Bucket(id={self.id}, name='{self.name}', region='{self.region}')>"


class S3Object(Base):
    __tablename__ = "s3_objects"

    id = Column(Integer, primary_key=True, index=True)
    bucket_id = Column(Integer, ForeignKey("buckets.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String(1024), nullable=False, index=True)
    size_bytes = Column(BigInteger, nullable=False, default=0)
    mime_type = Column(String(255), nullable=False, default="application/octet-stream")
    content_hash = Column(String(64), nullable=False)  # SHA-256 hex digest
    storage_path = Column(String(1024), nullable=False)  # Local physical storage path
    is_encrypted = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationship back to parent bucket
    bucket = relationship("Bucket", back_populates="objects")

    # In S3, an object key is unique within a specific bucket
    __table_args__ = (
        UniqueConstraint("bucket_id", "key", name="uq_bucket_key"),
    )

    def __repr__(self) -> str:
        return (
            f"<S3Object(id={self.id}, bucket_id={self.bucket_id}, "
            f"key='{self.key}', size={self.size_bytes}, hash='{self.content_hash[:8]}...')>"
        )


class ExecutionLog(Base):
    __tablename__ = "execution_logs"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(64), nullable=False, default="s3:ObjectCreated:Put")
    bucket_name = Column(String(63), nullable=False, index=True)
    key = Column(String(1024), nullable=False, index=True)
    status = Column(String(32), nullable=False)  # 'SUCCESS' / 'FAILED'
    duration_ms = Column(Integer, nullable=False, default=0)
    message = Column(String(4096), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def __repr__(self) -> str:
        return (
            f"<ExecutionLog(id={self.id}, event='{self.event_type}', "
            f"bucket='{self.bucket_name}', key='{self.key}', status='{self.status}')>"
        )

