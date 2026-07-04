import Link from "next/link";
import { notFound } from "next/navigation";
import { getPaperById } from "@/lib/papers";

export const dynamic = "force-dynamic";

function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(dateString));
}

export default async function PaperDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const paper = await getPaperById(id);

  if (!paper) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
      <Link href="/" className="text-sm font-medium text-indigo-600">
        ← กลับไปหน้าฟีด
      </Link>

      <article className="mt-4">
        <h1 className="text-2xl font-bold leading-snug text-zinc-900 break-words">
          {paper.title_th ?? paper.title_en}
        </h1>
        <p className="mt-1 text-sm text-zinc-400 break-words">{paper.title_en}</p>

        {paper.summary_th && (
          <p className="mt-4 text-base leading-relaxed text-zinc-700 break-words">
            {paper.summary_th}
          </p>
        )}

        {paper.wow_point && (
          <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-900 break-words">
            💡 {paper.wow_point}
          </p>
        )}

        <dl className="mt-6 space-y-1 text-sm text-zinc-500">
          <div>
            <dt className="inline font-medium text-zinc-600">ผู้เขียน: </dt>
            <dd className="inline">{paper.authors.join(", ")}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-zinc-600">หมวดหมู่: </dt>
            <dd className="inline">{paper.category}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-zinc-600">เผยแพร่: </dt>
            <dd className="inline">{formatDate(paper.published_at)}</dd>
          </div>
        </dl>

        {paper.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
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

        <div className="mt-8 flex flex-col gap-3">
          <a
            href={paper.arxiv_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-xl bg-indigo-600 px-4 py-3 text-center text-base font-semibold text-white transition hover:bg-indigo-700"
          >
            อ่านเปเปอร์ตัวเต็ม (arXiv)
          </a>
          <a
            href={paper.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-xl border border-zinc-300 px-4 py-3 text-center text-base font-semibold text-zinc-700 transition hover:bg-zinc-100"
          >
            ดาวน์โหลด PDF
          </a>
        </div>
      </article>
    </main>
  );
}
