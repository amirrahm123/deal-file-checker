import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { extractText, getDocumentProxy } from "unpdf";
import { EXTRACT_PROMPT, EXTRACT_TOOL } from "./schema";
import type { ExtractedDoc } from "./types";

export const MODEL = process.env.DEAL_CHECKER_MODEL || "claude-sonnet-5-5";

/**
 * Finds the API key: ANTHROPIC_API_KEY, else .env.local, else any text file in the project folder
 * whose name contains "api key" (e.g. "claude בוט נדלן api key.txt"). Returns true if a key was found.
 */
export function loadApiKey(): boolean {
  if (process.env.ANTHROPIC_API_KEY?.startsWith("sk-ant-")) return true;
  try {
    const dir = process.cwd();
    const files = readdirSync(dir).filter((f) => f === ".env.local" || /api.?key/i.test(f));
    for (const f of files) {
      const m = readFileSync(join(dir, f), "utf8").match(/sk-ant-[A-Za-z0-9_\-]+/);
      if (m) { process.env.ANTHROPIC_API_KEY = m[0]; return true; }
    }
  } catch {}
  return false;
}

let _client: Anthropic | null = null;
export function client(): Anthropic {
  loadApiKey();
  if (!_client) _client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return _client;
}

/**
 * Calls Claude with one tool and returns that tool's input.
 * Some models don't accept a forced tool_choice, so we ask with tool_choice "auto"
 * and, if Claude answers in text instead, ask once more.
 */
export async function callTool<T = Record<string, unknown>>(
  tool: { name: string },
  content: Anthropic.MessageParam["content"],
  maxTokens: number,
): Promise<T | null> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await client().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      tools: [tool as unknown as Anthropic.Tool],
      tool_choice: { type: "auto" },
      messages,
    });
    const block = msg.content.find((b) => b.type === "tool_use" && b.name === tool.name);
    if (block && block.type === "tool_use") return block.input as T;
    messages.push({ role: "assistant", content: msg.content });
    messages.push({ role: "user", content: `Call the ${tool.name} tool now with your answer. Do not reply in text.` });
  }
  return null;
}

/** Text embedded in the PDF ("" for scanned/image-only PDFs). Used to verify quotes independently of Claude. */
export async function pdfTextLayer(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const t = String(text ?? "");
    return (t.match(/[֐-׿]/g) ?? []).length > 40 ? t : "";
  } catch {
    return "";
  }
}

const SECTIONS = ["tabu", "agreement", "bank_letter", "pledges"] as const;
const SECTION_KEYS: Record<(typeof SECTIONS)[number], string[]> = {
  tabu: ["issued_date", "owners", "mortgages", "warnings", "liens", "right_type", "lessor", "lease_until", "lease_capitalized", "notes"],
  agreement: ["signing_date", "sellers", "buyers", "ownership_claim", "heirs_listed", "declared_mortgages", "payments", "price"],
  bank_letter: ["lender", "borrowers", "balance", "valid_until"],
  pledges: ["search_date", "searched_ids", "items"],
};

/** Repairs common shape problems in the tool output: sections sent as JSON strings, or fields put at the top level. */
export function normalizeExtraction(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const k of [...SECTIONS, ...Object.values(SECTION_KEYS).flat()]) {
    if (typeof out[k] === "string" && /^\s*[\[{]/.test(out[k] as string)) {
      try { out[k] = JSON.parse(out[k] as string); } catch {}
    }
  }
  const t = out.doc_type as (typeof SECTIONS)[number];
  if (SECTIONS.includes(t)) {
    const sec = (out[t] && typeof out[t] === "object" ? { ...(out[t] as object) } : {}) as Record<string, unknown>;
    for (const k of [...SECTION_KEYS[t], "property", "attachments"]) {
      if (out[k] !== undefined && sec[k] === undefined) sec[k] = out[k];
    }
    for (const [k, v] of Object.entries(sec)) {
      if (typeof v === "string" && /^\s*[\[{]/.test(v)) { try { sec[k] = JSON.parse(v); } catch {} }
    }
    out[t] = sec;
  }
  return out;
}

/** True when the key facts we cross-check were not extracted. */
function incomplete(x: Record<string, unknown>): boolean {
  const t = x.doc_type as string;
  const sec = (x[t] ?? {}) as Record<string, unknown>;
  const empty = (k: string) => !Array.isArray(sec[k]) || (sec[k] as unknown[]).length === 0;
  if (t === "agreement") return empty("sellers") || empty("buyers") || !sec.signing_date;
  if (t === "tabu") return empty("owners") || !sec.issued_date || !(sec.property as { gush?: string } | undefined)?.gush;
  if (t === "bank_letter") return !sec.balance || !sec.valid_until;
  return !x.transcript;
}

export async function extractDoc(file: string, bytes: Uint8Array): Promise<ExtractedDoc> {
  const content: Anthropic.MessageParam["content"] = [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") }, title: file },
    { type: "text", text: EXTRACT_PROMPT },
  ];
  const [text_layer, first] = await Promise.all([pdfTextLayer(bytes), callTool<Record<string, unknown>>(EXTRACT_TOOL, content, 16000)]);
  let input = first ? normalizeExtraction(first) : null;
  if (!input || incomplete(input)) {
    // one more try – extraction is the step everything else depends on
    const second = await callTool<Record<string, unknown>>(EXTRACT_TOOL, content, 16000);
    const fixed = second ? normalizeExtraction(second) : null;
    if (fixed && (!input || !incomplete(fixed))) input = fixed;
  }
  if (!input) throw new Error(`No extraction for ${file}`);
  return { file, text_layer, ...(input as Omit<ExtractedDoc, "file" | "text_layer">) };
}
