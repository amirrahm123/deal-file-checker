"use client";

import { useEffect, useRef, useState } from "react";
import type { DocType, Finding, Report } from "../lib/types";

const DOC_NAME: Record<DocType, string> = { tabu: "נסח טאבו", agreement: "הסכם מכר", bank_letter: "מכתב כוונות", pledges: "רשם המשכונות", other: "מסמך אחר" };
const SEV_CLS: Record<Finding["severity"], string> = { "גבוה": "high", "בינוני": "mid", "נמוך": "low" };
const STEPS = ["קורא את המסמכים", "מחלץ בעלים, משכנתאות, הערות ותשלומים", "מצליב בין המסמכים", "סקירה נוספת ואימות ציטוטים"];

export default function Page() {
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => { try { setCode(localStorage.getItem("dc-code") ?? ""); } catch {} }, []);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 7000);
    return () => clearInterval(t);
  }, [busy]);

  function add(list: FileList | null) {
    if (!list) return;
    const pdfs = [...list].filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    setFiles((cur) => [...cur, ...pdfs.filter((p) => !cur.some((c) => c.name === p.name))].slice(0, 8));
    setReport(null);
  }

  async function run() {
    setBusy(true); setErr(""); setReport(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      try { localStorage.setItem("dc-code", code); } catch {}
      const res = await fetch("/api/check", { method: "POST", body: fd, headers: { "x-access-code": code } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setReport(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <h1>בודק תיק עסקה</h1>
          <p>הכלי מסמן ומסכם. עורך הדין מחליט.</p>
        </div>
        <span className="tag">BuildLab · גרסת פיילוט</span>
      </header>

      <div
        className={`drop${over ? " over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      >
        <strong>גררו לכאן את מסמכי העסקה</strong>
        <span>נסח טאבו, הסכם מכר, מכתב כוונות מהבנק, דו&quot;ח רשם המשכונות · PDF, גם סרוקים</span>
        <input ref={input} type="file" accept="application/pdf" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <div className="files">
          {files.map((f) => {
            const r = report?.files.find((x) => x.file === f.name);
            return (
              <div className="file" key={f.name}>
                <span className="name">{f.name}</span>
                <span className="hint">{r ? `${DOC_NAME[r.doc_type]}${r.scanned ? " · סרוק" : ""}` : `${Math.round(f.size / 1024)} KB`}</span>
                {!busy && <button aria-label="הסר" onClick={() => setFiles(files.filter((x) => x !== f))}>×</button>}
              </div>
            );
          })}
        </div>
      )}

      <div className="actions">
        <input className="code" placeholder="קוד גישה" value={code} onChange={(e) => setCode(e.target.value)} aria-label="קוד גישה" />
        <button className="btn" disabled={!files.length || busy} onClick={run}>{busy ? "בודק…" : "הרץ בדיקה"}</button>
        {files.length > 0 && !busy && <button className="btn ghost" onClick={() => { setFiles([]); setReport(null); }}>נקה</button>}
        <span className="hint">המסמכים מעובדים לבדיקה בלבד ולא נשמרים.</span>
      </div>
      {err && <div className="err">{err}</div>}

      {busy && (
        <div className="progress">
          {STEPS.map((s, i) => (
            <div key={s} className={`step${i === step ? " on" : i < step ? " done" : ""}`}><span className="dot" />{s}</div>
          ))}
        </div>
      )}

      {report && <ReportView r={report} />}

      <p className="disclaimer">הכלי מסייע לקרוא ולהצליב מסמכים ואינו מחליף את הבדיקה ושיקול הדעת של עורך הדין. כל ממצא מגיע עם ציטוט מהמסמך; ציטוט שלא נמצא במסמך מסומן לבדיקה ידנית.</p>
    </main>
  );
}

function ReportView({ r }: { r: Report }) {
  const [copied, setCopied] = useState(false);
  const total = r.findings.length;
  function copy() {
    const txt = r.findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}\n${f.detail}${f.action ? "\nמה לעשות: " + f.action : ""}`).join("\n\n");
    navigator.clipboard.writeText(txt || "לא נמצאו ממצאים.").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }
  return (
    <section className="report">
      <aside className="summary">
        <div className="big">{total}<small>ממצאים</small></div>
        <div className="counts">
          <span className="c-high">{r.counts["גבוה"]} גבוה</span>
          <span className="c-mid">{r.counts["בינוני"]} בינוני</span>
          <span className="c-low">{r.counts["נמוך"]} נמוך</span>
        </div>
        <div className="meta">
          <div className="docs">
            {r.files.map((f) => <div key={f.file}><span>{DOC_NAME[f.doc_type]}</span><span>{f.scanned ? "סרוק" : "✓"}</span></div>)}
          </div>
          {r.missing_docs.length > 0 && <div className="missing">חסר בתיק: {r.missing_docs.map((d) => DOC_NAME[d]).join(", ")}</div>}
          <div>{r.seconds} שניות</div>
        </div>
        <div className="actions"><button className="btn ghost" onClick={copy}>{copied ? "הועתק ✓" : "העתק סיכום"}</button></div>
      </aside>
      <div className="list">
        {(r.facts?.length ?? 0) > 0 && (
          <div className="facts">
            <h3>מה נקרא מהמסמכים</h3>
            {r.files.map((file) => {
              const rows = r.facts!.filter((x) => x.doc === file.doc_type);
              if (!rows.length) return null;
              return (
                <div className="facts-doc" key={file.file}>
                  <div className="facts-name">{DOC_NAME[file.doc_type]}</div>
                  <dl>
                    {rows.map((x, i) => (<div key={i}><dt>{x.label}</dt><dd>{x.value}</dd></div>))}
                  </dl>
                </div>
              );
            })}
          </div>
        )}
        {total === 0 && <div className="clean">{r.files.length > 1 ? "לא נמצאו סתירות בין המסמכים." : "לא נמצאו ממצאים במסמך. להצלבה יש להעלות גם את שאר מסמכי התיק."}</div>}
        {r.findings.map((f, i) => (
          <article key={i} className={`card ${SEV_CLS[f.severity]}`}>
            <h3>
              <span className={`sev ${SEV_CLS[f.severity]}`}>{f.severity}</span>
              {f.title}
              {f.source === "review" && <span className="src-ai">סקירת AI</span>}
            </h3>
            <p>{f.detail}</p>
            {f.action && <p className="todo"><b>מה לעשות: </b>{f.action}</p>}
            {f.evidence.length > 0 && (
              <div className="quotes">
                {f.evidence.map((e, j) => (
                  <div className="q" key={j}>
                    <span className="doc">{DOC_NAME[e.doc]}</span>
                    <span className="txt">&quot;{e.quote}&quot;</span>
                    {e.verified ? <span className="ok">✓ נמצא במסמך</span> : <span className="no">⚠ לבדיקה ידנית</span>}
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
