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
  Share2,
  Link2,
  Timer,
  Check,
  Lock,
  Unlock,
  KeyRound,
  Zap,
  Terminal,
  Activity,
  Cpu,
  Layers,
  Sparkles,
  Clock,
  Radio,
  Play,
  RotateCcw,
} from "lucide-react";
import { encryptFileClientSide, decryptFileClientSide } from "@/lib/crypto";
import ConsoleHeader from "@/components/ConsoleHeader";

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

interface ExecutionLog {
  id: number;
  event_type: string;
  bucket_name: string;
  key: string;
  status: "SUCCESS" | "FAILED" | string;
  duration_ms: number;
  message: string;
  timestamp: string;
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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const API_BASE = API_BASE_URL;

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

  // Active view tab switcher: "objects" | "logs"
  const [activeTab, setActiveTab] = useState<"objects" | "logs">("objects");

  // Lambda & CloudWatch Execution Logs State
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [refreshingLogs, setRefreshingLogs] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ExecutionLog | null>(null);
  const [logSearchQuery, setLogSearchQuery] = useState("");
  const [logStatusFilter, setLogStatusFilter] = useState<"ALL" | "SUCCESS" | "FAILED">("ALL");
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);

  // Upload Zone state
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [customKey, setCustomKey] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Client-Side Zero-Knowledge Encryption State (Stage 5)
  const [encryptClientSide, setEncryptClientSide] = useState(false);
  const [encryptionPassphrase, setEncryptionPassphrase] = useState("");

  // Preview Modal state
  const [previewObject, setPreviewObject] = useState<S3Object | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [decryptedMediaUrl, setDecryptedMediaUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Decryption Prompt Modal state (Stage 5)
  const [decryptTargetObject, setDecryptTargetObject] = useState<S3Object | null>(null);
  const [decryptAction, setDecryptAction] = useState<"preview" | "download">("preview");
  const [decryptPassphrase, setDecryptPassphrase] = useState("");
  const [decryptLoading, setDecryptLoading] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);

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

  // Fetch CloudWatch Execution Logs
  const loadLogs = async (isManual = false) => {
    if (isManual) setRefreshingLogs(true);
    try {
      const res = await fetch(`${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/logs`);
      if (res.ok) {
        const data: ExecutionLog[] = await res.json();
        setLogs(data);
        if (data.length > 0) {
          setSelectedLog((prev) => {
            if (!prev) return data[0];
            const found = data.find((l) => l.id === prev.id);
            return found || data[0];
          });
        }
      }
    } catch (err: any) {
      console.error("Failed to load CloudWatch logs:", err);
    } finally {
      setLogsLoading(false);
      if (isManual) setRefreshingLogs(false);
    }
  };

  // Clear CloudWatch Execution Logs
  const handleClearLogs = async () => {
    setClearingLogs(true);
    try {
      const res = await fetch(`${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/logs`, {
        method: "DELETE",
      });
      if (res.ok) {
        setLogs([]);
        setSelectedLog(null);
        showToast("CloudWatch execution logs cleared", "success");
      } else {
        throw new Error("Failed to clear execution logs.");
      }
    } catch (err: any) {
      showToast(err.message || "Failed to clear logs", "error");
    } finally {
      setClearingLogs(false);
    }
  };

  useEffect(() => {
    if (bucketName) {
      loadData();
      loadLogs();
    }
  }, [bucketName]);

  // Auto-refresh CloudWatch logs effect
  useEffect(() => {
    if (!autoRefreshLogs || !bucketName) return;
    const interval = setInterval(() => {
      loadLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefreshLogs, bucketName]);

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

  // Clean up any generated blob URLs when closing preview
  useEffect(() => {
    return () => {
      if (decryptedMediaUrl) {
        URL.revokeObjectURL(decryptedMediaUrl);
      }
    };
  }, [decryptedMediaUrl]);

  // Filtered objects
  const filteredObjects = useMemo(() => {
    return objects.filter(
      (obj) =>
        obj.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        obj.mime_type.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [objects, searchQuery]);

  // Filtered execution logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesSearch =
        log.key.toLowerCase().includes(logSearchQuery.toLowerCase()) ||
        log.message.toLowerCase().includes(logSearchQuery.toLowerCase());
      const matchesStatus =
        logStatusFilter === "ALL" || log.status === logStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [logs, logSearchQuery, logStatusFilter]);

  // Log metrics summary
  const logMetrics = useMemo(() => {
    const total = logs.length;
    const success = logs.filter((l) => l.status === "SUCCESS").length;
    const failed = logs.filter((l) => l.status === "FAILED").length;
    const avgDuration =
      total > 0 ? Math.round(logs.reduce((sum, l) => sum + l.duration_ms, 0) / total) : 0;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 100;
    return { total, success, failed, avgDuration, successRate };
  }, [logs]);

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

  // Submit Upload with optional Client-Side Zero-Knowledge Encryption
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadFiles.length === 0) return;

    if (encryptClientSide && !encryptionPassphrase.trim()) {
      setUploadError("Passphrase is required when Client-Side Encryption is enabled.");
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        let file = uploadFiles[i];
        let isEncrypted = false;

        if (encryptClientSide) {
          file = await encryptFileClientSide(file, encryptionPassphrase.trim());
          isEncrypted = true;
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("is_encrypted", isEncrypted ? "true" : "false");

        if (uploadFiles.length === 1 && customKey.trim()) {
          formData.append("key", customKey.trim());
        } else {
          formData.append("key", uploadFiles[i].name);
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

      showToast(
        `Successfully uploaded ${uploadFiles.length} file(s) ${
          encryptClientSide ? "(Encrypted with AES-GCM 256-bit)" : ""
        }!`,
        "success"
      );
      setUploadFiles([]);
      setCustomKey("");
      setEncryptionPassphrase("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadData();
      loadLogs();
      // Allow simulated asynchronous Lambda BackgroundTask to complete
      setTimeout(() => {
        loadData();
        loadLogs();
      }, 1200);
      setTimeout(() => {
        loadData();
        loadLogs();
      }, 2500);
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // Open Preview Modal (Direct or Decrypted)
  const openPreview = async (obj: S3Object) => {
    if (obj.is_encrypted) {
      // Prompt user for passphrase
      setDecryptTargetObject(obj);
      setDecryptAction("preview");
      setDecryptPassphrase("");
      setDecryptError(null);
      return;
    }

    if (decryptedMediaUrl) {
      URL.revokeObjectURL(decryptedMediaUrl);
      setDecryptedMediaUrl(null);
    }

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

  // Trigger download (Direct or Decrypted)
  const handleDownloadClick = async (obj: S3Object) => {
    if (obj.is_encrypted) {
      setDecryptTargetObject(obj);
      setDecryptAction("download");
      setDecryptPassphrase("");
      setDecryptError(null);
      return;
    }

    // Direct download
    const url = `${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(obj.key)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = obj.key.split("/").pop() || "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Execute Decryption for Preview or Download
  const handleExecuteDecryption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decryptTargetObject) return;

    if (!decryptPassphrase.trim()) {
      setDecryptError("Please enter your secret passphrase.");
      return;
    }

    setDecryptLoading(true);
    setDecryptError(null);

    try {
      const res = await fetch(
        `${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(
          decryptTargetObject.key
        )}`
      );

      if (!res.ok) {
        throw new Error("Failed to fetch encrypted object blob from server.");
      }

      const encryptedBuffer = await res.arrayBuffer();
      const plaintextBuffer = await decryptFileClientSide(encryptedBuffer, decryptPassphrase.trim());

      showToast("Decryption successful!", "success");

      if (decryptAction === "download") {
        const blob = new Blob([plaintextBuffer], { type: decryptTargetObject.mime_type });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = decryptTargetObject.key.split("/").pop() || "decrypted_file";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);

        setDecryptTargetObject(null);
        setDecryptPassphrase("");
      } else {
        // Preview mode
        if (decryptedMediaUrl) {
          URL.revokeObjectURL(decryptedMediaUrl);
        }

        const isText =
          decryptTargetObject.mime_type.startsWith("text/") ||
          decryptTargetObject.mime_type.includes("json") ||
          decryptTargetObject.mime_type.includes("javascript") ||
          decryptTargetObject.mime_type.includes("python") ||
          decryptTargetObject.mime_type.includes("xml") ||
          decryptTargetObject.mime_type.includes("csv") ||
          decryptTargetObject.key.endsWith(".md") ||
          decryptTargetObject.key.endsWith(".txt") ||
          decryptTargetObject.key.endsWith(".json");

        if (isText) {
          const text = new TextDecoder().decode(plaintextBuffer);
          setPreviewContent(text);
          setDecryptedMediaUrl(null);
        } else {
          const blob = new Blob([plaintextBuffer], { type: decryptTargetObject.mime_type });
          const blobUrl = URL.createObjectURL(blob);
          setDecryptedMediaUrl(blobUrl);
          setPreviewContent(null);
        }

        const target = decryptTargetObject;
        setDecryptTargetObject(null);
        setDecryptPassphrase("");
        setPreviewObject(target);
      }
    } catch (err: any) {
      setDecryptError(err.message || "Decryption failed. Incorrect passphrase or corrupted data.");
    } finally {
      setDecryptLoading(false);
    }
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
        `${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(
          presignObject.key
        )}/presign`,
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
        `${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(
          objectToDelete.key
        )}`,
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
      <ConsoleHeader
        region={bucketMeta?.region || "us-east-1"}
        isBackendHealthy={!loading}
      />

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

        {/* AWS Service Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800">
          <button
            onClick={() => setActiveTab("objects")}
            className={`inline-flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "objects"
                ? "border-amber-500 text-amber-400 bg-amber-950/15"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>Objects</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
              {objects.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab("logs");
              loadLogs(true);
            }}
            className={`inline-flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "logs"
                ? "border-amber-500 text-amber-400 bg-amber-950/15"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
            }`}
          >
            <Zap className={`w-4 h-4 ${activeTab === "logs" ? "text-amber-400 fill-amber-400" : "text-slate-400"}`} />
            <span>Lambda Triggers & CloudWatch Logs</span>
            {logs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-950/80 border border-amber-600/50 text-amber-300">
                {logs.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === "objects" && (
          <div className="space-y-6">
            {/* Upload Zone with Client-Side Encryption Toggle */}
            <section className="bg-[#121c2e] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-amber-400" />
              <h2 className="text-sm font-semibold text-white">Upload objects</h2>
            </div>
            <span className="text-[11px] text-slate-400">Content-Addressable Deduplication Enabled</span>
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
                  Blobs are stored under <code className="text-slate-400">storage/blobs/&lt;sha256&gt;</code> with instant
                  zero-overhead deduplication.
                </p>
              </div>
            </div>

            {/* Zero-Knowledge Client-Side Encryption Toggle Card */}
            <div className="p-3.5 bg-[#0a1220] border border-slate-800 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={encryptClientSide}
                    onChange={(e) => setEncryptClientSide(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                  />
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <Lock className={`w-3.5 h-3.5 ${encryptClientSide ? "text-emerald-400" : "text-slate-400"}`} />
                    <span>Client-Side Encryption (Zero-Knowledge)</span>
                  </div>
                </label>
                <span className="text-[10px] text-slate-500 font-mono">Web Crypto AES-GCM 256-bit</span>
              </div>

              {encryptClientSide && (
                <div className="pt-1 space-y-1.5 animate-in fade-in duration-150">
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="password"
                      required
                      placeholder="Enter secret passphrase (never sent to server)..."
                      value={encryptionPassphrase}
                      onChange={(e) => setEncryptionPassphrase(e.target.value)}
                      className="w-full bg-slate-950 border border-emerald-700/60 rounded pl-9 pr-3 py-1.5 text-xs font-mono text-emerald-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                  <p className="text-[10px] text-emerald-400/80">
                    🔒 Payload bytes will be encrypted locally in your browser before upload using PBKDF2 (100k rounds) +
                    AES-GCM. The plaintext will NEVER touch the network or disk.
                  </p>
                </div>
              )}
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
                        <span>{encryptClientSide ? "Encrypting & Uploading..." : "Uploading..."}</span>
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

                      {/* Name / Key + Lock Badge */}
                      <td className="p-3.5 font-medium text-slate-100">
                        <div className="flex items-center gap-2 group flex-wrap">
                          {getFileIcon(obj.mime_type, obj.key)}
                          <button
                            onClick={() => openPreview(obj)}
                            className="font-mono text-xs text-cyan-300 hover:text-cyan-200 hover:underline text-left cursor-pointer"
                          >
                            {obj.key}
                          </button>

                          {(obj.key.startsWith("thumb_") || obj.key.startsWith("parsed_")) && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-950/90 border border-amber-500/50 text-amber-300 shadow-xs shadow-amber-950">
                              <Zap className="w-2.5 h-2.5 fill-amber-400 text-amber-400 shrink-0" />
                              <span>⚡ Lambda Processed</span>
                            </span>
                          )}

                          {obj.is_encrypted && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-950/80 border border-emerald-500/50 text-emerald-300">
                              <Lock className="w-2.5 h-2.5" />
                              <span>Encrypted</span>
                            </span>
                          )}

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
                            title={obj.is_encrypted ? "Decrypt & Preview" : "Preview file"}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDownloadClick(obj)}
                            className="p-1.5 rounded text-slate-400 hover:text-emerald-300 hover:bg-slate-800 transition-colors"
                            title={obj.is_encrypted ? "Decrypt & Download" : "Download file"}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
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
    )}

    {/* Lambda Triggers & CloudWatch Logs Tab View */}
    {activeTab === "logs" && (
      <div className="space-y-6 animate-in fade-in duration-150">
        {/* AWS Lambda Pipeline Header & Architecture Card */}
        <div className="bg-[#121c2e] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
                <Zap className="w-6 h-6 fill-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white font-mono">
                    AWS Lambda & CloudWatch Event Pipeline
                  </h2>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/80 border border-emerald-500/50 text-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Active Trigger
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Trigger Event: <code className="text-amber-300 font-mono">s3:ObjectCreated:Put</code> on bucket{" "}
                  <code className="text-white font-mono">{bucketName}</code>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 text-xs">
              <button
                onClick={() => setAutoRefreshLogs(!autoRefreshLogs)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-medium transition-colors ${
                  autoRefreshLogs
                    ? "bg-amber-950/80 border-amber-500/60 text-amber-300 shadow-sm shadow-amber-950"
                    : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
                }`}
                title="Auto-refresh logs every 3 seconds"
              >
                <Radio className={`w-3.5 h-3.5 ${autoRefreshLogs ? "text-amber-400 animate-pulse" : ""}`} />
                <span>{autoRefreshLogs ? "Live Stream (3s)" : "Enable Live Stream"}</span>
              </button>

              <button
                onClick={() => loadLogs(true)}
                disabled={refreshingLogs}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-[#ec7211] hover:bg-[#ff841f] active:bg-[#d6650b] rounded transition-colors disabled:opacity-50"
                title="Refresh CloudWatch execution logs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshingLogs ? "animate-spin" : ""}`} />
                <span>Refresh Logs</span>
              </button>
            </div>
          </div>

          {/* 3 Simulated Lambda Handlers Rules */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 bg-[#0a1220] border border-slate-800 rounded-lg space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
                <FileImage className="w-3.5 h-3.5 text-cyan-400" />
                <span>Image Handler (Pillow)</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Generates compressed 200x200 thumbnail saved as{" "}
                <code className="text-amber-300 font-mono">thumb_&lt;key&gt;</code> in the same bucket.
              </p>
            </div>

            <div className="p-3 bg-[#0a1220] border border-slate-800 rounded-lg space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>CSV Transformer</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Parses first 50 rows into JSON and creates companion object{" "}
                <code className="text-amber-300 font-mono">parsed_&lt;key&gt;.json</code>.
              </p>
            </div>

            <div className="p-3 bg-[#0a1220] border border-slate-800 rounded-lg space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                <span>Plaintext Metrics</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Calculates word count, line count, and character volume in CloudWatch execution report.
              </p>
            </div>
          </div>

          {/* Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div className="p-2.5 bg-[#090f1a] border border-slate-800/80 rounded-lg">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
                Total Invocations
              </span>
              <span className="text-base font-bold text-white font-mono">{logMetrics.total}</span>
            </div>

            <div className="p-2.5 bg-[#090f1a] border border-slate-800/80 rounded-lg">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
                Success Rate
              </span>
              <span className="text-base font-bold text-emerald-400 font-mono">
                {logMetrics.total > 0 ? `${logMetrics.successRate}%` : "100%"}
              </span>
            </div>

            <div className="p-2.5 bg-[#090f1a] border border-slate-800/80 rounded-lg">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
                Avg Duration
              </span>
              <span className="text-base font-bold text-amber-300 font-mono">
                {logMetrics.total > 0 ? `${logMetrics.avgDuration} ms` : "0 ms"}
              </span>
            </div>

            <div className="p-2.5 bg-[#090f1a] border border-slate-800/80 rounded-lg">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
                Memory Size
              </span>
              <span className="text-base font-bold text-cyan-300 font-mono">128 MB</span>
            </div>
          </div>
        </div>

        {/* Toolbar for Search & Status Filter */}
        <div className="bg-[#121c2e] border border-slate-800 rounded-lg p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search triggers by object key or log text..."
              value={logSearchQuery}
              onChange={(e) => setLogSearchQuery(e.target.value)}
              className="w-full bg-[#0b1322] border border-slate-700 rounded pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            {logSearchQuery && (
              <button
                onClick={() => setLogSearchQuery("")}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-200 text-xs"
              >
                &times;
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center border border-slate-700 rounded p-0.5 bg-[#0b1322] text-xs">
              <button
                onClick={() => setLogStatusFilter("ALL")}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  logStatusFilter === "ALL"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                All ({logMetrics.total})
              </button>
              <button
                onClick={() => setLogStatusFilter("SUCCESS")}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  logStatusFilter === "SUCCESS"
                    ? "bg-emerald-950 text-emerald-300 border border-emerald-600/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Success ({logMetrics.success})
              </button>
              <button
                onClick={() => setLogStatusFilter("FAILED")}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  logStatusFilter === "FAILED"
                    ? "bg-red-950 text-red-300 border border-red-600/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Failed ({logMetrics.failed})
              </button>
            </div>

            {logs.length > 0 && (
              <button
                onClick={handleClearLogs}
                disabled={clearingLogs}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-400 hover:text-red-400 hover:bg-red-950/30 border border-slate-800 rounded transition-colors"
                title="Clear execution logs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        {/* Split View: Trigger Table on Left, Live CloudWatch Terminal on Right */}
        {filteredLogs.length === 0 ? (
          <div className="p-16 border border-slate-800 rounded-xl bg-[#0f1728] text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
              <Zap className="w-6 h-6 fill-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-200">
                {logs.length === 0 ? "No Lambda Trigger Events Yet" : "No matching log records found"}
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                {logs.length === 0
                  ? "Upload an image (PNG/JPEG), CSV spreadsheet, or text document in the Objects tab to trigger the AWS Lambda and CloudWatch event pipeline."
                  : `No execution logs matched your filter '${logSearchQuery}'.`}
              </p>
            </div>
            {logs.length === 0 && (
              <button
                onClick={() => setActiveTab("objects")}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-950 bg-[#ec7211] hover:bg-[#ff841f] rounded transition-colors"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Go to Upload Zone</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: Events Table (5 cols on lg) */}
            <div className="lg:col-span-5 bg-[#0f1728] border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div className="px-4 py-3 bg-[#162238] border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-amber-400" />
                  <h3 className="text-xs font-semibold text-white">Trigger Invocations</h3>
                </div>
                <span className="text-[11px] text-slate-400 font-mono">
                  Showing {filteredLogs.length} events
                </span>
              </div>

              <div className="divide-y divide-slate-800/80 max-h-[580px] overflow-y-auto">
                {filteredLogs.map((log) => {
                  const isSelected = selectedLog?.id === log.id;
                  return (
                    <div
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className={`p-3.5 cursor-pointer transition-all ${
                        isSelected
                          ? "bg-[#18263f] border-l-4 border-amber-500 shadow-inner"
                          : "hover:bg-[#131d2e]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold font-mono border ${
                            log.status === "SUCCESS"
                              ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/50"
                              : "bg-red-950/80 text-red-300 border-red-500/50"
                          }`}
                        >
                          {log.status === "SUCCESS" ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <XCircle className="w-3 h-3 text-red-400" />
                          )}
                          <span>{log.status}</span>
                        </span>

                        <span className="font-mono text-[11px] text-amber-400 font-semibold">
                          {log.duration_ms} ms
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className="font-mono text-xs text-white font-medium truncate flex-1"
                          title={log.key}
                        >
                          {log.key}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 font-mono">
                        <span>{log.event_type}</span>
                        <span>{formatDate(log.timestamp)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Live CloudWatch Terminal (7 cols on lg) */}
            <div className="lg:col-span-7 bg-[#070d17] border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col min-h-[500px]">
              {/* Terminal Title Bar */}
              <div className="bg-[#101726] px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="text-slate-500 mx-1">|</span>
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-mono text-slate-300 truncate max-w-xs sm:max-w-md">
                    /aws/lambda/s3-pipeline {selectedLog ? `› [log-id:${selectedLog.id}]` : ""}
                  </span>
                </div>

                {selectedLog && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedLog.message);
                      showToast("Copied raw CloudWatch logs to clipboard", "success");
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                    title="Copy raw log output"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy Logs</span>
                  </button>
                )}
              </div>

              {/* Terminal Body */}
              <div className="p-4 font-mono text-xs overflow-x-auto flex-1 select-text bg-[#070d17] max-h-[550px] overflow-y-auto">
                {selectedLog ? (
                  <div className="space-y-1">
                    {selectedLog.message.split("\n").map((line, idx) => {
                      if (line.startsWith("START")) {
                        return (
                          <div key={idx} className="text-cyan-400 font-semibold flex items-start gap-2">
                            <span className="text-slate-600 select-none w-6 text-right shrink-0">
                              {idx + 1}
                            </span>
                            <span>{line}</span>
                          </div>
                        );
                      }
                      if (line.startsWith("END")) {
                        return (
                          <div key={idx} className="text-cyan-400/80 font-semibold flex items-start gap-2">
                            <span className="text-slate-600 select-none w-6 text-right shrink-0">
                              {idx + 1}
                            </span>
                            <span>{line}</span>
                          </div>
                        );
                      }
                      if (line.startsWith("REPORT")) {
                        return (
                          <div
                            key={idx}
                            className="text-amber-300 font-bold bg-amber-950/40 border border-amber-800/60 rounded p-2.5 my-2 flex items-start gap-2"
                          >
                            <span className="text-amber-600 select-none w-6 text-right shrink-0">
                              {idx + 1}
                            </span>
                            <span>{line}</span>
                          </div>
                        );
                      }
                      if (line.includes("ERROR")) {
                        return (
                          <div key={idx} className="text-red-400 font-medium flex items-start gap-2">
                            <span className="text-red-700 select-none w-6 text-right shrink-0">
                              {idx + 1}
                            </span>
                            <span>{line}</span>
                          </div>
                        );
                      }
                      if (line.includes("INFO")) {
                        const parts = line.split("INFO");
                        return (
                          <div key={idx} className="text-slate-300 flex items-start gap-2">
                            <span className="text-slate-600 select-none w-6 text-right shrink-0">
                              {idx + 1}
                            </span>
                            <span>
                              <span className="text-slate-500">{parts[0]}</span>
                              <span className="text-sky-400 font-semibold">INFO</span>
                              <span className="text-slate-200">{parts.slice(1).join("INFO")}</span>
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div key={idx} className="text-slate-400 flex items-start gap-2">
                          <span className="text-slate-600 select-none w-6 text-right shrink-0">
                            {idx + 1}
                          </span>
                          <span>{line}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 text-slate-500 space-y-3">
                    <Terminal className="w-10 h-10 text-slate-600" />
                    <p className="text-xs">
                      Select an event from the trigger log list to view its CloudWatch stream.
                    </p>
                  </div>
                )}
              </div>

              {/* Terminal Footer Info */}
              {selectedLog && (
                <div className="px-4 py-2 border-t border-slate-800 bg-[#090f1a] text-[11px] font-mono text-slate-500 flex items-center justify-between">
                  <span>
                    Status:{" "}
                    <span
                      className={
                        selectedLog.status === "SUCCESS"
                          ? "text-emerald-400 font-semibold"
                          : "text-red-400 font-semibold"
                      }
                    >
                      {selectedLog.status}
                    </span>
                  </span>
                  <span>Duration: {selectedLog.duration_ms} ms</span>
                  <span>Memory: 128 MB</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )}
  </div>

      {/* DECRYPTION PROMPT MODAL (Stage 5) */}
      {decryptTargetObject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="bg-[#131c2e] border border-emerald-700/60 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-emerald-950/30">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                <Lock className="w-5 h-5 shrink-0" />
                <h3>Zero-Knowledge Decryption Required</h3>
              </div>
              <button
                onClick={() => {
                  setDecryptTargetObject(null);
                  setDecryptPassphrase("");
                }}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteDecryption}>
              <div className="p-6 space-y-4 text-xs text-slate-300">
                <p className="leading-relaxed">
                  The object <strong className="text-amber-300 font-mono">{decryptTargetObject.key}</strong> was encrypted
                  client-side using AES-GCM 256-bit. Please enter your secret passphrase to decrypt and{" "}
                  {decryptAction === "preview" ? "preview" : "download"} it.
                </p>

                <div className="space-y-1.5">
                  <label className="block text-slate-200 font-semibold">Passphrase</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="password"
                      autoFocus
                      required
                      placeholder="Enter passphrase..."
                      value={decryptPassphrase}
                      onChange={(e) => setDecryptPassphrase(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded pl-9 pr-3 py-2 text-xs font-mono text-emerald-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {decryptError && (
                  <div className="p-2.5 rounded bg-red-950/80 border border-red-800 text-red-200 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{decryptError}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-3.5 border-t border-slate-800 bg-[#101827]">
                <button
                  type="button"
                  onClick={() => {
                    setDecryptTargetObject(null);
                    setDecryptPassphrase("");
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 border border-slate-700 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={decryptLoading}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 rounded transition-colors disabled:opacity-50"
                >
                  {decryptLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Decrypting...</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-3.5 h-3.5" />
                      <span>{decryptAction === "preview" ? "Decrypt & Preview" : "Decrypt & Download"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GENERATE PRE-SIGNED URL MODAL */}
      {presignObject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="bg-[#131c2e] border border-slate-700 rounded-xl shadow-2xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
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

            <div className="p-6 space-y-5 text-xs text-slate-300">
              <p className="text-slate-400 leading-relaxed">
                Pre-signed URLs grant temporary public access to download an object without requiring credentials.
              </p>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-200">Select link expiration window:</label>
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

              {presignedData ? (
                <div className="p-4 bg-[#090f1a] border border-amber-900/60 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-amber-400" />
                      <span>Ready to Share</span>
                    </span>

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
                  <h3 className="text-sm font-semibold text-white font-mono flex items-center gap-2">
                    <span>{previewObject.key}</span>
                    {previewObject.is_encrypted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-500/50 text-emerald-300 font-sans font-normal">
                        Decrypted in-memory
                      </span>
                    )}
                  </h3>
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
                <button
                  onClick={() => handleDownloadClick(previewObject)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
                <button
                  onClick={() => {
                    if (decryptedMediaUrl) {
                      URL.revokeObjectURL(decryptedMediaUrl);
                      setDecryptedMediaUrl(null);
                    }
                    setPreviewObject(null);
                  }}
                  className="text-slate-400 hover:text-slate-200"
                >
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
                ) : decryptedMediaUrl ? (
                  previewObject.mime_type.startsWith("image/") ? (
                    <img
                      src={decryptedMediaUrl}
                      alt={previewObject.key}
                      className="max-h-[360px] max-w-full object-contain p-2"
                    />
                  ) : previewObject.mime_type === "application/pdf" ? (
                    <iframe src={decryptedMediaUrl} className="w-full h-[360px] border-0" title={previewObject.key} />
                  ) : (
                    <div className="p-8 text-center space-y-2">
                      <FileIcon className="w-12 h-12 text-slate-600 mx-auto" />
                      <p className="text-xs text-slate-300 font-semibold">Decrypted Binary Object</p>
                      <button
                        onClick={() => handleDownloadClick(previewObject)}
                        className="text-xs text-emerald-400 hover:underline"
                      >
                        Download decrypted file
                      </button>
                    </div>
                  )
                ) : previewObject.mime_type.startsWith("image/") && !previewObject.is_encrypted ? (
                  <img
                    src={`${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(
                      previewObject.key
                    )}`}
                    alt={previewObject.key}
                    className="max-h-[360px] max-w-full object-contain p-2"
                  />
                ) : previewContent !== null ? (
                  <pre className="w-full h-full max-h-[360px] overflow-auto p-4 text-xs font-mono text-slate-200 bg-slate-950/70 select-text whitespace-pre-wrap">
                    {previewContent}
                  </pre>
                ) : previewObject.mime_type === "application/pdf" && !previewObject.is_encrypted ? (
                  <iframe
                    src={`${API_BASE}/api/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(
                      previewObject.key
                    )}`}
                    className="w-full h-[360px] border-0"
                    title={previewObject.key}
                  />
                ) : (
                  <div className="p-8 text-center space-y-3">
                    <FileIcon className="w-12 h-12 text-slate-600 mx-auto" />
                    <div>
                      <p className="text-xs font-semibold text-slate-300">Raw Binary Object</p>
                      <p className="text-[11px] text-slate-500">
                        {previewObject.is_encrypted
                          ? "This file is encrypted. Use Decrypt & Download to access contents."
                          : "Inline viewer not available for this MIME type. Download the object to view locally."}
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
                      SHA-256 Checksum (Content-Addressable ID)
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
                onClick={() => {
                  if (decryptedMediaUrl) {
                    URL.revokeObjectURL(decryptedMediaUrl);
                    setDecryptedMediaUrl(null);
                  }
                  setPreviewObject(null);
                }}
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
                If other objects share this identical content hash, the underlying physical blob will be preserved via
                deduplication reference counting.
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
