"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  FileText,
  FileCode,
  FileSpreadsheet,
  FileImage,
  File as FileIcon,
  UploadCloud,
  Download,
  Eye,
  Trash2,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  ExternalLink,
  ShieldCheck,
  HardDrive,
  Globe,
  ArrowLeft,
  X,
  Loader2,
  Hash,
  Clock,
  Layers,
  Share2,
  Link2,
  Timer,
  Check,
} from "lucide-react";

interface S3Object {
  id: number;
  bucket_id: number;
  key: string;
  size_bytes: number;
  mime_type: string;
  content_hash: string;
  is_encrypted: boolean;
  created_at: string;
}

interface BucketMeta {
  id: number;
  name: string;
  region: string;
  created_at: string;
  object_count: number;
  total_size_bytes: number;
}

interface PresignedResponse {
  presigned_url: string;
  expires_at: string;
  expires_in: number;
}

const EXPIRATION_OPTIONS = [
  { label: "1 minute (testing)", seconds: 60 },
  { label: "5 minutes (default)", seconds: 300 },
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86400 },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return dateStr;
  }
}

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "Expired";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function getFileIcon(mimeType: string, key: string) {
  if (mimeType.startsWith("image/")) return <FileImage className="w-4 h-4 text-cyan-400 shrink-0" />;
  if (
    mimeType.includes("json") ||
    mimeType.includes("javascript") ||
    mimeType.includes("python") ||
    key.endsWith(".py") ||
    key.endsWith(".ts") ||
    key.endsWith(".js")
  ) {
    return <FileCode className="w-4 h-4 text-amber-400 shrink-0" />;
  }
  if (mimeType.includes("csv") || mimeType.includes("spreadsheet")) {
    return <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />;
  }
  if (mimeType.startsWith("text/")) {
    return <FileText className="w-4 h-4 text-slate-300 shrink-0" />;
  }
  return <FileIcon className="w-4 h-4 text-indigo-400 shrink-0" />;
}

