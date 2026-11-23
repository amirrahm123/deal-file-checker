// Deterministic cross-checks. Claude only extracts the data; these rules decide what is a problem,
// so the same documents always give the same findings and every finding points to its source.

import type { AgreementData, BankLetterData, DocType, Evidence, ExtractedDoc, Finding, PledgesData, PropertyIds, Severity, TabuData } from "./types";
import {
  attachmentType, daysBetween, ils, isTransposition, normId, parseArea, parseDate, parseMoney, parseShare,
  sameId, sameMark, sameName, sameOrg, sameParty, similarName,
} from "./util";

const ev = (doc: DocType, quote?: string | null): Evidence[] => (quote && quote.trim() ? [{ doc, quote: quote.trim() }] : []);

function f(code: string, severity: Severity, title: string, detail: string, action: string, evidence: Evidence[]): Finding {
  return { code, severity, title, detail, action, evidence, source: "rules" };
}

const PROP_LABEL: Record<string, string> = { gush: "גוש", helka: "חלקה", tat: "תת חלקה" };
const DOC_LABEL: Record<DocType, string> = { tabu: "הנסח", agreement: "ההסכם", bank_letter: "מכתב הבנק", pledges: "רשם המשכונות", other: "מסמך" };
const IN_DOC: Record<DocType, string> = { tabu: "בנסח", agreement: "בהסכם", bank_letter: "במכתב הבנק", pledges: "ברשם המשכונות", other: "במסמך" };

const NOTE_RULES: Record<string, { severity: Severity; title: string; action: string }> = {
  transfer_restriction: { severity: "נמוך", title: "הגבלה בהעברת הזכות", action: "העברת הזכות דורשת הסכמה (בדרך כלל של רמ\"י). לברר מה נדרש ולקבוע זאת כתנאי בהסכם." },
  inheritance_restriction: { severity: "נמוך", title: "הגבלה בירושה", action: "לשים לב להגבלה אם הזכות עוברת בירושה, ולבדוק את תנאי חוזה החכירה." },
  easement: { severity: "בינוני", title: "זיקת הנאה רשומה", action: "לברר לטובת מי הזיקה ומה היא מגבילה, וליידע את הקונה." },
  planning: { severity: "גבוה", title: "הערה תכנונית / חריגת בנייה", action: "לבדוק בתיק הבניין ובוועדה המקומית, ולדרוש הסדרה או מחיקה לפני החתימה." },
  expropriation: { severity: "גבוה", title: "הערה על הפקעה", action: "לברר את היקף ההפקעה ואם היא חלה על הנכס הנמכר." },
  court_order: { severity: "גבוה", title: "צו רשום על הנכס", action: "לברר את מקור הצו ולדרוש את הסרתו לפני העברת כספים." },
  other: { severity: "נמוך", title: "הערה רשומה בנסח", action: "לבדוק את משמעות ההערה לעסקה." },
};

function propDiffs(a?: PropertyIds, b?: PropertyIds): ("gush" | "helka" | "tat")[] {
  if (!a || !b) return [];
  return (["gush", "helka", "tat"] as const).filter((k) => a[k] && b[k] && normId(a[k]) !== normId(b[k]));
}

