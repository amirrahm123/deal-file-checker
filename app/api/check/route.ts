import { NextResponse } from "next/server";
import { checkDeal } from "../../../lib/check";
import { loadApiKey } from "../../../lib/extract";

export const runtime = "nodejs";
export const maxDuration = 120; // seconds (Vercel). Extraction runs per document in parallel.

const MAX_FILES = 8;
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: Request) {
  if (!loadApiKey()) {
    return NextResponse.json({ error: "חסר ANTHROPIC_API_KEY בהגדרות השרת." }, { status: 500 });
  }
  // Optional access code, so a public link doesn't spend your API credit (set DEAL_CHECKER_ACCESS_CODE on Vercel).
  const code = process.env.DEAL_CHECKER_ACCESS_CODE;
  if (code && req.headers.get("x-access-code") !== code) {
    return NextResponse.json({ error: "קוד גישה שגוי. לקבלת קוד לפיילוט – צרו קשר עם BuildLab." }, { status: 401 });
  }
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "לא הועלו קבצים." }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `אפשר להעלות עד ${MAX_FILES} קבצים.` }, { status: 400 });
  for (const f of files) {
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: `${f.name} אינו PDF.` }, { status: 400 });
    if (f.size > MAX_BYTES) return NextResponse.json({ error: `${f.name} גדול מדי (עד 15MB).` }, { status: 400 });
  }
  try {
    const input = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    const { report } = await checkDeal(input, { review: form.get("review") !== "0" });
    // Documents are processed in memory only and are not stored.
    return NextResponse.json(report);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "הבדיקה נכשלה. נסו שוב." }, { status: 500 });
  }
}
