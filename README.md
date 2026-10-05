# Smart Vault (S3 Simulation)

A simulated Amazon S3 object storage platform featuring:
- **FastAPI** backend with SQLite database and SQLAlchemy ORM.
- **Next.js** (App Router) + **Tailwind CSS** frontend styled like the **AWS S3 Console**.
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
│   │   └── buckets.py      # S3 Bucket management API routes (POST, GET, DELETE)
│   ├── requirements.txt    # Python dependencies (FastAPI, SQLAlchemy, Uvicorn, etc.)
│   ├── storage/            # Local directory for simulated S3 object blobs
│   ├── tests/              # Backend test suite (pytest)
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
│   │       └── buckets/    # /buckets route re-export
│   └── .env.example        # Next.js environment configuration
└── README.md
```

---

## API Endpoints (Stage 2: Bucket Management)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | API readiness and SQLite connectivity check |
| `GET` | `/api/buckets` | List all buckets with `object_count` and `total_size_bytes` |
| `POST` | `/api/buckets` | Create a new bucket with S3 naming validation (default region: `us-east-1`, returns 409 if name exists) |
| `DELETE` | `/api/buckets/{bucket_name}` | Delete empty bucket (returns 400 "Bucket is not empty" if not empty, 204 if successful) |

### S3 Bucket Naming Rules Enforced
- Length between 3 and 63 characters.
- Lowercase letters, numbers, and hyphens only (`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`).
- Cannot start or end with a hyphen.
- Must be unique across all buckets.

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