export function runRules(docs: ExtractedDoc[]): Finding[] {
  const tabu: TabuData | undefined = docs.find((d) => d.doc_type === "tabu")?.tabu;
  const ag: AgreementData | undefined = docs.find((d) => d.doc_type === "agreement")?.agreement;
  const bank: BankLetterData | undefined = docs.find((d) => d.doc_type === "bank_letter")?.bank_letter;
  const pl: PledgesData | undefined = docs.find((d) => d.doc_type === "pledges")?.pledges;
  const out: Finding[] = [];
  const signing = parseDate(ag?.signing_date);

  // 1. property identity across documents
  const pairs: [DocType, PropertyIds | undefined, DocType, PropertyIds | undefined, Severity][] = [
    ["agreement", ag?.property, "tabu", tabu?.property, "גבוה"],
    ["bank_letter", bank?.property, "tabu", tabu?.property, "בינוני"],
  ];
  if (!tabu) pairs.push(["bank_letter", bank?.property, "agreement", ag?.property, "בינוני"]);
  for (const [da, pa, db, pb, sev] of pairs) {
    const diffs = propDiffs(pa, pb);
    if (!diffs.length) continue;
    const parts = diffs.map((k) => `${PROP_LABEL[k]} ${pa![k]} ${IN_DOC[da]} ו-${pb![k]} ${IN_DOC[db]}`);
    out.push(f("PROPERTY_ID", sev, `זיהוי הנכס שונה ב${DOC_LABEL[da]}`,
      `${parts.join("; ")}.`,
      da === "bank_letter" ? "לבקש מהבנק מכתב מתוקן עם פרטי הנכס הנכונים, כדי שהמשכנתא תימחק מהנכס הנכון." : "לוודא שהמסמכים מתייחסים לאותו נכס ולתקן.",
      ev(da, da === "bank_letter" ? bank?.property_quote : null)));
  }

  if (tabu && ag) {
    const owners = tabu.owners ?? [];
    const sellers = ag.sellers ?? [];
    const heirs = ag.heirs_listed ?? [];
    const inSellers = (name: string, id?: string | null) => sellers.some((s) => sameParty(s, { name, id }));

    // Missing extraction must not turn into false findings: report the gap instead.
    const gaps: string[] = [];
    if (!sellers.length) gaps.push("המוכרים בהסכם");
    if (!(ag.buyers ?? []).length) gaps.push("הקונים בהסכם");
    if (!owners.length) gaps.push("הבעלים בנסח");
    if (!signing) gaps.push("מועד החתימה בהסכם (בדיקות התאריכים לא בוצעו)");
    if (gaps.length) {
      out.push(f("EXTRACTION_GAP", "נמוך", "לא הצלחתי לקרוא חלק מהמסמכים",
        `לא זוהו: ${gaps.join(", ")}. הבדיקות שתלויות בהם לא בוצעו.`,
        "לבדוק את הנקודות האלה ידנית, או להעלות עותק ברור יותר של המסמך.", []));
    }

    // 2. ownership vs sellers
    if (!sellers.length || !owners.length) {
      // skipped – see EXTRACTION_GAP
    } else if (heirs.length) {
      for (const o of owners.filter((o) => !inSellers(o.name, o.id) && !heirs.some((h) => sameName(h, o.name)))) {
        out.push(f("INHERITANCE_UNREGISTERED", "בינוני", "הירושה לא נרשמה בנסח",
          `הנכס עדיין רשום בנסח על שם ${o.name}. לפי ההסכם המוכרים הם היורשים, אבל הירושה לא נרשמה.`,
          "לרשום את צו הירושה בלשכת רישום המקרקעין לפני העברת הזכויות, או לקבוע בהסכם מנגנון ובטוחות לכך.",
          [...ev("tabu", o.quote), ...ev("agreement", ag.heirs_quote)]));
      }
      const missingHeirs = heirs.filter((h) => !inSellers(h));
      if (missingHeirs.length) {
        out.push(f("HEIR_NOT_SELLER", "גבוה", "יורש שלא חותם על ההסכם",
          `לפי צו הירושה שמצוטט בהסכם היורשים הם ${heirs.join(", ")}, אבל ${missingHeirs.join(", ")} לא צד להסכם.`,
          `להוסיף את ${missingHeirs.join(", ")} כצד להסכם, או לקבל ייפוי כוח / הסתלקות מהירושה.`,
          [...ev("agreement", ag.heirs_quote), ...ev("agreement", ag.ownership_claim?.text)]));
      }
    } else {
      for (const o of owners.filter((o) => !inSellers(o.name, o.id))) {
        const claim = ag.ownership_claim?.claims_whole_by_listed_sellers ? ` ההסכם גם מצהיר שהנכס רשום על שם המוכר${sellers.length > 1 ? "ים" : ""} בשלמות.` : "";
        out.push(f("OWNER_NOT_SELLER", "גבוה", "בעלים רשום שלא חותם על ההסכם",
          `${o.name} – ${/שלמות/.test(o.share ?? "") ? "בעלים בשלמות" : `בעלים של ${o.share ?? "חלק"} מהנכס`} לפי הנסח, אבל לא צד להסכם.${claim}`,
          `כל הבעלים הרשומים צריכים לחתום. להוסיף את ${o.name} כצד להסכם או לקבל ייפוי כוח.`,
          [...ev("tabu", o.quote), ...ev("agreement", ag.ownership_claim?.text)]));
      }
      for (const s of sellers.filter((s) => !owners.some((o) => sameParty(o, s)))) {
        out.push(f("SELLER_NOT_OWNER", "גבוה", "מוכר שלא רשום בנסח",
          `${s.name} – מוכר לפי ההסכם, אבל לא רשום כבעלים בנסח.`,
          "לברר על סמך מה המוכר מחזיק בזכויות (ירושה, הסכם שלא נרשם) ולצרף מסמכים.",
          [...ev("agreement", s.name)]));
      }
    }

    // 3. ID numbers
    for (const s of sellers) {
      const o = owners.find((o) => sameName(o.name, s.name));
      const a = normId(s.id), b = normId(o?.id);
      if (o && a && b && !sameId(a, b)) {
        out.push(f("ID_MISMATCH", "גבוה", `ת.ז. של ${s.name} לא תואמת`,
          `בהסכם ת.ז. ${s.id}, בנסח ${o.id}.${isTransposition(a, b) ? " שתי ספרות סמוכות התחלפו." : ""}`,
          "לתקן את מספר הזהות בהסכם לפי תעודת הזהות ולפי הנסח.",
          [...ev("agreement", s.id), ...ev("tabu", o.id)]));
      }
    }

    // 4. shares
    if (ag.ownership_claim?.claims_equal_shares && owners.length > 1) {
      const shares = owners.map((o) => parseShare(o.share));
      if (shares.every((x) => x !== null) && new Set(shares.map((x) => x!.toFixed(4))).size > 1) {
        out.push(f("SHARES", "בינוני", "חלוקת הבעלות שונה",
          `ההסכם מצהיר על בעלות בחלקים שווים, ובנסח: ${owners.map((o) => `${o.name} ${o.share}`).join(", ")}.`,
          "לתקן את ההצהרה בהסכם ולוודא שחלוקת התמורה בין המוכרים מתאימה.",
          [...ev("agreement", ag.ownership_claim.text), ...owners.flatMap((o) => ev("tabu", o.quote))]));
      }
    }

    // 5. lease (חכירה)
    if (tabu.right_type === "lease") {
      if (ag.ownership_claim?.claims_full_ownership_right) {
        out.push(f("LEASE_AS_OWNERSHIP", "בינוני", "ההסכם מתאר בעלות, הנסח מראה חכירה",
          `בנסח הבעלים היא ${tabu.lessor ?? "רשות מקרקעי ישראל"} והמוכרים רשומים כחוכרים, אבל ההסכם מתאר בעלות.`,
          "לתקן את תיאור הזכות בהסכם לזכות חכירה.",
          [...ev("agreement", ag.ownership_claim.text), ...ev("tabu", tabu.lessor)]));
      }
      if (!ag.mentions_rmi_consent) {
        out.push(f("RMI_CONSENT", "בינוני", "חסרה התייחסות להסכמת רמ\"י",
          "הזכות היא חכירה. נדרשים אישור זכויות והסכמת רמ\"י להעברה, וההסכם לא מתייחס לכך.",
          "להוציא אישור זכויות מרמ\"י ולהוסיף להסכם תנאי להסכמת רמ\"י להעברה.",
          [...ev("tabu", tabu.lessor)]));
      }
      const until = parseDate(tabu.lease_until);
      // does not depend on the signing date: fall back to the extract's issue date, then to today
      const ref = signing ?? parseDate(tabu.issued_date) ?? new Date();
      if (until && daysBetween(ref, until) < 365 * 5) {
        out.push(f("LEASE_EXPIRY", "נמוך", "תקופת החכירה מסתיימת בקרוב",
          `תקופת החכירה מסתיימת ב-${tabu.lease_until}.`,
          "לבדוק חידוש חוזה חכירה או היוון מול רמ\"י.",
          [...ev("tabu", tabu.lease_until)]));
      }
    }

    // 6. mortgages
    const regM = tabu.mortgages ?? [];
    const decM = ag.declared_mortgages ?? [];
    const unReg = regM.filter((m) => !decM.some((d) => sameOrg(d.lender, m.lender)));
    const unDec = decM.filter((d) => !regM.some((m) => sameOrg(d.lender, m.lender)));
    while (unReg.length && unDec.length) {
      const r = unReg.shift()!, d = unDec.shift()!;
      const bankNote = bank?.lender && sameOrg(bank.lender, r.lender) ? " גם מכתב הכוונות הוא מ" + r.lender + "." : "";
      out.push(f("MORTGAGE_LENDER", "גבוה", "הבנק המשעבד שונה בין המסמכים",
        `בהסכם המשכנתא היא לטובת ${d.lender}, ובנסח לטובת ${r.lender}.${bankNote}`,
        "לתקן את ההסכם לפי הנסח ולוודא שהתשלום לסילוק מועבר לבנק הרשום.",
        [...ev("agreement", d.quote), ...ev("tabu", r.quote)]));
    }
    for (const r of unReg) {
      out.push(f("UNDECLARED_MORTGAGE", "גבוה", "משכנתא רשומה שלא מופיעה בהסכם",
        `בנסח רשומה משכנתא ${r.rank ? "בדרגה " + r.rank + " " : ""}לטובת ${r.lender}${r.amount ? " (" + r.amount + ")" : ""}, וההסכם לא מתייחס אליה.`,
        "להוסיף להסכם מנגנון לסילוק המשכנתא ולקבל מכתב כוונות מהגורם המלווה.",
        [...ev("tabu", r.quote), ...ev("agreement", ag.declares_no_other_encumbrances?.quote)]));
    }

    // 7. warnings for third parties
    const buyers = ag.buyers ?? [];
    for (const w of buyers.length ? tabu.warnings ?? [] : []) {
      const forBuyer = buyers.some((b) => sameParty(b, { name: w.beneficiary, id: w.beneficiary_id }));
      if (forBuyer) continue;
      const declared = ag.declares_no_warnings?.value;
      out.push(f("WARNING_THIRD_PARTY", declared ? "גבוה" : "בינוני", "הערת אזהרה לטובת צד שלישי",
        `בנסח רשומה הערת אזהרה${w.date ? " מ-" + w.date : ""} לטובת ${w.beneficiary}, שאינו צד לעסקה.${declared ? " ההסכם מצהיר שאין הערות אזהרה." : ""}`,
        "לברר את מקור ההערה ולדרוש את מחיקתה לפני העברת כספים.",
        [...ev("tabu", w.quote), ...ev("agreement", ag.declares_no_warnings?.quote)]));
    }

    // 8. area
    const a1 = parseArea(ag.property?.area), a2 = parseArea(tabu.property?.area);
    if (a1 !== null && a2 !== null && Math.abs(a1 - a2) > 0.5) {
      out.push(f("AREA", "בינוני", "שטח הדירה שונה",
        `בהסכם ${ag.property!.area} מ"ר, בנסח ${tabu.property!.area} מ"ר.`,
        "לבדוק את מקור ההפרש (שטח רשום מול שטח בפועל) ולתקן את ההסכם.",
        [...ev("agreement", ag.property!.area), ...ev("tabu", tabu.property!.area)]));
    }

    // 9. attachments
    for (const at of ag.attachments ?? []) {
      const type = attachmentType(at.desc);
      const reg = (tabu.attachments ?? []).filter((t) => attachmentType(t.desc) === type);
      if (reg.some((t) => sameMark(t.mark, at.mark))) continue;
      out.push(f("ATTACHMENT", "בינוני", `הצמדה שונה: ${type}`,
        reg.length ? `בהסכם ${type} ${at.mark}, ובנסח ההצמדה היא ${reg.map((t) => t.mark).join(", ")}.` : `בהסכם ${type} ${at.mark}, ובנסח לא רשומה הצמדה כזאת.`,
        "לתקן את ההסכם לפי הנסח והתשריט.",
        [...ev("agreement", at.mark), ...reg.flatMap((t) => ev("tabu", t.mark))]));
    }

    // 10. liens
    for (const l of tabu.liens ?? []) {
      out.push(f("LIEN", "גבוה", "עיקול רשום על הנכס",
        `בנסח רשום: ${l.description}${l.beneficiary ? " לטובת " + l.beneficiary : ""}${l.date ? " (" + l.date + ")" : ""}.${ag.declares_no_liens_or_pledges?.value ? " ההסכם מצהיר שאין עיקולים." : ""}`,
        "לדרוש הסרת העיקול לפני העברת כספים.",
        [...ev("tabu", l.quote), ...ev("agreement", ag.declares_no_liens_or_pledges?.quote)]));
    }

    // 11. stale extract
    const issued = parseDate(tabu.issued_date);
    if (issued && signing && daysBetween(issued, signing) > 30) {
      out.push(f("TABU_STALE", "נמוך", "הנסח לא עדכני",
        `הנסח הופק ב-${tabu.issued_date}, ${daysBetween(issued, signing)} ימים לפני החתימה.`,
        "להפיק נסח עדכני סמוך לחתימה.",
        [...ev("tabu", tabu.issued_date)]));
    }
  }

  // 11b. other registered restrictions / notes in the extract (works on the extract alone)
  for (const n of tabu?.notes ?? []) {
    const r = NOTE_RULES[n.kind ?? "other"] ?? NOTE_RULES.other;
    out.push(f("TABU_NOTE", r.severity, r.title, `בנסח רשום: ${n.text}.`, r.action, ev("tabu", n.quote ?? n.text)));
  }

  // 12. pledges
  for (const p of (pl?.items ?? []).filter((p) => !/בוטל|מחוק|נמחק/.test(p.status ?? ""))) {
    // A pledge on something that is clearly not the property (a car, equipment) is not a problem for this deal.
    const asset = p.asset ?? "";
    const notProperty = /רכב|מ\.ר\.|רישוי|אופנוע|ציוד|מלאי|מניות|חשבון בנק/.test(asset) && !/דירה|מקרקעין|גוש|חלקה|חכירה|זכויות בנכס|זכויות ב?דירה/.test(asset);
    if (notProperty) {
      out.push(f("PLEDGE_OTHER", "נמוך", "משכון על נכס אחר של המוכר",
        `ברשם המשכונות רשום משכון על ${asset} של ${p.debtor} לטובת ${p.creditor}. המשכון אינו על הנכס הנמכר.`,
        "אין צורך בפעולה לגבי העסקה, מלבד לוודא שהמשכון אכן אינו חל על הזכויות בנכס.",
        ev("pledges", p.quote)));
      continue;
    }
    out.push(f("PLEDGE", "גבוה", "משכון רשום ברשם המשכונות",
      `רשום משכון על ${p.asset ?? "זכויות"} של ${p.debtor} לטובת ${p.creditor}. משכון כזה לא מופיע בנסח.${ag?.declares_no_liens_or_pledges?.value ? " ההסכם מצהיר שאין משכונות." : ""}`,
      "לקבל מהנושה התחייבות לביטול המשכון עם קבלת התשלום, לפני שמעבירים כסף למוכר.",
      [...ev("pledges", p.quote), ...ev("agreement", ag?.declares_no_liens_or_pledges?.quote)]));
  }

  // 13. bank letter vs agreement
  if (bank && ag) {
    const bal = parseMoney(bank.balance);
    const toLender = (ag.payments ?? []).filter((p) => p.to_lender).map((p) => parseMoney(p.amount) ?? 0);
    const paid = toLender.reduce((a, b) => a + b, 0);
    if (bal !== null && toLender.length && bal > paid) {
      out.push(f("PAYOFF_SHORT", "גבוה", "התשלום לבנק לא מכסה את יתרת המשכנתא",
        `יתרת הסילוק במכתב הכוונות ${ils(bal)}, והתשלום לבנק בהסכם ${ils(paid)}. חסרים ${ils(bal - paid)}.`,
        "להגדיל את התשלום לבנק או לקבוע מקור לסילוק היתרה, אחרת המשכנתא לא תימחק.",
        [...ev("bank_letter", bank.balance_quote), ...(ag.payments ?? []).filter((p) => p.to_lender).flatMap((p) => ev("agreement", p.quote))]));
    }
    const valid = parseDate(bank.valid_until);
    if (valid && signing && valid < signing) {
      out.push(f("LETTER_EXPIRED", "בינוני", "מכתב הכוונות פג תוקף",
        `המכתב בתוקף עד ${bank.valid_until}, לפני מועד החתימה ${ag.signing_date}.`,
        "לבקש מהבנק מכתב כוונות מעודכן.",
        [...ev("bank_letter", bank.valid_quote ?? bank.valid_until)]));
    }
    // letter still valid at signing, but expires before the payment to the bank is due
    const bankDue = (ag.payments ?? []).filter((p) => p.to_lender).map((p) => ({ p, d: parseDate(p.due) })).filter((x) => x.d);
    const lateDue = bankDue.find((x) => valid && x.d! > valid);
    if (valid && signing && valid >= signing && lateDue) {
      out.push(f("LETTER_BEFORE_PAYMENT", "בינוני", "מכתב הכוונות יפוג לפני מועד התשלום לבנק",
        `המכתב בתוקף עד ${bank.valid_until}, והתשלום לבנק בהסכם נקבע ${lateDue.p.due}. במועד התשלום יידרש מכתב מעודכן, והיתרה עשויה להשתנות.`,
        "לבקש מהבנק מכתב מעודכן סמוך למועד התשלום, או להקדים את מועד התשלום.",
        [...ev("bank_letter", bank.valid_quote ?? bank.valid_until), ...ev("agreement", lateDue.p.quote)]));
    }
    const ownersOrSellers = [...(tabu?.owners ?? []).map((o) => o.name), ...(ag.sellers ?? []).map((s) => s.name)];
    for (const b of bank.borrowers ?? []) {
      const near = ownersOrSellers.find((o) => similarName(o, b));
      if (near && !ownersOrSellers.some((o) => sameName(o, b))) {
        out.push(f("BORROWER_NAME", "נמוך", "שם הלווה במכתב הבנק שונה",
          `במכתב הבנק "${b}", ובנסח/בהסכם "${near}". כנראה שגיאת כתיב.`,
          "לבקש מהבנק לתקן את השם במכתב.",
          [...ev("bank_letter", bank.borrowers_quote ?? b)]));
      }
    }
  }

  // 14. payments add up to the price
  if (ag) {
    const price = parseMoney(ag.price);
    const pays = (ag.payments ?? []).map((p) => parseMoney(p.amount));
    if (price && pays.length && pays.every((x) => x !== null)) {
      const sum = (pays as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - price) > 1) {
        out.push(f("PAYMENTS_SUM", "בינוני", "סכום התשלומים לא שווה למחיר",
          `סכום התשלומים בהסכם ${ils(sum)}, והמחיר ${ils(price)}. הפרש של ${ils(Math.abs(price - sum))}.`,
          "לתקן את לוח התשלומים בהסכם.",
          [...ev("agreement", ag.price_quote ?? ag.price)]));
      }
    }
  }

  return out;
}
