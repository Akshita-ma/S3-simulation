# Smart Vault (S3 Simulation)

A high-fidelity Amazon S3 object storage simulation platform featuring:
- **FastAPI** backend with SQLite database, SQLAlchemy ORM, local physical disk blob storage, and HMAC-SHA256 pre-signed URLs.
- **Next.js** (App Router) + **Tailwind CSS** frontend styled like the **AWS S3 Management Console**.
- Full metadata tracking for buckets and objects (including SHA-256 integrity hashes, storage paths, encryption flags, and MIME types).

---

## Directory Layout

```text
.
├── backend/
│   ├── database.py         # SQLite engine, session maker, and get_db dependency
│   ├── models.py           # SQLAlchemy models: Bucket and S3Object
│   ├── schemas.py          # Pydantic schemas for request/response serialization
│   ├── main.py             # FastAPI entry point, CORS middleware, and /health endpoint
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── buckets.py      # S3 Bucket management API routes (POST, GET, DELETE)
│   │   ├── objects.py      # S3 Object storage API routes (POST, GET, STREAM, DELETE)
│   │   └── presign.py      # S3 Pre-signed URL generation and authenticated download routes
│   ├── requirements.txt    # Python dependencies (FastAPI, SQLAlchemy, Uvicorn, etc.)
│   ├── storage/            # Local directory for simulated S3 object blobs
│   ├── tests/              # Backend test suite (pytest: buckets, objects, presign, health)
│   └── .env.example        # Environment variables template
├── frontend/
│   ├── package.json        # Next.js and Tailwind CSS dependencies
│   ├── tsconfig.json       # TypeScript configuration
│   ├── tailwind.config.ts  # Tailwind CSS configuration
│   ├── postcss.config.mjs  # PostCSS configuration
│   ├── next.config.mjs     # Next.js configuration
│   ├── src/
│   │   └── app/
│   │       ├── globals.css # Base styling & dark theme variables
│   │       ├── layout.tsx  # Root application layout
│   │       ├── page.tsx    # AWS S3 Console styled bucket management dashboard
│   │       └── buckets/
│   │           └── [bucketName]/
│   │               └── page.tsx # AWS S3 Object Browser, Dropzone, Preview & Pre-sign Modal
│   └── .env.example        # Next.js environment configuration
└── README.md
```

---

## API Endpoints

### Bucket Management (`/api/buckets`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | API readiness and SQLite connectivity check |
| `GET` | `/api/buckets` | List all buckets with `object_count` and `total_size_bytes` |
| `POST` | `/api/buckets` | Create a new bucket with S3 naming validation (default region: `us-east-1`, returns 409 if name exists) |
| `DELETE` | `/api/buckets/{bucket_name}` | Delete empty bucket (returns 400 "Bucket is not empty" if not empty, 204 if successful) |

### Object Storage (`/api/buckets/{bucket_name}/objects`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/buckets/{bucket_name}/objects` | Multipart file upload; computes SHA-256 hash, detects MIME type, saves to disk & DB |
| `GET` | `/api/buckets/{bucket_name}/objects` | List all objects in bucket with metadata (key, size, MIME type, hash, creation date) |
| `GET` | `/api/buckets/{bucket_name}/objects/{key:path}` | Stream binary file with inline `Content-Disposition` for browser preview/download |
| `DELETE` | `/api/buckets/{bucket_name}/objects/{key:path}` | Delete object record and physical file from disk; updates metrics |

### Pre-signed URLs (`/api/buckets/.../presign` & `/api/shared/download`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/buckets/{bucket_name}/objects/{key:path}/presign` | Generate time-limited, HMAC-SHA256 signed download URL (custom `expires_in` seconds) |
| `GET` | `/api/shared/download?token=<TOKEN>` | Validate token authenticity and expiration; streams file attachment (403 if expired, 400 if invalid) |

---

## Quick Start

### Backend

1. **Navigate to the backend directory and set up Python dependencies**:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Run tests**:
   ```bash
   PYTHONPATH=. pytest tests/
   ```

3. **Start the development server**:
   ```bash
   uvicorn main:app --reload --port 8000
   ```
   - Swagger Documentation: `http://127.0.0.1:8000/docs`
   - Health Check: `http://127.0.0.1:8000/health`

### Frontend

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
2. Open `http://localhost:3000` to interact with the AWS S3 Console dashboard.
