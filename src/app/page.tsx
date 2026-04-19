"use client";

import dynamic from "next/dynamic";

const PrintStudioApp = dynamic(
  () => import("@/components/print-studio-app").then((module) => module.PrintStudioApp),
  {
    ssr: false,
    loading: () => (
      <main className="min-h-screen bg-[var(--background)] px-6 py-10 text-slate-900">
        <div className="mx-auto max-w-4xl rounded-[28px] border border-slate-200 bg-white/80 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-500">
            PrintStudio
          </p>
          <h1 className="mt-3 text-4xl font-semibold">Loading workspace...</h1>
        </div>
      </main>
    ),
  },
);

export default function Home() {
  return <PrintStudioApp />;
}
