import os
import hmac
import hashlib
import json
import base64
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

try:
    from database import get_db
    import models
    from schemas import PresignRequest, PresignResponse
except ImportError:
    from backend.database import get_db
    import backend.models as models
    from backend.schemas import PresignRequest, PresignResponse

router = APIRouter(tags=["Pre-signed URLs"])

SECRET_KEY = os.getenv("SECRET_KEY", "smart-vault-presign-secret-key-2026")


def generate_presigned_token(bucket_name: str, key: str, expires_at_ts: int) -> str:
    """Generates an HMAC-SHA256 signed URL-safe token containing bucket, key, and expiration."""
    payload = {
        "b": bucket_name,
        "k": key,
        "exp": expires_at_ts,
    }
    payload_raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(payload_raw).decode("utf-8").rstrip("=")

    signature = hmac.new(
        SECRET_KEY.encode("utf-8"),
        b64_payload.encode("utf-8"),
        hashlib.sha256
    ).digest()
    b64_signature = base64.urlsafe_b64encode(signature).decode("utf-8").rstrip("=")

    return f"{b64_payload}.{b64_signature}"


def verify_presigned_token(token: str) -> dict:
    """
    Validates token format, verifies HMAC-SHA256 signature, and checks expiration timestamp.
    Raises HTTPException 400 on invalid format/signature, or 403 on expired token.
    """
    if not token or "." not in token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token or signature."
        )

    parts = token.split(".")
    if len(parts) != 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token or signature."
        )

    b64_payload, b64_sig = parts

    try:
        # 1. Verify HMAC signature using constant-time comparison
        expected_sig = hmac.new(
            SECRET_KEY.encode("utf-8"),
            b64_payload.encode("utf-8"),
            hashlib.sha256
        ).digest()

        pad_sig = (4 - len(b64_sig) % 4) % 4
        sig_bytes = base64.urlsafe_b64decode(b64_sig + "=" * pad_sig)

        if not hmac.compare_digest(sig_bytes, expected_sig):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid token or signature."
            )

        # 2. Decode payload JSON
        pad_payload = (4 - len(b64_payload) % 4) % 4
        payload_bytes = base64.urlsafe_b64decode(b64_payload + "=" * pad_payload)
        payload = json.loads(payload_bytes.decode("utf-8"))

        if not isinstance(payload, dict) or "b" not in payload or "k" not in payload or "exp" not in payload:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid token or signature."
            )

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token or signature."
        )

    # 3. Check expiration timestamp against current UTC time
    now_ts = int(datetime.now(timezone.utc).timestamp())
    if payload["exp"] < now_ts:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The pre-signed URL has expired."
        )

    return payload


@router.post(
    "/buckets/{bucket_name}/objects/{key:path}/presign",
    response_model=PresignResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate a pre-signed URL for an object"
)
async def create_presigned_url(
    bucket_name: str,
    key: str,
    request: Request,
    expires_in: Optional[int] = Query(None, description="Expiration in seconds"),
    db: Session = Depends(get_db)
) -> PresignResponse:
    """
    Generates a signed, time-limited token encoding bucket_name, key, and expires_at.
    Accepts expires_in via query param or JSON payload (default: 300 seconds).
    """
    # 1. Determine expires_in from query param or JSON body
    final_expires_in = 300
    if expires_in is not None:
        final_expires_in = int(expires_in)
    else:
        try:
            body = await request.json()
            if isinstance(body, dict) and "expires_in" in body:
                final_expires_in = int(body["expires_in"])
        except Exception:
            pass

    if final_expires_in <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="expires_in must be greater than 0 seconds."
        )

    # 2. Verify bucket and object exist in database
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

    # 3. Calculate expiration timestamp
    now = datetime.now(timezone.utc)
    expires_at_dt = now + timedelta(seconds=final_expires_in)
    expires_at_ts = int(expires_at_dt.timestamp())

    # 4. Generate signed token
    token = generate_presigned_token(bucket_name, sanitized_key, expires_at_ts)
    presigned_path = f"/api/shared/download?token={token}"

    return PresignResponse(
        presigned_url=presigned_path,
        expires_at=expires_at_dt.isoformat(),
        expires_in=final_expires_in
    )


@router.get(
    "/shared/download",
    summary="Download object via pre-signed token"
)
def download_shared_object(
    token: str = Query(..., description="Pre-signed download token"),
    db: Session = Depends(get_db)
):
    """
    Downloads an object using a pre-signed token.
    Validates token integrity and expiry; returns 400 for invalid signature and 403 for expired URLs.
    """
    # 1. Validate token signature and expiration
    payload = verify_presigned_token(token)

    bucket_name = payload["b"]
    key = payload["k"]

    # 2. Retrieve object metadata
    bucket = db.query(models.Bucket).filter(models.Bucket.name == bucket_name).first()
    if not bucket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bucket '{bucket_name}' not found."
        )

    s3_obj = (
        db.query(models.S3Object)
        .filter(models.S3Object.bucket_id == bucket.id, models.S3Object.key == key)
        .first()
    )
    if not s3_obj or not os.path.exists(s3_obj.storage_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Object file not found on storage."
        )

    filename = os.path.basename(s3_obj.key)

    # 3. Stream binary file with attachment header
    return FileResponse(
        path=s3_obj.storage_path,
        media_type=s3_obj.mime_type,
        filename=filename,
        content_disposition_type="attachment"
    )
