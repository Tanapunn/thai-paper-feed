"use client";

import { useState } from "react";

type IngestResult = {
  fetched: number;
  skippedExisting: number;
  inserted: number;
  insertedIds: string[];
  failed: { id: string; error: string }[];
};

export default function AdminPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<IngestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Secret is typed in, never hardcoded in the client bundle. It's sent to the
  // protected /api/ingest route as a bearer token.
  const [secret, setSecret] = useState("");

  async function handleIngest() {
    setStatus("loading");
    setResult(null);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      setResult(data);
      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
      <h1 className="text-xl font-bold text-zinc-900">⚙️ Admin — Ingest เปเปอร์ใหม่</h1>
      <p className="mt-1 text-sm text-zinc-500">
        ดึงเปเปอร์ล่าสุดจาก arXiv (cs.CL + cs.AI) → สรุปด้วย Gemini → บันทึกลง Supabase
        (ข้ามใบที่มีอยู่แล้ว)
      </p>

      <input
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder="Ingest secret"
        className="mt-6 w-full rounded-xl border border-zinc-300 px-4 py-3 text-base text-zinc-900 outline-none focus:border-indigo-500"
      />

      <button
        onClick={handleIngest}
        disabled={status === "loading" || secret.length === 0}
        className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "กำลังดึงข้อมูล... (อาจใช้เวลาสักครู่)" : "ดึงเปเปอร์ใหม่"}
      </button>

      {status === "done" && result && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm">
          <p>ดึงมาทั้งหมด: {result.fetched} ใบ</p>
          <p>มีอยู่แล้ว (ข้าม): {result.skippedExisting} ใบ</p>
          <p className="font-semibold text-emerald-700">เพิ่มใหม่: {result.inserted} ใบ</p>
          {result.failed.length > 0 && (
            <div className="mt-3 rounded-lg bg-red-50 p-3 text-red-700">
              <p className="font-semibold">ล้มเหลว {result.failed.length} ใบ:</p>
              <ul className="mt-1 list-disc pl-5">
                {result.failed.map((f) => (
                  <li key={f.id}>
                    {f.id}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {status === "error" && (
        <div className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          เกิดข้อผิดพลาด: {errorMessage}
        </div>
      )}
    </main>
  );
}
