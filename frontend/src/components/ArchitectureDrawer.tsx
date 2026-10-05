"use client";

import React, { useEffect, useState } from "react";
import {
  X,
  Cloud,
  Database,
  Lock,
  ShieldCheck,
  Layers,
  KeyRound,
  FileCheck,
  Zap,
  ArrowRight,
  Server,
  Terminal,
  CheckCircle2,
  HardDrive,
  Globe,
  ExternalLink,
} from "lucide-react";

interface ArchitectureDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ArchitectureDrawer({ isOpen, onClose }: ArchitectureDrawerProps) {
  const [activeTab, setActiveTab] = useState<"parity" | "dedup" | "encryption">("parity");

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-xs transition-opacity duration-300"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-2xl bg-[#0f172a] border-l border-slate-800 shadow-2xl flex flex-col text-slate-200 animate-in slide-in-from-right duration-300">
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-800 bg-[#131d31] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#ec7211] flex items-center justify-center font-black text-slate-950 text-sm shadow-md shadow-amber-900/40">
                S3
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  <span>Smart Vault Architecture</span>
                  <span className="text-[11px] font-mono font-normal px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    System Overview
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Engineering documentation for S3 simulation & custom enhancements
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              title="Close drawer (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-slate-800 bg-[#11192b] px-6 text-xs">
            <button
              onClick={() => setActiveTab("parity")}
              className={`py-3 px-3 font-semibold border-b-2 flex items-center gap-2 transition-colors ${
                activeTab === "parity"
                  ? "border-[#ec7211] text-[#ec7211]"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Cloud className="w-4 h-4" />
              <span>1. Amazon S3 Core Parity</span>
            </button>
            <button
              onClick={() => setActiveTab("dedup")}
              className={`py-3 px-3 font-semibold border-b-2 flex items-center gap-2 transition-colors ${
                activeTab === "dedup"
                  ? "border-[#ec7211] text-[#ec7211]"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>2. Block Deduplication</span>
            </button>
            <button
              onClick={() => setActiveTab("encryption")}
              className={`py-3 px-3 font-semibold border-b-2 flex items-center gap-2 transition-colors ${
                activeTab === "encryption"
                  ? "border-[#ec7211] text-[#ec7211]"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Lock className="w-4 h-4" />
              <span>3. Zero-Knowledge Crypto</span>
            </button>
          </div>

          {/* Drawer Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-300">
            {activeTab === "parity" && (
              <div className="space-y-5 animate-in fade-in duration-200">
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-amber-400" />
                    <span>High-Fidelity AWS S3 Behavioral Simulation</span>
                  </h3>
                  <p className="leading-relaxed text-slate-400">
                    Smart Vault implements core Amazon S3 object storage semantics using a modular FastAPI backend
                    powered by SQLite with relational metadata tracking and localized physical blob storage.
                  </p>
                </div>

                {/* Concept 1: Buckets */}
                <div className="p-4 rounded-xl bg-[#11192b] border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 flex items-center gap-2 text-xs">
                      <Database className="w-4 h-4 text-indigo-400" />
                      <span>Bucket Management & Naming Strictness</span>
                    </span>
                    <span className="font-mono text-[10px] text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800">
                      RFC 1123 / S3 Spec
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-slate-400 pl-4 list-disc text-[11px]">
                    <li>Enforces standard 3–63 character length constraints and lowercase DNS-compliant names.</li>
                    <li>No uppercase letters, underscores, or leading/trailing hyphens allowed.</li>
                    <li>Ensures global uniqueness and protects against non-empty bucket deletion (400 Bad Request).</li>
                  </ul>
                </div>

                {/* Concept 2: Objects */}
                <div className="p-4 rounded-xl bg-[#11192b] border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 flex items-center gap-2 text-xs">
                      <FileCheck className="w-4 h-4 text-cyan-400" />
                      <span>Object Storage & Prefix Hierarchies</span>
                    </span>
                    <span className="font-mono text-[10px] text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800">
                      Multipart / Streaming
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-slate-400 pl-4 list-disc text-[11px]">
                    <li>Supports simulated directory prefixes (e.g. <code>photos/2026/vacation.png</code>).</li>
                    <li>Automatic MIME type inference with inline browser preview support (images, text, PDF).</li>
                    <li>SHA-256 integrity digests computed on the fly during 64 KB chunked streaming.</li>
                  </ul>
                </div>

                {/* Concept 3: Pre-signed URLs */}
                <div className="p-4 rounded-xl bg-[#11192b] border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 flex items-center gap-2 text-xs">
                      <KeyRound className="w-4 h-4 text-emerald-400" />
                      <span>HMAC-SHA256 Pre-signed Expiring URLs</span>
                    </span>
                    <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                      SigV4 Equivalent
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Mimics AWS SigV4 pre-signed URL generation. URL-safe Base64 payloads containing bucket name, object
                    key, and epoch expiration are signed with an HMAC-SHA256 secret. Expired links are rejected with
                    HTTP 403 Forbidden, and tampered signatures with HTTP 400 Bad Request.
                  </p>
                </div>
              </div>
            )}

            {activeTab === "dedup" && (
              <div className="space-y-5 animate-in fade-in duration-200">
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    <span>Enhancement 1: Content-Addressable Block Deduplication</span>
                  </h3>
                  <p className="leading-relaxed text-slate-400">
                    Unlike standard S3, Smart Vault incorporates an advanced storage deduplication engine that
                    eliminates redundant disk consumption when identical files are uploaded across multiple buckets or keys.
                  </p>
                </div>

                {/* Flow Diagram */}
                <div className="p-4 rounded-xl bg-[#0a1220] border border-slate-800 space-y-3">
                  <span className="font-semibold text-slate-200 block text-xs">Deduplication Ingestion Pipeline</span>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-center text-[10px] font-mono">
                    <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                      <span className="text-amber-400 font-bold block mb-1">1. Stream & Hash</span>
                      <span>Compute SHA-256 hash</span>
                    </div>
                    <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                      <span className="text-cyan-400 font-bold block mb-1">2. Check Disk</span>
                      <span>storage/blobs/&lt;hash&gt;</span>
                    </div>
                    <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                      <span className="text-emerald-400 font-bold block mb-1">3. Write or Link</span>
                      <span>Zero duplicate I/O</span>
                    </div>
                    <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                      <span className="text-violet-400 font-bold block mb-1">4. DB Metadata</span>
                      <span>Update S3Object row</span>
                    </div>
                  </div>
                </div>

                {/* Deletion Reference Counting */}
                <div className="p-4 rounded-xl bg-[#11192b] border border-slate-800 space-y-2.5">
                  <h4 className="font-semibold text-slate-100 flex items-center gap-2 text-xs">
                    <HardDrive className="w-4 h-4 text-amber-400" />
                    <span>Reference-Counted Blob Lifecycle</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    When an object is deleted, Smart Vault inspects whether any other <code>S3Object</code> records
                    in the database reference the identical <code>content_hash</code>.
                  </p>
                  <div className="p-2.5 rounded bg-slate-950 font-mono text-[11px] text-slate-300 border border-slate-800">
                    <code>
                      if other_references == 0: <br />
                      &nbsp;&nbsp;os.remove(storage_path) # Safe physical cleanup <br />
                      else: <br />
                      &nbsp;&nbsp;preserve_blob() # Blob maintained for remaining references
                    </code>
                  </div>
                </div>

                {/* Global Analytics */}
                <div className="p-4 rounded-xl bg-[#11192b] border border-slate-800 space-y-2">
                  <h4 className="font-semibold text-slate-100 flex items-center gap-2 text-xs">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    <span>Live Metrics: /api/stats</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    The <code>GET /api/stats</code> endpoint aggregates logical capacity vs physical disk consumption,
                    calculating exact savings and deduplication ratio in real-time.
                  </p>
                </div>
              </div>
            )}

            {activeTab === "encryption" && (
              <div className="space-y-5 animate-in fade-in duration-200">
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Lock className="w-4 h-4 text-emerald-400" />
                    <span>Enhancement 2: Zero-Knowledge Client-Side Encryption</span>
                  </h3>
                  <p className="leading-relaxed text-slate-400">
                    Smart Vault allows clients to encrypt sensitive payloads in-browser before transmission using the
                    Web Crypto API. The server only ever receives and stores ciphertext.
                  </p>
                </div>

                {/* Cryptographic Spec Card */}
                <div className="p-4 rounded-xl bg-[#11192b] border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100 flex items-center gap-2 text-xs">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Cryptographic Architecture</span>
                    </span>
                    <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                      AES-GCM-256 + PBKDF2
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-slate-400 pl-4 list-disc text-[11px]">
                    <li>
                      <strong className="text-slate-200">Key Derivation:</strong> PBKDF2 with 100,000 iterations of
                      SHA-256 and a 16-byte random salt.
                    </li>
                    <li>
                      <strong className="text-slate-200">Cipher:</strong> AES-GCM (Galois/Counter Mode) 256-bit with a
                      12-byte random IV, guaranteeing confidentiality and authenticated integrity.
                    </li>
                    <li>
                      <strong className="text-slate-200">Wire Payload Layout:</strong>
                      <div className="mt-1.5 p-2 rounded bg-slate-950 font-mono text-[10px] text-emerald-300 border border-slate-800">
                        [16B Salt] + [12B IV] + [Ciphertext + 16B Authentication Tag]
                      </div>
                    </li>
                  </ul>
                </div>

                {/* Threat Model */}
                <div className="p-4 rounded-xl bg-[#11192b] border border-slate-800 space-y-2.5">
                  <h4 className="font-semibold text-slate-100 flex items-center gap-2 text-xs">
                    <Lock className="w-4 h-4 text-violet-400" />
                    <span>Zero-Knowledge Threat Model</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    The user&apos;s secret passphrase is never transmitted across the network, logged, or stored on
                    disk. Even in the event of an arbitrary database dump or file system compromise, stored objects
                    remain mathematically undecryptable.
                  </p>
                </div>

                {/* Decryption Flow */}
                <div className="p-4 rounded-xl bg-[#11192b] border border-slate-800 space-y-2">
                  <h4 className="font-semibold text-slate-100 flex items-center gap-2 text-xs">
                    <FileCheck className="w-4 h-4 text-cyan-400" />
                    <span>In-Browser Ephemeral Decryption</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    When an encrypted object is requested for preview or download, Smart Vault prompts the user for
                    their passphrase. The browser derives the AES key, validates the GCM authentication tag, and renders
                    the plaintext directly in browser memory without ever saving unencrypted bytes to disk.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-800 bg-[#131d31] flex items-center justify-between text-xs">
            <span className="text-slate-500 font-mono text-[11px]">Smart Vault Simulation v1.0.0</span>
            <button
              onClick={onClose}
              className="px-4 py-2 font-medium text-slate-300 hover:bg-slate-800 border border-slate-700 rounded transition-colors"
            >
              Close Guide
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
