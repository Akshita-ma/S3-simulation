import os
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from typing import Dict, Any

from fastapi import FastAPI, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

try:
    from database import engine, Base, get_db
    import models  # Ensure models are loaded before create_all
    from routers.buckets import router as buckets_router
    from routers.objects import router as objects_router
    from routers.presign import router as presign_router
    from routers.stats import router as stats_router
except ImportError:
    from backend.database import engine, Base, get_db
    import backend.models as models
    from backend.routers.buckets import router as buckets_router
    from backend.routers.objects import router as objects_router
    from backend.routers.presign import router as presign_router
    from backend.routers.stats import router as stats_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure all tables exist on startup
    Base.metadata.create_all(bind=engine)
    # Ensure physical storage directory and content-addressed blobs directory exist
    storage_dir = os.getenv("STORAGE_DIR", "./storage")
    os.makedirs(storage_dir, exist_ok=True)
    os.makedirs(os.path.join(storage_dir, "blobs"), exist_ok=True)
    yield


app = FastAPI(
    title="Smart Vault API",
    description="S3 Simulation API providing bucket and object storage management",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS Configuration
# Allowed origins for frontend clients (e.g. Next.js on port 3000)
cors_origins_env = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if "*" not in origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(buckets_router, prefix="/api")
app.include_router(objects_router, prefix="/api")
app.include_router(presign_router, prefix="/api")
app.include_router(stats_router, prefix="/api")


@app.get("/", tags=["Root"])
def read_root() -> Dict[str, Any]:
    """Root endpoint welcoming clients to Smart Vault."""
    return {
        "service": "Smart Vault",
        "description": "S3-compatible Object Storage Simulation",
        "version": "0.1.0",
        "docs_url": "/docs",
        "health_check": "/health"
    }


@app.get("/health", tags=["Health"], status_code=status.HTTP_200_OK)
def health_check(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Health check endpoint verifying API readiness and database connectivity.
    """
    db_status = "connected"
    try:
        # Verify SQLite connection by executing a lightweight query
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db_status = f"unhealthy: {str(exc)}"

    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "service": "Smart Vault API",
        "version": "0.1.0",
        "database": db_status,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
