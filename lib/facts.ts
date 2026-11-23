// "What was read from the documents": a short factual summary shown above the findings,
// so the lawyer sees at a glance what the tool understood even when nothing is wrong.

import type { ExtractedDoc, Fact, PropertyIds } from "./types";

const prop = (p?: PropertyIds) =>
  [p?.gush && `גוש ${p.gush}`, p?.helka && `חלקה ${p.helka}`, p?.tat && `תת חלקה ${p.tat}`].filter(Boolean).join(", ");

export function buildFacts(docs: ExtractedDoc[]): Fact[] {
  const out: Fact[] = [];
  const add = (doc: Fact["doc"], label: string, value?: string | null | false) => { if (value) out.push({ doc, label, value }); };

  const t = docs.find((d) => d.doc_type === "tabu")?.tabu;
  if (t) {
    add("tabu", "נכס", [prop(t.property), t.property?.area && `${t.property.area} מ"ר`].filter(Boolean).join(" · "));
    add("tabu", "הופק ב", t.issued_date);
    const lease = t.right_type === "lease";
    add("tabu", "סוג הזכות", lease
      ? `חכירה${t.lease_capitalized ? " מהוונת" : ""}${t.lease_until ? ` עד ${t.lease_until}` : ""}`
      : t.right_type === "ownership" ? "בעלות" : null);
    if (lease) add("tabu", "בעלים רשום", t.lessor);
    add("tabu", lease ? "חוכרים" : "בעלים", (t.owners ?? []).map((o) => `${o.name}${o.share ? ` (${o.share})` : ""}`).join(", "));
    add("tabu", "הצמדות", (t.attachments ?? []).map((a) => `${a.desc} ${a.mark}`).join(", "));
    add("tabu", "משכנתאות", (t.mortgages ?? []).length
      ? t.mortgages!.map((m) => [m.lender, m.rank && `דרגה ${m.rank}`, m.amount].filter(Boolean).join(", ")).join(" · ")
      : "אין");
    add("tabu", "הערות אזהרה", (t.warnings ?? []).length ? t.warnings!.map((w) => `לטובת ${w.beneficiary}`).join(" · ") : "אין");
    add("tabu", "עיקולים", (t.liens ?? []).length ? t.liens!.map((l) => l.description).join(" · ") : "אין");
    add("tabu", "הגבלות והערות", (t.notes ?? []).length ? t.notes!.map((n) => n.text).join(" · ") : "אין");
  }

  const a = docs.find((d) => d.doc_type === "agreement")?.agreement;
  if (a) {
    add("agreement", "מוכרים", (a.sellers ?? []).map((s) => s.name).join(", "));
    add("agreement", "קונים", (a.buyers ?? []).map((s) => s.name).join(", "));
    add("agreement", "מחיר", a.price);
    add("agreement", "מועד חתימה", a.signing_date);
  }

  const b = docs.find((d) => d.doc_type === "bank_letter")?.bank_letter;
  if (b) {
    add("bank_letter", "בנק", b.lender);
    add("bank_letter", "יתרה לסילוק", b.balance);
    add("bank_letter", "בתוקף עד", b.valid_until);
  }

  const p = docs.find((d) => d.doc_type === "pledges")?.pledges;
  if (p) add("pledges", "משכונות רשומים", (p.items ?? []).length ? String(p.items!.length) : "אין");

  return out;
}
