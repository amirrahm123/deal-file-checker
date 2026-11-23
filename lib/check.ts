import { extractDoc, MODEL } from "./extract";
import { buildFacts } from "./facts";
import { reviewFile } from "./review";
import { runRules } from "./rules";
import type { DocType, ExtractedDoc, Finding, Report, Severity } from "./types";
import { verifyFindings } from "./verify";

const ORDER: Record<Severity, number> = { "גבוה": 0, "בינוני": 1, "נמוך": 2 };
const EXPECTED: DocType[] = ["tabu", "agreement", "pledges"];

export async function checkDeal(files: { name: string; bytes: Uint8Array }[], opts: { review?: boolean } = {}): Promise<{ report: Report; docs: ExtractedDoc[] }> {
  const t0 = Date.now();
  const docs = await Promise.all(files.map((f) => extractDoc(f.name, f.bytes)));
  return { report: await buildReport(docs, opts, t0), docs };
}

export async function buildReport(docs: ExtractedDoc[], opts: { review?: boolean } = {}, t0 = Date.now()): Promise<Report> {
  let findings: Finding[] = verifyFindings(runRules(docs), docs);
  if (opts.review !== false) {
    const extra = verifyFindings(await reviewFile(docs, findings), docs);
    // Reviewer findings must be backed by at least one quote that really appears in the documents.
    findings = findings.concat(extra.filter((f) => f.evidence.some((e) => e.verified)));
  }
  const seen = new Map<DocType, string[]>();
  docs.forEach((d) => seen.set(d.doc_type, [...(seen.get(d.doc_type) ?? []), d.file]));
  for (const [type, names] of seen) {
    if (type !== "other" && names.length > 1) {
      findings.push({
        code: "DUPLICATE_DOC", severity: "נמוך", source: "rules", evidence: [],
        title: "הועלו כמה מסמכים מאותו סוג",
        detail: `הקבצים ${names.join(", ")} זוהו כאותו סוג מסמך. הבדיקה נעשתה רק מול הראשון (${names[0]}).`,
        action: "להשאיר בתיק עותק אחד ועדכני מכל מסמך ולהריץ שוב.",
      });
    }
  }
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const counts = { "גבוה": 0, "בינוני": 0, "נמוך": 0 } as Record<Severity, number>;
  findings.forEach((f) => counts[f.severity]++);
  const present = new Set(docs.map((d) => d.doc_type));
  const hasMortgage = docs.some((d) => (d.tabu?.mortgages?.length ?? 0) > 0);
  const missing = EXPECTED.filter((t) => !present.has(t));
  if (hasMortgage && !present.has("bank_letter")) missing.push("bank_letter");
  return {
    files: docs.map((d) => ({ file: d.file, doc_type: d.doc_type, scanned: d.text_layer.length === 0 })),
    findings,
    counts,
    missing_docs: missing,
    facts: buildFacts(docs),
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    model: MODEL,
  };
}
