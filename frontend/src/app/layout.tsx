import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Vault | S3 Simulation",
  description: "Next-generation simulated Amazon S3 object storage with SQLite backend and modern UI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        <div className="relative min-h-screen radial-glow">
          {children}
        </div>
      </body>
    </html>
  );
}
