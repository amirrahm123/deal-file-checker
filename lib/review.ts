// Second pass: Claude reviews the whole file for problems the fixed rules don't cover.
// Its findings must cite verbatim quotes; findings whose quotes can't be found in the documents are dropped.

import { callTool } from "./extract";
import type { ExtractedDoc, Finding } from "./types";

const TOOL = {
  name: "record_findings",
  description: "Record additional problems in the deal file that are NOT already in the existing findings list.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["גבוה", "בינוני", "נמוך"] },
            title: { type: "string", description: "Short Hebrew title" },
            detail: { type: "string", description: "One or two Hebrew sentences: what does not match, with the exact values" },
            action: { type: "string", description: "What the lawyer should do, in Hebrew" },
            evidence: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  doc_type: { type: "string", enum: ["tabu", "agreement", "bank_letter", "pledges"] },
                  quote: { type: "string", description: "Verbatim text from that document, under 20 words" },
                },
                required: ["doc_type", "quote"],
              },
            },
          },
          required: ["severity", "title", "detail", "action", "evidence"],
        },
      },
    },
    required: ["findings"],
  },
};

const PROMPT = `אתה עוזר לעורך דין מקרקעין לבדוק תיק עסקת מכר דירה בישראל.
קיבלת את התמליל של כל מסמך בתיק ואת רשימת הממצאים שכבר נמצאו בבדיקה האוטומטית.
המשימה: למצוא רק בעיות **נוספות** שלא מופיעות ברשימה – סתירות בין המסמכים, הצהרות בהסכם שלא תואמות לנסח, סכומים או מועדים שלא מסתדרים, צדדים חסרים.

כללים:
- אל תחזור על ממצא שכבר ברשימה, גם לא בניסוח אחר.
- הערות אזהרה לטובת הקונים עצמם הן תקינות.
- דווח רק על מה שמופיע במסמכים בפועל. כל ממצא חייב ציטוט מדויק מהמסמך.
- אל תדווח על דברים כלליים ("מומלץ לבדוק...") בלי סתירה קונקרטית.
- מוסכמות רישום רגילות אינן בעיה, ואין לדווח עליהן:
  · תקופת חכירה נספרת ממועד תחילת החכירה, שאינו בהכרח תאריך השטר (שטר יכול לרשום העברה או רישום מאוחר של חכירה קיימת). אל תחשב תאריך סיום מתוך תאריך השטר ואל תדווח על "פער" כזה.
  · בחכירה, הבעלים הרשום הוא המדינה / רשות הפיתוח / קק"ל, והחוכר הוא בעל הזכות הנמכרת.
  · חכירה מהוונת, שטרות עם אותו מספר וסיומת שונה (/1, /2) באותו תאריך, ומספרי חלקה ישנים – רגילים.
- אל תסיק מסקנות מחישוב שאתה עושה בעצמך, אלא אם שני ערכים שכתובים במסמכים סותרים זה את זה במפורש.
- כשיש בתיק מסמך אחד בלבד, דווח רק על סתירה פנימית ברורה באותו מסמך.
- אם אין בעיות נוספות – החזר רשימה ריקה. זה תקין ורצוי.`;

export async function reviewFile(docs: ExtractedDoc[], existing: Finding[]): Promise<Finding[]> {
  const body = docs.map((d) => `=== ${d.doc_type} (${d.file}) ===\n${d.transcript}`).join("\n\n");
  const known = existing.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}: ${f.detail}`).join("\n") || "(אין)";
  const input = await callTool<{ findings?: unknown[] }>(TOOL, `${PROMPT}\n\n## ממצאים קיימים\n${known}\n\n## המסמכים\n${body}`, 4000);
  if (!input) return [];
  const items = (input.findings ?? []) as {
    severity: Finding["severity"]; title: string; detail: string; action: string; evidence: { doc_type: Finding["evidence"][number]["doc"]; quote: string }[];
  }[];
  return items.map((x) => ({
    code: "REVIEW",
    severity: x.severity,
    title: x.title,
    detail: x.detail,
    action: x.action,
    evidence: (x.evidence ?? []).map((e) => ({ doc: e.doc_type, quote: e.quote })),
    source: "review" as const,
  }));
}