export default function BucketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rawBucketName = params?.bucketName as string;
  const bucketName = decodeURIComponent(rawBucketName || "");

  const [objects, setObjects] = useState<S3Object[]>([]);
  const [bucketMeta, setBucketMeta] = useState<BucketMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // Upload Zone state
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [customKey, setCustomKey] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Preview Modal state
  const [previewObject, setPreviewObject] = useState<S3Object | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Delete Modal state
  const [objectToDelete, setObjectToDelete] = useState<S3Object | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Presign Modal state
  const [presignObject, setPresignObject] = useState<S3Object | null>(null);
  const [presignExpiresIn, setPresignExpiresIn] = useState<number>(300);
  const [presignedData, setPresignedData] = useState<PresignedResponse | null>(null);
  const [presignLoading, setPresignLoading] = useState(false);
  const [presignError, setPresignError] = useState<string | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const [copiedPresigned, setCopiedPresigned] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  // Fetch Objects and Bucket Metadata
  const loadData = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const objRes = await fetch(`${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects`);
      if (objRes.status === 404) {
        showToast(`Bucket '${bucketName}' not found`, "error");
        router.push("/");
        return;
      }
      if (!objRes.ok) throw new Error("Failed to load bucket objects.");
      const objData: S3Object[] = await objRes.json();
      setObjects(objData);

      const bucketRes = await fetch(`${API_BASE}/api/buckets`);
      if (bucketRes.ok) {
        const allBuckets: BucketMeta[] = await bucketRes.json();
        const found = allBuckets.find((b) => b.name === bucketName);
        if (found) setBucketMeta(found);
      }
    } catch (err: any) {
      showToast(err.message || "Failed to fetch data from backend", "error");
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  };

  useEffect(() => {
    if (bucketName) {
      loadData();
    }
  }, [bucketName]);

  // Active countdown timer effect for pre-signed URL
  useEffect(() => {
    if (!presignedData) {
      setCountdownSeconds(null);
      return;
    }

    const expiryTime = new Date(presignedData.expires_at).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
      setCountdownSeconds(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [presignedData]);

  // Filtered objects
  const filteredObjects = useMemo(() => {
    return objects.filter(
      (obj) =>
        obj.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        obj.mime_type.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [objects, searchQuery]);

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      setUploadFiles(filesArray);
      if (filesArray.length === 1 && !customKey) {
        setCustomKey(filesArray[0].name);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      setUploadFiles(filesArray);
      if (filesArray.length === 1 && !customKey) {
        setCustomKey(filesArray[0].name);
      }
    }
  };

  // Submit Upload
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadFiles.length === 0) return;

    setUploading(true);
    setUploadError(null);

    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        const formData = new FormData();
        formData.append("file", file);
        if (uploadFiles.length === 1 && customKey.trim()) {
          formData.append("key", customKey.trim());
        } else {
          formData.append("key", file.name);
        }

        const res = await fetch(`${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Failed to upload ${file.name}`);
        }
      }

      showToast(`Successfully uploaded ${uploadFiles.length} file(s)!`, "success");
      setUploadFiles([]);
      setCustomKey("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadData();
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // Open Preview Modal
  const openPreview = async (obj: S3Object) => {
    setPreviewObject(obj);
    setPreviewContent(null);
    setPreviewLoading(true);

    const isText =
      obj.mime_type.startsWith("text/") ||
      obj.mime_type.includes("json") ||
      obj.mime_type.includes("javascript") ||
      obj.mime_type.includes("python") ||
      obj.mime_type.includes("xml") ||
      obj.mime_type.includes("csv") ||
      obj.key.endsWith(".md") ||
      obj.key.endsWith(".txt") ||
      obj.key.endsWith(".json");

    if (isText && obj.size_bytes < 2 * 1024 * 1024) {
      try {
        const res = await fetch(
          `${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(obj.key)}`
        );
        if (res.ok) {
          const text = await res.text();
          setPreviewContent(text);
        }
      } catch {
        setPreviewContent(null);
      }
    }
    setPreviewLoading(false);
  };

  // Open Presign Modal
  const openPresignModal = (obj: S3Object) => {
    setPresignObject(obj);
    setPresignExpiresIn(300);
    setPresignedData(null);
    setPresignError(null);
    setCopiedPresigned(false);
  };

  // Generate Presigned URL
  const handleGeneratePresignedUrl = async (expiresInSec: number = presignExpiresIn) => {
    if (!presignObject) return;

    setPresignLoading(true);
    setPresignError(null);

    try {
      const res = await fetch(
        `${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(presignObject.key)}/presign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expires_in: expiresInSec }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to generate pre-signed URL.");
      }

      const data: PresignedResponse = await res.json();
      setPresignedData(data);
      showToast("Pre-signed URL generated successfully!", "success");
    } catch (err: any) {
      setPresignError(err.message);
    } finally {
      setPresignLoading(false);
    }
  };

  // Handle Delete Object
  const handleDeleteObject = async () => {
    if (!objectToDelete) return;
    setDeleteSubmitting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(objectToDelete.key)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to delete object.");
      }
      showToast(`Deleted '${objectToDelete.key}'`, "success");
      setObjectToDelete(null);
      setSelectedKeys((prev) => prev.filter((k) => k !== objectToDelete.key));
      loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0e1726] text-slate-200">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl border text-sm font-medium transition-all ${
            toast.type === "success"
              ? "bg-emerald-950/90 text-emerald-200 border-emerald-600/50"
              : "bg-red-950/90 text-red-200 border-red-600/50"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
          )}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top AWS Console Global Bar */}
      <nav className="bg-[#131b2c] border-b border-slate-800 px-4 py-2.5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90">
            <div className="w-6 h-6 rounded bg-[#ec7211] flex items-center justify-center font-black text-slate-950 text-xs">
              S3
            </div>
            <span className="font-semibold text-slate-100 tracking-wide text-sm">Smart Vault Console</span>
          </Link>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">AWS S3 Simulation Engine</span>
        </div>

        <div className="flex items-center gap-4 text-slate-400">
          <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1 rounded border border-slate-800">
            <Globe className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-slate-300 font-mono">{bucketMeta?.region || "us-east-1"}</span>
          </div>
          <a
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-slate-300 hover:text-amber-400 transition-colors"
          >
            <span>Swagger API</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </nav>

      {/* Breadcrumb Navigation */}
      <div className="bg-[#101827] border-b border-slate-800/80 px-6 py-2.5 text-xs text-slate-400 flex items-center gap-2">
        <Link href="/" className="hover:text-slate-200">
          Amazon S3
        </Link>
        <span>&rsaquo;</span>
        <Link href="/" className="hover:text-slate-200">
          Buckets
        </Link>
        <span>&rsaquo;</span>
        <span className="text-amber-400 font-medium font-mono">{bucketName}</span>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Bucket Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Back to all buckets"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-2xl font-bold text-white tracking-tight font-mono flex items-center gap-2">
                <span>{bucketName}</span>
              </h1>
            </div>
            <p className="text-xs text-slate-400 pl-9">
              Region: <span className="font-mono text-slate-300">{bucketMeta?.region || "us-east-1"}</span> | Total Objects:{" "}
              <span className="font-mono text-slate-300">{objects.length}</span> | Cumulative Size:{" "}
              <span className="font-mono text-slate-300">
                {formatBytes(objects.reduce((sum, o) => sum + o.size_bytes, 0))}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 rounded transition-colors disabled:opacity-50"
              title="Refresh object list"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Upload Zone */}
        <section className="bg-[#121c2e] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-amber-400" />
              <h2 className="text-sm font-semibold text-white">Upload objects</h2>
            </div>
            <span className="text-[11px] text-slate-400">Drag & drop files or choose from disk</span>
          </div>

          <form onSubmit={handleUpload} className="space-y-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${
                isDragOver
                  ? "border-amber-400 bg-amber-950/20"
                  : "border-slate-700 hover:border-slate-500 bg-[#0a1220]/60"
              }`}
            >
              <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
              <div className="flex flex-col items-center justify-center gap-2">
                <UploadCloud className={`w-8 h-8 ${isDragOver ? "text-amber-400" : "text-slate-500"}`} />
                <div className="text-xs">
                  <span className="font-semibold text-amber-400 hover:underline">Choose files</span>
                  <span className="text-slate-400"> or drag and drop files here</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Files are stored in <code className="text-slate-400">storage/{bucketName}/</code> with SHA-256 integrity
                  verification.
                </p>
              </div>
            </div>

            {uploadFiles.length > 0 && (
              <div className="p-4 bg-[#0a1220] border border-slate-700/80 rounded-lg space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">
                    Selected: {uploadFiles.length} file{uploadFiles.length > 1 ? "s" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadFiles([]);
                      setCustomKey("");
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-slate-400 hover:text-red-400 text-[11px]"
                  >
                    Clear selection
                  </button>
                </div>

                <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                  {uploadFiles.map((f, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-[11px] p-2 rounded bg-slate-900 border border-slate-800"
                    >
                      <span className="font-mono text-slate-300 truncate max-w-md">{f.name}</span>
                      <span className="text-slate-500 font-mono">{formatBytes(f.size)}</span>
                    </div>
                  ))}
                </div>

                {uploadFiles.length === 1 && (
                  <div className="space-y-1 pt-1">
                    <label className="block text-[11px] font-semibold text-slate-300">
                      Destination Key / Prefix Path (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder={uploadFiles[0].name}
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                    <p className="text-[10px] text-slate-500">
                      Prefix with folder structure e.g. <code className="text-slate-400">images/profile.png</code>
                    </p>
                  </div>
                )}

                {uploadError && (
                  <div className="p-2.5 rounded bg-red-950/80 border border-red-800 text-red-200 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={uploading}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-[#ec7211] hover:bg-[#ff841f] active:bg-[#d6650b] rounded transition-colors disabled:opacity-50"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>Upload ({uploadFiles.length})</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </form>
        </section>

        {/* Object Browser Toolbar */}
        <div className="bg-[#121c2e] border border-slate-800 rounded-t-lg p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Find objects by prefix or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0b1322] border border-slate-700 rounded pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-200 text-xs"
              >
                &times;
              </button>
            )}
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>
              Showing {filteredObjects.length} of {objects.length} object{objects.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {/* Object Table */}
        <div className="border border-slate-800 border-t-0 rounded-b-lg overflow-x-auto bg-[#0f1728]">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-[#162238] border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[11px]">
              <tr>
                <th scope="col" className="p-3.5 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filteredObjects.length > 0 && selectedKeys.length === filteredObjects.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedKeys(filteredObjects.map((o) => o.key));
                      } else {
                        setSelectedKeys([]);
                      }
                    }}
                    className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900"
                  />
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200">
                  Name (Key)
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200">
                  Type
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200">
                  Last modified
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200 text-right">
                  Size
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200 text-center w-36">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                      <span>Loading objects...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredObjects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <FileIcon className="w-10 h-10 text-slate-600 stroke-[1.2]" />
                      <p className="text-sm font-semibold text-slate-300">
                        {searchQuery ? "No matching objects found" : "No objects in this bucket"}
                      </p>
                      <p className="text-xs text-slate-500 max-w-sm">
                        {searchQuery
                          ? `No objects match '${searchQuery}'.`
                          : "Upload your first file using the drop zone above."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredObjects.map((obj) => {
                  const isSelected = selectedKeys.includes(obj.key);
                  const downloadUrl = `${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(obj.key)}`;

                  return (
                    <tr
                      key={obj.id}
                      className={`hover:bg-[#131e33] transition-colors ${isSelected ? "bg-[#18263f]" : ""}`}
                    >
                      <td className="p-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedKeys((prev) =>
                              prev.includes(obj.key) ? prev.filter((k) => k !== obj.key) : [...prev, obj.key]
                            );
                          }}
                          className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900"
                        />
                      </td>

                      {/* Name / Key */}
                      <td className="p-3.5 font-medium text-slate-100">
                        <div className="flex items-center gap-2 group">
                          {getFileIcon(obj.mime_type, obj.key)}
                          <button
                            onClick={() => openPreview(obj)}
                            className="font-mono text-xs text-cyan-300 hover:text-cyan-200 hover:underline text-left cursor-pointer"
                          >
                            {obj.key}
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(obj.key);
                              showToast(`Copied key '${obj.key}' to clipboard`);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-300 ml-1"
                            title="Copy key"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </td>

                      {/* MIME Type */}
                      <td className="p-3.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                          {obj.mime_type}
                        </span>
                      </td>

                      {/* Last Modified */}
                      <td className="p-3.5 text-slate-400 font-mono text-[11px]">{formatDate(obj.created_at)}</td>

                      {/* Size */}
                      <td className="p-3.5 text-right font-mono text-slate-300">{formatBytes(obj.size_bytes)}</td>

                      {/* Actions */}
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openPreview(obj)}
                            className="p-1.5 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
                            title="Preview file"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <a
                            href={downloadUrl}
                            download={obj.key.split("/").pop()}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded text-slate-400 hover:text-emerald-300 hover:bg-slate-800 transition-colors"
                            title="Download file"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          <button
                            onClick={() => openPresignModal(obj)}
                            className="p-1.5 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors"
                            title="Share via Pre-signed URL"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setObjectToDelete(obj)}
                            className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                            title="Delete object"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* GENERATE PRE-SIGNED URL MODAL */}
      {presignObject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="bg-[#131c2e] border border-slate-700 rounded-xl shadow-2xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#162238]">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded bg-amber-500/20 text-amber-400">
                  <Link2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Generate Pre-signed URL</h3>
                  <p className="text-[11px] text-slate-400 font-mono truncate max-w-sm">{presignObject.key}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setPresignObject(null);
                  setPresignedData(null);
                }}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5 text-xs text-slate-300">
              <p className="text-slate-400 leading-relaxed">
                Pre-signed URLs grant temporary public access to download an object without requiring AWS credentials.
              </p>

              {/* Expiration Selectors */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-200">
                  Select link expiration window:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {EXPIRATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.seconds}
                      type="button"
                      onClick={() => {
                        setPresignExpiresIn(opt.seconds);
                        if (presignedData) {
                          handleGeneratePresignedUrl(opt.seconds);
                        }
                      }}
                      className={`p-2.5 rounded-lg border text-center transition-all ${
                        presignExpiresIn === opt.seconds
                          ? "bg-amber-950/60 border-amber-500 text-amber-200 shadow-sm shadow-amber-900/40"
                          : "bg-[#0b1322] border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <div className="font-semibold text-xs">{opt.label}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{opt.seconds}s</div>
                    </button>
                  ))}
                </div>
              </div>

              {presignError && (
                <div className="p-3 rounded bg-red-950/80 border border-red-800 text-red-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{presignError}</span>
                </div>
              )}

              {/* Generated Result Box */}
              {presignedData ? (
                <div className="p-4 bg-[#090f1a] border border-amber-900/60 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-amber-400" />
                      <span>Ready to Share</span>
                    </span>

                    {/* Active Countdown Badge */}
                    <div
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium border ${
                        countdownSeconds !== null && countdownSeconds > 0
                          ? "bg-amber-950/80 text-amber-300 border-amber-600/60"
                          : "bg-red-950/80 text-red-300 border-red-600/60"
                      }`}
                    >
                      <Timer className="w-3.5 h-3.5" />
                      <span>
                        {countdownSeconds !== null
                          ? countdownSeconds > 0
                            ? `Expires in: ${formatCountdown(countdownSeconds)}`
                            : "Expired"
                          : "Calculating..."}
                      </span>
                    </div>
                  </div>

                  {/* Complete Shareable URL */}
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={`${API_BASE}${presignedData.presigned_url}`}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-3 pr-24 py-2 font-mono text-[11px] text-amber-300/90 select-all focus:outline-none"
                    />
                    <div className="absolute right-1 top-1 flex items-center gap-1">
                      <button
                        onClick={() => {
                          const fullUrl = `${API_BASE}${presignedData.presigned_url}`;
                          navigator.clipboard.writeText(fullUrl);
                          setCopiedPresigned(true);
                          showToast("Pre-signed URL copied to clipboard!", "success");
                          setTimeout(() => setCopiedPresigned(false), 2500);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-amber-600 hover:bg-amber-500 text-slate-950 rounded transition-colors"
                      >
                        {copiedPresigned ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedPresigned ? "Copied!" : "Copy"}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>Token is cryptographically signed using HMAC-SHA256.</span>
                    <a
                      href={`${API_BASE}${presignedData.presigned_url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-400 hover:underline flex items-center gap-1"
                    >
                      <span>Test download</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 bg-[#0b1322] border border-slate-800 rounded-lg flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Cryptographic HMAC-SHA256 URL token</span>
                  </div>
                  <span className="text-[11px] text-slate-500">Secured</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-[#101827]">
              <button
                type="button"
                onClick={() => {
                  setPresignObject(null);
                  setPresignedData(null);
                }}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 border border-slate-700 rounded transition-colors"
              >
                Close
              </button>

              <button
                type="button"
                onClick={() => handleGeneratePresignedUrl()}
                disabled={presignLoading}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-slate-950 bg-[#ec7211] hover:bg-[#ff841f] active:bg-[#d6650b] rounded transition-colors disabled:opacity-50"
              >
                {presignLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <Link2 className="w-3.5 h-3.5" />
                    <span>{presignedData ? "Regenerate URL" : "Generate URL"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FILE PREVIEW MODAL */}
      {previewObject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="bg-[#131c2e] border border-slate-700 rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#162238]">
              <div className="flex items-center gap-2.5">
                {getFileIcon(previewObject.mime_type, previewObject.key)}
                <div>
                  <h3 className="text-sm font-semibold text-white font-mono">{previewObject.key}</h3>
                  <p className="text-[11px] text-slate-400">{previewObject.mime_type}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const target = previewObject;
                    setPreviewObject(null);
                    openPresignModal(target);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-300 bg-amber-950/70 hover:bg-amber-900/70 border border-amber-700/60 rounded transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share</span>
                </button>
                <a
                  href={`${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(previewObject.key)}`}
                  download={previewObject.key.split("/").pop()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
                <button onClick={() => setPreviewObject(null)} className="text-slate-400 hover:text-slate-200">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="min-h-[220px] max-h-[380px] flex items-center justify-center bg-[#090f1a] border border-slate-800 rounded-lg overflow-hidden">
                {previewLoading ? (
                  <div className="flex items-center gap-2 text-slate-400 text-xs">
                    <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                    <span>Loading preview...</span>
                  </div>
                ) : previewObject.mime_type.startsWith("image/") ? (
                  <img
                    src={`${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(previewObject.key)}`}
                    alt={previewObject.key}
                    className="max-h-[360px] max-w-full object-contain p-2"
                  />
                ) : previewContent !== null ? (
                  <pre className="w-full h-full max-h-[360px] overflow-auto p-4 text-xs font-mono text-slate-200 bg-slate-950/70 select-text whitespace-pre-wrap">
                    {previewContent}
                  </pre>
                ) : previewObject.mime_type === "application/pdf" ? (
                  <iframe
                    src={`${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(previewObject.key)}`}
                    className="w-full h-[360px] border-0"
                    title={previewObject.key}
                  />
                ) : (
                  <div className="p-8 text-center space-y-3">
                    <FileIcon className="w-12 h-12 text-slate-600 mx-auto" />
                    <div>
                      <p className="text-xs font-semibold text-slate-300">Raw Binary Object</p>
                      <p className="text-[11px] text-slate-500">
                        Inline viewer not available for this MIME type. Download the object to view locally.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-[#0a1220] border border-slate-800 rounded-lg space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block">Size</span>
                  <span className="font-mono text-slate-200">
                    {formatBytes(previewObject.size_bytes)} ({previewObject.size_bytes.toLocaleString()} bytes)
                  </span>
                </div>

                <div className="p-3 bg-[#0a1220] border border-slate-800 rounded-lg space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block">
                    Created / Uploaded At
                  </span>
                  <span className="font-mono text-slate-200">{formatDate(previewObject.created_at)}</span>
                </div>

                <div className="sm:col-span-2 p-3 bg-[#0a1220] border border-slate-800 rounded-lg space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                      SHA-256 Checksum
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(previewObject.content_hash);
                        showToast("Copied SHA-256 hash to clipboard");
                      }}
                      className="text-[10px] text-amber-400 hover:underline flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy hash</span>
                    </button>
                  </div>
                  <span className="font-mono text-[11px] text-amber-300/90 break-all select-all block">
                    {previewObject.content_hash}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-800 bg-[#101827] flex items-center justify-end">
              <button
                onClick={() => setPreviewObject(null)}
                className="px-4 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 border border-slate-700 rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE OBJECT MODAL */}
      {objectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="bg-[#131c2e] border border-red-900/60 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-red-950/30">
              <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3>Delete object</h3>
              </div>
              <button onClick={() => setObjectToDelete(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-3 text-xs text-slate-300">
              <p>
                Are you sure you want to permanently delete object{" "}
                <strong className="text-amber-300 font-mono break-all">{objectToDelete.key}</strong> from bucket{" "}
                <strong className="text-white font-mono">{bucketName}</strong>?
              </p>
              <p className="text-[11px] text-slate-500">
                This will delete the file blob from disk and remove its metadata record from the database.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-3.5 border-t border-slate-800 bg-[#101827]">
              <button
                type="button"
                onClick={() => setObjectToDelete(null)}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 border border-slate-700 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteObject}
                disabled={deleteSubmitting}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 active:bg-red-700 rounded transition-colors disabled:opacity-50"
              >
                {deleteSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete object</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
