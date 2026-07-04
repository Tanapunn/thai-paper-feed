import Link from "next/link";
import { getPapers } from "@/lib/papers";

export const dynamic = "force-dynamic";

export default async function Home() {
  const papers = await getPapers();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">🧠 Thai AI Paper Feed</h1>
        <p className="mt-1 text-sm text-zinc-500">
          สรุปเปเปอร์ AI ใหม่ๆ เป็นภาษาไทย อ่านเล่นเจอของว้าว
        </p>
      </header>

      {papers.length === 0 ? (
        <p className="text-center text-zinc-500">ยังไม่มีเปเปอร์ในระบบ</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {papers.map((paper) => (
            <li key={paper.id}>
              <Link
                href={`/paper/${paper.id}`}
                className="block rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:shadow-md sm:p-5"
              >
                <h2 className="text-lg font-bold leading-snug text-zinc-900 break-words">
                  {paper.title_th ?? paper.title_en}
                </h2>

                {paper.summary_th && (
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600 break-words">
                    {paper.summary_th}
                  </p>
                )}

                {paper.wow_point && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 break-words">
                    💡 {paper.wow_point}
                  </p>
                )}

                {paper.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {paper.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <span className="mt-3 inline-block text-sm font-semibold text-indigo-600">
                  อ่านต่อ →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
