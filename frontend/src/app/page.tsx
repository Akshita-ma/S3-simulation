"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import ConsoleHeader from "@/components/ConsoleHeader";
import {
  Folder,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Copy,
  ExternalLink,
  Shield,
  Database,
  Globe,
  HardDrive,
  Info,
  X,
  Loader2,
} from "lucide-react";

interface Bucket {
  id: number;
  name: string;
  region: string;
  created_at: string;
  object_count: number;
  total_size_bytes: number;
}

interface StorageStats {
  logical_size_bytes: number;
  physical_size_bytes: number;
  saved_space_bytes: number;
  dedup_ratio: string;
  total_objects: number;
  unique_blobs: number;
  encrypted_objects_count: number;
}

const REGION_OPTIONS = [
  { value: "us-east-1", label: "US East (N. Virginia) us-east-1" },
  { value: "us-west-2", label: "US West (Oregon) us-west-2" },
  { value: "eu-west-1", label: "Europe (Ireland) eu-west-1" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore) ap-southeast-1" },
  { value: "ap-south-1", label: "Asia Pacific (Mumbai) ap-south-1" },
  { value: "sa-east-1", label: "South America (São Paulo) sa-east-1" },
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
      second: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return dateStr;
  }
}

export default function S3BucketsConsole() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBucketNames, setSelectedBucketNames] = useState<string[]>([]);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [bucketToDelete, setBucketToDelete] = useState<Bucket | null>(null);

  // Create Form State
  const [newBucketName, setNewBucketName] = useState("");
  const [newBucketRegion, setNewBucketRegion] = useState("us-east-1");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete Form State
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  // Fetch Buckets and Stats
  const fetchBuckets = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      const [bucketsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/buckets`),
        fetch(`${API_BASE}/api/stats`),
      ]);

      if (!bucketsRes.ok) {
        throw new Error(`Failed to load buckets: ${bucketsRes.statusText}`);
      }
      const data: Bucket[] = await bucketsRes.json();
      setBuckets(data);

      if (statsRes.ok) {
        const statsData: StorageStats = await statsRes.json();
        setStats(statsData);
      }
    } catch (err: any) {
      showToast(err.message || "Failed to connect to backend", "error");
    } finally {
      setLoading(false);
      if (isManualRefresh) setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBuckets();
  }, []);

  // Filtered Buckets
  const filteredBuckets = useMemo(() => {
    return buckets.filter((b) =>
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.region.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [buckets, searchQuery]);

  // Validation rules for S3 bucket name
  const validation = useMemo(() => {
    const name = newBucketName;
    const lenValid = name.length >= 3 && name.length <= 63;
    const noHyphenEnds = !name.startsWith("-") && !name.endsWith("-");
    const allowedCharsOnly = /^[a-z0-9-]+$/.test(name);
    const noUppercaseOrSpaces = !/[A-Z\s_.]/.test(name);
    const fullRegexValid = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name);

    const isValid = lenValid && noHyphenEnds && allowedCharsOnly && noUppercaseOrSpaces && fullRegexValid;

    return {
      lenValid,
      noHyphenEnds,
      allowedCharsOnly,
      noUppercaseOrSpaces,
      isValid,
    };
  }, [newBucketName]);

  // Handle Bucket Creation
  const handleCreateBucket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validation.isValid) return;

    setCreateSubmitting(true);
    setCreateError(null);

    try {
      const res = await fetch(`${API_BASE}/api/buckets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBucketName.trim(),
          region: newBucketRegion,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to create bucket.");
      }

      showToast(`Bucket '${data.name}' created successfully!`, "success");
      setIsCreateModalOpen(false);
      setNewBucketName("");
      setNewBucketRegion("us-east-1");
      fetchBuckets();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreateSubmitting(false);
    }
  };

  // Open Delete Modal
  const openDeleteModal = (bucket: Bucket) => {
    setBucketToDelete(bucket);
    setDeleteConfirmationInput("");
    setDeleteError(null);
    setIsDeleteModalOpen(true);
  };

  // Handle Bucket Deletion
  const handleDeleteBucket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bucketToDelete) return;

    if (deleteConfirmationInput.trim() !== bucketToDelete.name) {
      setDeleteError(`Type '${bucketToDelete.name}' exactly to confirm deletion.`);
      return;
    }

    setDeleteSubmitting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`${API_BASE}/api/buckets/${encodeURIComponent(bucketToDelete.name)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to delete bucket");
      }

      showToast(`Bucket '${bucketToDelete.name}' deleted successfully.`, "success");
      setIsDeleteModalOpen(false);
      setBucketToDelete(null);
      setSelectedBucketNames((prev) => prev.filter((n) => n !== bucketToDelete.name));
      fetchBuckets();
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // Toggle selection
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedBucketNames(filteredBuckets.map((b) => b.name));
    } else {
      setSelectedBucketNames([]);
    }
  };

  const handleSelectOne = (name: string) => {
    setSelectedBucketNames((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
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
      <ConsoleHeader region="us-east-1" isBackendHealthy={!loading} />

      {/* Breadcrumb Bar */}
      <div className="bg-[#101827] border-b border-slate-800/80 px-6 py-2.5 text-xs text-slate-400 flex items-center gap-2">
        <span className="hover:text-slate-200 cursor-pointer">Amazon S3</span>
        <span>&rsaquo;</span>
        <span className="text-amber-400 font-medium">Buckets</span>
      </div>

      {/* Main Console Content */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* S3 Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
              <span>Buckets</span>
              <span className="text-slate-400 text-lg font-normal">({buckets.length})</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Buckets are containers for data stored in Smart Vault S3. You can store any number of objects in a bucket and can have up to 100 buckets in your account.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => fetchBuckets(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 rounded transition-colors disabled:opacity-50"
              title="Refresh buckets"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
              <span>Refresh</span>
            </button>

            {selectedBucketNames.length > 0 && (
              <button
                onClick={() => {
                  const target = buckets.find((b) => b.name === selectedBucketNames[0]);
                  if (target) openDeleteModal(target);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-300 bg-red-950/60 hover:bg-red-900/60 border border-red-700/60 rounded transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span>Delete ({selectedBucketNames.length})</span>
              </button>
            )}

            <button
              onClick={() => {
                setNewBucketName("");
                setNewBucketRegion("us-east-1");
                setCreateError(null);
                setIsCreateModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-[#ec7211] hover:bg-[#ff841f] active:bg-[#d6650b] rounded transition-colors shadow-md shadow-amber-900/20"
            >
              <Plus className="w-4 h-4" />
              <span>Create bucket</span>
            </button>
          </div>
        </div>

        {/* Vault Storage Optimization (Stage 5 Enhancement Widget) */}
        {stats && (
          <section className="bg-[#121c2e] border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg shadow-black/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <span>Vault Storage Optimization</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-600/50 text-emerald-300 font-normal">
                      Active
                    </span>
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Content-Addressable Block Deduplication & Client-Side Zero-Knowledge Encryption metrics
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400 text-[11px]">Deduplication Savings:</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">{stats.dedup_ratio}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-1">
              {/* Space Saved Card */}
              <div className="p-3.5 rounded-lg bg-[#0b1322] border border-slate-800/90 space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-semibold tracking-wider">Total Space Saved</span>
                  <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="text-xl font-bold text-emerald-400 font-mono">
                  {formatBytes(stats.saved_space_bytes)}
                </div>
                <p className="text-[10px] text-slate-500">
                  {stats.dedup_ratio} physical capacity spared
                </p>
              </div>

              {/* Deduplication Consolidations */}
              <div className="p-3.5 rounded-lg bg-[#0b1322] border border-slate-800/90 space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-semibold tracking-wider">Objects vs Blobs</span>
                  <Copy className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div className="text-xl font-bold text-white font-mono">
                  {stats.total_objects} <span className="text-xs text-slate-400 font-normal">objects</span> / {stats.unique_blobs}{" "}
                  <span className="text-xs text-slate-400 font-normal">blobs</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  {stats.total_objects - stats.unique_blobs} deduplicated object references
                </p>
              </div>

              {/* Active Zero-Knowledge Encryption */}
              <div className="p-3.5 rounded-lg bg-[#0b1322] border border-slate-800/90 space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-semibold tracking-wider">Encrypted Objects</span>
                  <Shield className="w-3.5 h-3.5 text-violet-400" />
                </div>
                <div className="text-xl font-bold text-violet-300 font-mono">
                  {stats.encrypted_objects_count}
                </div>
                <p className="text-[10px] text-slate-500">
                  Client-side AES-GCM 256-bit protected
                </p>
              </div>

              {/* Physical Disk Usage */}
              <div className="p-3.5 rounded-lg bg-[#0b1322] border border-slate-800/90 space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-semibold tracking-wider">Physical Storage</span>
                  <Database className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div className="text-xl font-bold text-slate-200 font-mono">
                  {formatBytes(stats.physical_size_bytes)}
                </div>
                <p className="text-[10px] text-slate-500">
                  Logical Capacity: {formatBytes(stats.logical_size_bytes)}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Filter Toolbar */}
        <div className="bg-[#121c2e] border border-slate-800 rounded-t-lg p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Find buckets by name or region..."
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
              Showing {filteredBuckets.length} of {buckets.length} bucket{buckets.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {/* Bucket Table */}
        <div className="border border-slate-800 border-t-0 rounded-b-lg overflow-x-auto bg-[#0f1728]">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-[#162238] border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold text-[11px]">
              <tr>
                <th scope="col" className="p-3.5 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredBuckets.length > 0 &&
                      selectedBucketNames.length === filteredBuckets.length
                    }
                    onChange={handleSelectAll}
                    className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900"
                  />
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200">
                  Name
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200">
                  AWS Region
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200">
                  Creation date
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200 text-right">
                  Objects
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200 text-right">
                  Total size
                </th>
                <th scope="col" className="p-3.5 font-medium text-slate-200 text-center w-24">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                      <span>Loading buckets...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredBuckets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Folder className="w-10 h-10 text-slate-600 stroke-[1.2]" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-300">
                          {searchQuery ? "No matching buckets found" : "No buckets found"}
                        </p>
                        <p className="text-xs text-slate-500 max-w-sm">
                          {searchQuery
                            ? `No buckets match the term '${searchQuery}'. Try clearing your search.`
                            : "You do not have any buckets yet. Create your first bucket to store objects."}
                        </p>
                      </div>
                      {!searchQuery && (
                        <button
                          onClick={() => {
                            setNewBucketName("");
                            setNewBucketRegion("us-east-1");
                            setCreateError(null);
                            setIsCreateModalOpen(true);
                          }}
                          className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-[#ec7211] hover:bg-[#ff841f] rounded"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Create bucket</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredBuckets.map((bucket) => {
                  const isSelected = selectedBucketNames.includes(bucket.name);
                  return (
                    <tr
                      key={bucket.id}
                      className={`hover:bg-[#131e33] transition-colors ${
                        isSelected ? "bg-[#18263f]" : ""
                      }`}
                    >
                      <td className="p-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectOne(bucket.name)}
                          className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900"
                        />
                      </td>
                      <td className="p-3.5 font-medium text-slate-100">
                        <div className="flex items-center gap-2 group">
                          <Folder className="w-4 h-4 text-amber-500 fill-amber-500/20 shrink-0" />
                          <Link
                            href={`/buckets/${encodeURIComponent(bucket.name)}`}
                            className="font-mono text-xs text-amber-300 hover:text-amber-200 hover:underline cursor-pointer"
                          >
                            {bucket.name}
                          </Link>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(bucket.name);
                              showToast(`Copied bucket name '${bucket.name}' to clipboard`);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-300 ml-1"
                            title="Copy bucket name"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="p-3.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                          {bucket.region}
                        </span>
                      </td>
                      <td className="p-3.5 text-slate-400 font-mono text-[11px]">
                        {formatDate(bucket.created_at)}
                      </td>
                      <td className="p-3.5 text-right font-mono">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] ${
                            bucket.object_count > 0
                              ? "bg-cyan-950/70 text-cyan-300 border border-cyan-800/60"
                              : "text-slate-400"
                          }`}
                        >
                          {bucket.object_count.toLocaleString()}
                        </span>
                      </td>
                      <td className="p-3.5 text-right font-mono text-slate-300">
                        {formatBytes(bucket.total_size_bytes)}
                      </td>
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => openDeleteModal(bucket)}
                          className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                          title="Delete bucket"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE BUCKET MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          <div className="bg-[#131c2e] border border-slate-700 rounded-xl shadow-2xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#162238]">
              <div className="flex items-center gap-2">
                <Folder className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-semibold text-white">Create bucket</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleCreateBucket}>
              <div className="p-6 space-y-5 text-xs text-slate-300 max-h-[75vh] overflow-y-auto">
                {createError && (
                  <div className="p-3 rounded bg-red-950/80 border border-red-800 text-red-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{createError}</span>
                  </div>
                )}

                {/* Bucket Name Input */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-slate-200">
                    Bucket name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. my-app-storage-bucket"
                    value={newBucketName}
                    onChange={(e) => setNewBucketName(e.target.value.toLowerCase())}
                    className="w-full bg-[#0a1220] border border-slate-700 rounded px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  />
                  <p className="text-[11px] text-slate-500">
                    Bucket name must be globally unique across all Smart Vault S3 accounts.
                  </p>
                </div>

                {/* Real-time Client-side Validation Rules Checklist */}
                <div className="p-3.5 bg-[#0b1322] border border-slate-800 rounded-lg space-y-2">
                  <span className="font-semibold text-slate-300 block text-[11px] uppercase tracking-wider">
                    S3 Bucket Naming Rules
                  </span>
                  <ul className="space-y-1.5 text-[11px]">
                    <li className="flex items-center gap-2">
                      {validation.lenValid ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <span className={validation.lenValid ? "text-slate-200" : "text-slate-400"}>
                        Between 3 and 63 characters long ({newBucketName.length}/63)
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      {validation.allowedCharsOnly ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <span className={validation.allowedCharsOnly ? "text-slate-200" : "text-slate-400"}>
                        Consist only of lowercase letters, numbers, and hyphens
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      {validation.noHyphenEnds ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <span className={validation.noHyphenEnds ? "text-slate-200" : "text-slate-400"}>
                        Cannot start or end with a hyphen
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      {validation.noUppercaseOrSpaces ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <span className={validation.noUppercaseOrSpaces ? "text-slate-200" : "text-slate-400"}>
                        No uppercase letters, spaces, or symbols
                      </span>
                    </li>
                  </ul>
                </div>

                {/* Region Selector */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-slate-200">AWS Region</label>
                  <select
                    value={newBucketRegion}
                    onChange={(e) => setNewBucketRegion(e.target.value)}
                    className="w-full bg-[#0a1220] border border-slate-700 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  >
                    {REGION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Simulation Features Badge */}
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded flex items-center justify-between text-[11px] text-slate-400">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span>Default Encryption: SSE-S3 (AES-256)</span>
                  </div>
                  <span className="text-emerald-400 font-medium">Enabled</span>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 bg-[#101827]">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 border border-slate-700 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!validation.isValid || createSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-slate-950 bg-[#ec7211] hover:bg-[#ff841f] active:bg-[#d6650b] rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {createSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create bucket</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {isDeleteModalOpen && bucketToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="bg-[#131c2e] border border-red-900/60 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-red-950/30">
              <div className="flex items-center gap-2 text-red-400 font-semibold text-base">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3>Delete bucket</h3>
              </div>
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleDeleteBucket}>
              <div className="p-6 space-y-4 text-xs text-slate-300">
                {deleteError && (
                  <div className="p-3 rounded bg-red-950/80 border border-red-800 text-red-200 flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{deleteError}</span>
                  </div>
                )}

                {/* Non-empty warning if object_count > 0 */}
                {bucketToDelete.object_count > 0 ? (
                  <div className="p-4 rounded-lg bg-amber-950/60 border border-amber-800/80 text-amber-200 space-y-2">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <span>Bucket is not empty</span>
                    </div>
                    <p className="text-[11px] text-amber-300/90 leading-relaxed">
                      This bucket contains <strong>{bucketToDelete.object_count}</strong> object(s) totaling <strong>{formatBytes(bucketToDelete.total_size_bytes)}</strong>.
                      According to standard S3 rules, you must empty the bucket before you can delete it.
                    </p>
                  </div>
                ) : (
                  <p className="leading-relaxed">
                    Deleting a bucket is permanent and cannot be undone. Are you sure you want to delete bucket{" "}
                    <strong className="text-amber-300 font-mono">{bucketToDelete.name}</strong>?
                  </p>
                )}

                <div className="space-y-1.5 pt-2">
                  <label className="block text-slate-300">
                    To confirm deletion, type the bucket name{" "}
                    <span className="font-mono text-amber-300 font-bold">
                      {bucketToDelete.name}
                    </span>{" "}
                    below:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={bucketToDelete.name}
                    value={deleteConfirmationInput}
                    onChange={(e) => setDeleteConfirmationInput(e.target.value)}
                    className="w-full bg-[#0a1220] border border-slate-700 rounded px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 bg-[#101827]">
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 border border-slate-700 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    deleteConfirmationInput.trim() !== bucketToDelete.name ||
                    deleteSubmitting
                  }
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 active:bg-red-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleteSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <span>Delete bucket</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
