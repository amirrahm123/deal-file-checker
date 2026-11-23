// Offline test (no API key needed): runs the rules engine on "ideal" extractions of the 6 test cases
// and checks that it produces exactly the expected findings, and that quotes are found in the real PDFs.
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { pdfTextLayer } from "../lib/extract";
import { runRules } from "../lib/rules";
import { verifyFindings } from "../lib/verify";
import type { ExtractedDoc } from "../lib/types";

const dir = join(__dirname, "fixtures");
let failed = 0;

(async () => {
  for (const f of readdirSync(dir).sort()) {
    const fx = JSON.parse(readFileSync(join(dir, f), "utf8")) as { case: string; expected_codes: string[]; docs: ExtractedDoc[] };
    for (const d of fx.docs) {
      const p = join(__dirname, "..", "cases", fx.case, d.file);
      d.text_layer = existsSync(p) ? await pdfTextLayer(new Uint8Array(readFileSync(p))) : "";
    }
    const got = verifyFindings(runRules(fx.docs), fx.docs);
    const codes = got.map((x) => x.code).sort();
    const exp = [...fx.expected_codes].sort();
    const ok = JSON.stringify(codes) === JSON.stringify(exp);
    const ev = got.flatMap((x) => x.evidence);
    const checkable = ev.filter((e) => e.verified_against === "text_layer");
    const verified = checkable.filter((e) => e.verified).length;
    if (!ok) failed++;
    console.log(`${ok ? "✓" : "✗"} ${fx.case}: ${got.length} findings (expected ${exp.length}) · quotes verified ${verified}/${checkable.length}`);
    if (!ok) console.log("   got:      ", codes.join(", "), "\n   expected: ", exp.join(", "));
    for (const x of got) {
      console.log(`   [${x.severity}] ${x.code} – ${x.detail}`);
      for (const e of x.evidence.filter((e) => e.verified_against === "text_layer" && !e.verified)) console.log(`      ⚠ quote not found in ${e.doc}: "${e.quote}"`);
    }
  }
  console.log(failed ? `\n${failed} case(s) failed` : "\nall cases passed");
  process.exit(failed ? 1 : 0);
})();
