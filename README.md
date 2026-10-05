# Smart Vault (S3 Simulation)

A high-fidelity Amazon S3 object storage simulation platform featuring:
- **FastAPI** backend with SQLite database, SQLAlchemy ORM, Content-Addressable Block Deduplication, HMAC-SHA256 pre-signed URLs, and global storage analytics.
- **Next.js** (App Router) + **Tailwind CSS** frontend styled like the **AWS S3 Management Console** with client-side Zero-Knowledge AES-GCM encryption (Web Crypto API).
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
│   │   ├── objects.py      # S3 Object storage API with content-addressable deduplication
│   │   ├── presign.py      # S3 Pre-signed URL generation and authenticated download routes
│   │   └── stats.py        # Global deduplication, space savings, and encryption analytics
│   ├── requirements.txt    # Python dependencies (FastAPI, SQLAlchemy, Uvicorn, etc.)
│   ├── storage/
│   │   └── blobs/          # Content-addressed deduplicated blobs (<sha256_hash>)
│   ├── tests/              # Backend test suite (pytest: buckets, objects, presign, stage5)
│   └── .env.example        # Environment variables template
├── frontend/
│   ├── package.json        # Next.js and Tailwind CSS dependencies
│   ├── tsconfig.json       # TypeScript configuration
│   ├── tailwind.config.ts  # Tailwind CSS configuration
│   ├── postcss.config.mjs  # PostCSS configuration
│   ├── next.config.mjs     # Next.js configuration
│   ├── src/
│   │   ├── lib/
│   │   │   └── crypto.ts   # Web Crypto API client-side AES-GCM 256-bit & PBKDF2 utilities
│   │   └── app/
│   │       ├── globals.css # Base styling & dark theme variables
│   │       ├── layout.tsx  # Root application layout
│   │       ├── page.tsx    # S3 Console with Vault Storage Optimization widget
│   │       └── buckets/
│   │           └── [bucketName]/
│   │               └── page.tsx # Object browser, zero-knowledge encryption & decryption modals
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
| `POST` | `/api/buckets/{bucket_name}/objects` | Multipart file upload; computes SHA-256 hash, stores under `storage/blobs/<sha256>`, reuses identical blobs (Deduplication) |
| `GET` | `/api/buckets/{bucket_name}/objects` | List all objects in bucket with metadata (key, size, MIME type, hash, creation date, is_encrypted) |
| `GET` | `/api/buckets/{bucket_name}/objects/{key:path}` | Stream binary file with inline `Content-Disposition` for browser preview/download |
| `DELETE` | `/api/buckets/{bucket_name}/objects/{key:path}` | Delete object record; only removes physical blob if no other objects share the hash (Ref counting) |

### Pre-signed URLs (`/api/buckets/.../presign` & `/api/shared/download`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/buckets/{bucket_name}/objects/{key:path}/presign` | Generate time-limited, HMAC-SHA256 signed download URL (custom `expires_in` seconds) |
| `GET` | `/api/shared/download?token=<TOKEN>` | Validate token authenticity and expiration; streams file attachment (403 if expired, 400 if invalid) |

### Analytics & Deduplication (`/api/stats`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stats` | Global metrics: logical vs physical sizes, space saved, dedup ratio, unique blobs, encrypted objects |

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
   - Global Analytics: `http://127.0.0.1:8000/api/stats`

### Frontend

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
2. Open `http://localhost:3000` to interact with the AWS S3 Console dashboard and client-side zero-knowledge encrypted vault.

---

## AWS Management Console UI/UX & Architecture Guide (Stage 6)

Smart Vault provides a high-fidelity AWS S3 Management Console experience:
- **Global AWS Console Dark Theme Header**: Features AWS dark background (`#131b2c`), signature orange accents (`#ec7211` / `#ff9900`), region indicator (`us-east-1`), live backend health status indicator, and Swagger API quick-link.
- **Interactive Architecture & S3 Concepts Drawer**: Accessible via the "Architecture Guide" button in the global header, presenting a comprehensive slide-over panel with 3 deep-dive sections:
  1. *Amazon S3 Core Parity*: Bucket naming constraints, RFC 1123 DNS compliance, prefix-based object storage, MIME inference, and HMAC-SHA256 pre-signed URLs.
  2. *Content-Addressable Block Deduplication*: SHA-256 block hashing, physical blob reuse under `storage/blobs/<sha256>`, and reference-counted lifecycle cleanup.
  3. *Zero-Knowledge Client-Side Encryption*: In-browser PBKDF2 (100k rounds) key derivation, AES-GCM 256-bit encryption before wire transmission, and client-side ephemeral decryption.
- **Optimization Banner & Stat Cards**: Real-time display of total saved storage capacity, deduplication ratio, objects vs unique blobs, and encrypted file counts.
- **Responsive Tables & Toast Notifications**: Intuitive action icons (`Lock`, `Key`, `HardDrive`, `Trash2`, `Download`, `Eye`, `ExternalLink`) and clean dismissible toast notifications for uploads, URL copying, and cryptographic operations.

