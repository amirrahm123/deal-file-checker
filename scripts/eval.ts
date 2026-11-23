// Runs the real checker (Claude API) on every test case in ./cases and scores it against answer_key.json.
//   npm run eval                 – all cases
//   npm run eval -- case01 case05 – some cases
//   npm run eval -- --no-review  – rules only, without the second Claude pass
// Output: a table in the terminal + eval-results/<case>.json and eval-results/summary.md

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { checkDeal } from "../lib/check";
import { callTool, loadApiKey, MODEL } from "../lib/extract";
import type { Finding } from "../lib/types";

type Expected = { id: string; severity: string; finding: string };

const ROOT = join(__dirname, "..");
const args = process.argv.slice(2);
const review = !args.includes("--no-review");
const only = args.filter((a) => !a.startsWith("--"));
const cases = readdirSync(join(ROOT, "cases")).filter((c) => /^case\d+/.test(c) && (!only.length || only.includes(c))).sort();

const JUDGE = {
  name: "record_match",
  description: "Match the checker's findings to the expected findings.",
  input_schema: {
    type: "object",
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: { expected_id: { type: "string" }, found_index: { type: ["integer", "null"], description: "1-based index of the checker finding that covers it, or null if missed" } },
          required: ["expected_id", "found_index"],
        },
      },
      acceptable_indices: { type: "array", items: { type: "integer" }, description: "1-based indices of checker findings that match none of the expected findings but DO match one of the acceptable findings" },
      extra_indices: { type: "array", items: { type: "integer" }, description: "1-based indices of checker findings that match neither expected nor acceptable findings (invented or not in the key)" },
    },
    required: ["matches", "acceptable_indices", "extra_indices"],
  },
};

type Judged = { matches: { expected_id: string; found_index: number | null }[]; acceptable_indices: number[]; extra_indices: number[] };

async function judge(expected: Expected[], acceptable: { id: string; finding: string }[], got: Finding[]): Promise<Judged> {
  if (!got.length) return { matches: expected.map((e) => ({ expected_id: e.id, found_index: null })), acceptable_indices: [], extra_indices: [] };
  const acc = acceptable.map((e) => `${e.id}: ${e.finding}`).join("\n") || "(none)";
  const exp = expected.map((e) => `${e.id}: ${e.finding}`).join("\n") || "(none – this is a clean deal)";
  const fnd = got.map((f, i) => `${i + 1}. ${f.title}: ${f.detail}`).join("\n");
  const input = await callTool<Judged>(JUDGE,
    `Expected findings (answer key):\n${exp}\n\nAcceptable extra findings (real issues, not required):\n${acc}\n\nChecker findings:\n${fnd}\n\nA checker finding matches an expected one if it describes the same underlying problem (wording may differ). One checker finding may cover at most one expected finding, except when it clearly states both problems.`, 2000);
  return { matches: input?.matches ?? [], acceptable_indices: input?.acceptable_indices ?? [], extra_indices: input?.extra_indices ?? [] };
}

(async () => {
  if (!loadApiKey()) { console.error("לא נמצא מפתח API. שים קובץ טקסט עם המפתח (sk-ant-...) בתיקיית הפרויקט, ששמו כולל api key."); process.exit(1); }
  mkdirSync(join(ROOT, "eval-results"), { recursive: true });
  const rows: string[] = [];
  let T = { exp: 0, found: 0, extra: 0 };
  console.log(`model: ${MODEL} · review pass: ${review ? "on" : "off"}\n`);
  for (const c of cases) {
    const dir = join(ROOT, "cases", c);
    const key = JSON.parse(readFileSync(join(dir, "answer_key.json"), "utf8")) as { findings: Expected[]; acceptable?: { id: string; finding: string }[] };
    const pdfs = readdirSync(dir).filter((f) => f.endsWith(".pdf") && !f.includes("01b_")); // 01b = extra scanned copy, tested separately
    const files = pdfs.map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
    process.stdout.write(`${c} … `);
    const { report, docs } = await checkDeal(files, { review });
    const j = await judge(key.findings, key.acceptable ?? [], report.findings);
    const found = j.matches.filter((m) => m.found_index !== null).length;
    const missed = j.matches.filter((m) => m.found_index === null).map((m) => m.expected_id);
    const extra = j.extra_indices.map((i) => report.findings[i - 1]).filter(Boolean);
    const bonus = j.acceptable_indices.length;
    const unverified = report.findings.flatMap((f) => f.evidence).filter((e) => !e.verified).length;
    T = { exp: T.exp + key.findings.length, found: T.found + found, extra: T.extra + extra.length };
    console.log(`found ${found}/${key.findings.length} · invented ${extra.length} · bonus ${bonus} · unverified quotes ${unverified} · ${report.seconds}s`);
    missed.forEach((m) => console.log(`   missed: ${m} – ${key.findings.find((k) => k.id === m)?.finding}`));
    extra.forEach((x) => console.log(`   extra:  [${x.severity}] ${x.title} – ${x.detail}`));
    writeFileSync(join(ROOT, "eval-results", `${c}.json`), JSON.stringify({ report, judge: j, extracted: docs.map(({ text_layer, ...d }) => d) }, null, 2));
    rows.push(`| ${c} | ${found}/${key.findings.length} | ${missed.join(", ") || "–"} | ${extra.length} | ${unverified} | ${report.seconds}s |`);
  }
  const md = [`# Eval – ${new Date().toISOString().slice(0, 16)} · ${MODEL} · review ${review ? "on" : "off"}`, "",
    "| case | found | missed | invented | unverified quotes | time |", "|---|---|---|---|---|---|", ...rows, "",
    `**Total: found ${T.found}/${T.exp} (${Math.round((100 * T.found) / Math.max(1, T.exp))}%), invented ${T.extra}.**`].join("\n");
  writeFileSync(join(ROOT, "eval-results", "summary.md"), md + "\n");
  console.log(`\nTOTAL found ${T.found}/${T.exp} · invented ${T.extra}\nsaved eval-results/summary.md`);
})();
