"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Globe,
  ExternalLink,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Layers,
} from "lucide-react";
import ArchitectureDrawer from "./ArchitectureDrawer";

interface ConsoleHeaderProps {
  region?: string;
  isBackendHealthy?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export default function ConsoleHeader({
  region = "us-east-1",
  isBackendHealthy = true,
}: ConsoleHeaderProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <>
      <header className="bg-[#131b2c] border-b border-slate-800 px-4 py-2.5 flex items-center justify-between text-xs sticky top-0 z-40 select-none shadow-md shadow-black/20">
        {/* Brand & S3 Logo */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
            <div className="w-6 h-6 rounded bg-[#ec7211] flex items-center justify-center font-black text-slate-950 text-xs shadow-sm shadow-amber-900/40">
              S3
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-slate-100 tracking-wide text-sm">Smart Vault Console</span>
              <span className="text-[10px] text-amber-400/90 font-mono hidden sm:inline">AWS S3 Parity</span>
            </div>
          </Link>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <span className="text-slate-400 hidden md:inline text-[11px]">Object Storage Simulation Engine</span>
        </div>

        {/* Global Toolbar & Architecture Button */}
        <div className="flex items-center gap-3 text-slate-400">
          {/* Architecture Guide Button */}
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-amber-300 bg-amber-950/60 hover:bg-amber-900/60 active:bg-amber-950 border border-amber-600/50 rounded-md transition-colors shadow-sm"
            title="System Overview & Architecture Guide"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>Architecture Guide</span>
          </button>

          {/* Region Indicator */}
          <div className="hidden sm:flex items-center gap-1.5 bg-[#0b1322] px-2.5 py-1 rounded border border-slate-800 text-[11px]">
            <Globe className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-slate-300 font-mono">{region}</span>
            <span className="text-slate-500 text-[10px]">(N. Virginia)</span>
          </div>

          {/* Backend Status Pill */}
          <div
            className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-medium transition-colors ${
              isBackendHealthy
                ? "bg-emerald-950/50 border-emerald-600/40 text-emerald-300"
                : "bg-amber-950/50 border-amber-600/40 text-amber-300"
            }`}
          >
            {isBackendHealthy ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3 h-3 text-amber-400" />
            )}
            <span>{isBackendHealthy ? "Backend: Online" : "Backend: Standby"}</span>
          </div>

          {/* Swagger API */}
          <a
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-slate-300 hover:text-amber-400 transition-colors text-[11px]"
            title="Open Swagger API documentation"
          >
            <span className="hidden sm:inline">Swagger API</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </header>

      {/* Slide-over Architecture Drawer */}
      <ArchitectureDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
    </>
  );
}
