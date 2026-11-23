// Checks that every quote in a finding really appears in the document it cites.
// Uses the PDF's own text layer when there is one (independent of Claude); for scans, Claude's transcript.
// Word order is ignored on purpose: PDF text layers often store Hebrew lines in visual (reversed) order.

import type { ExtractedDoc, Finding } from "./types";
import { norm } from "./util";

// Abbreviations whose letters get scrambled around the quote mark in PDF text (בע"מ -> מ"בע).
const STOP = new Set(["בעמ", "עוד", "תז", "מר"]);

function tokens(s: string): string[] {
  return norm(s)
    .split(/[\s,;:()\[\]{}|·•\-–—/]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

export function quoteFound(quote: string, haystack: string): boolean {
  if (!haystack) return false;
  let q = tokens(quote);
  // very short quotes like "מ-3": compare the whole thing without separators
  if (!q.length) q = [norm(quote).replace(/[^\p{L}\p{N}]/gu, "")].filter(Boolean);
  if (!q.length) return false;
  // PDF text layers often glue neighbouring table cells together ("02/08/2023לוי"),
  // so each quote word is looked up as a substring of the text with all separators removed.
  const compact = norm(haystack).replace(/[^\p{L}\p{N}]/gu, "");
  // Words mixing Hebrew and punctuation (בע"מ) sometimes come out reversed in visual order.
  const hit = q.filter((t) => compact.includes(t) || compact.includes([...t].reverse().join(""))).length;
  return hit / q.length >= 0.85;
}

export function verifyFindings(findings: Finding[], docs: ExtractedDoc[]): Finding[] {
  return findings.map((f) => ({
    ...f,
    evidence: f.evidence.map((e) => {
      const d = docs.find((x) => (e.file ? x.file === e.file : x.doc_type === e.doc));
      if (!d) return { ...e, verified: false };
      const useLayer = d.text_layer.length > 0;
      return {
        ...e,
        file: d.file,
        verified: quoteFound(e.quote, useLayer ? d.text_layer : d.transcript),
        verified_against: useLayer ? "text_layer" : "transcript",
      };
    }),
  }));
}
