import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LEGAL_DOCS, LEGAL_UPDATED, type LegalDoc } from "@/lib/legal";
import { Logo } from "@/components/ui";

type Params = { params: Promise<{ doc: string }> };

function getDoc(slug: string): LegalDoc | undefined {
  return Object.hasOwn(LEGAL_DOCS, slug) ? LEGAL_DOCS[slug as LegalDoc["slug"]] : undefined;
}

export function generateStaticParams() {
  return Object.keys(LEGAL_DOCS).map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const doc = getDoc((await params).doc);
  return { title: doc ? `${doc.title} — Tryanything` : "Not found" };
}

export default async function LegalPage({ params }: Params) {
  const doc = getDoc((await params).doc);
  if (!doc) notFound();

  return (
    <main className="mx-auto max-w-[680px] px-4 pb-16 pt-[max(20px,env(safe-area-inset-top))] sm:pt-10">
      <div className="mb-10 flex items-center justify-between">
        <Link href="/" aria-label="Back to Tryanything">
          <Logo />
        </Link>
        <nav className="flex gap-4 text-[12px] text-muted">
          {Object.values(LEGAL_DOCS).map((d) => (
            <Link key={d.slug} href={`/legal/${d.slug}`} className={d.slug === doc.slug ? "text-lime" : "hover:text-fg"}>
              {d.title.replace(" of Service", "").replace("Acceptable Use Policy", "Use policy")}
            </Link>
          ))}
        </nav>
      </div>

      <p className="mb-3 font-display text-[11px] font-bold uppercase tracking-[0.22em] text-lime">Last updated {LEGAL_UPDATED}</p>
      <h1 className="mb-5 font-display text-[38px] font-bold leading-[0.95] tracking-[-0.03em] sm:text-[48px]">{doc.title}</h1>
      <p className="mb-10 rounded-2xl border border-lime/30 bg-lime/[0.07] p-4 text-[15px] leading-relaxed text-fg/90">
        <span className="font-bold text-lime">In short: </span>
        {doc.summary}
      </p>

      <div className="space-y-9">
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="mb-3 font-display text-lg font-bold tracking-tight">{s.heading}</h2>
            <div className="space-y-3 text-[15px] leading-relaxed text-fg/75">
              {s.blocks.map((b, i) =>
                typeof b === "string" ? (
                  <p key={i}>{b}</p>
                ) : (
                  <ul key={i} className="space-y-2">
                    {b.list.map((item) => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-lime" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
