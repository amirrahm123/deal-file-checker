// JSON schema for the extraction tool. Claude fills one call per PDF.

const str = { type: "string" } as const;
const nstr = { type: ["string", "null"] } as const;
const quote = { type: "string", description: "Exact text copied from the document that shows this item (short, verbatim, same spelling)." } as const;
const party = { type: "object", properties: { name: str, id: { ...nstr, description: "ID number digits only, exactly as written" } }, required: ["name"] } as const;
const prop = {
  type: "object",
  properties: { gush: nstr, helka: nstr, tat: { ...nstr, description: "תת חלקה" }, area: { ...nstr, description: "Area in sqm as written" }, address: nstr },
} as const;
const attach = { type: "array", items: { type: "object", properties: { mark: { ...str, description: "Mark as written, e.g. מ-5" }, desc: { ...str, description: "e.g. מחסן / חניה / גינה" } }, required: ["mark", "desc"] } } as const;
const flag = { type: ["object", "null"], properties: { value: { type: "boolean" }, quote }, required: ["value"] } as const;

export const EXTRACT_TOOL = {
  name: "record_document",
  description: "Record the type, verbatim text and structured contents of one Israeli real-estate deal document.",
  input_schema: {
    type: "object",
    properties: {
      doc_type: {
        type: "string",
        enum: ["tabu", "agreement", "bank_letter", "pledges", "other"],
        description: "tabu = נסח רישום מקרקעין; agreement = הסכם מכר; bank_letter = מכתב כוונות/סילוק מבנק; pledges = דו\"ח רשם המשכונות",
      },
      transcript: { type: "string", description: "The full text of the document, verbatim, in reading order. Tables as 'header: value' lines. No summarizing." },
      tabu: {
        type: "object",
        description: "Only for doc_type=tabu",
        properties: {
          issued_date: { ...nstr, description: "dd/mm/yyyy" },
          property: prop,
          attachments: attach,
          right_type: { type: ["string", "null"], enum: ["ownership", "lease", null], description: "lease if there is a חכירות section (sellers are lessees)" },
          lessor: nstr,
          lease_until: { ...nstr, description: "dd/mm/yyyy end of lease period" },
          lease_capitalized: { type: ["boolean", "null"], description: "true if the lease is marked חכירה מהוונת" },
          notes: {
            type: "array",
            description: "Every OTHER registered restriction, note or order that is NOT a mortgage, a הערת אזהרה or a עיקול. Examples: קיימת הגבלה בהעברה, קיימת הגבלה בירושה, זיקת הנאה, הערה לפי חוק התכנון והבנייה / אי התאמה להיתר / חריגת בנייה, הפקעה, צו הריסה, צו בית משפט, צו ניהול, נאמנות, הערה על צורך בהסכמה. One item per note. Empty array if there are none.",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["transfer_restriction", "inheritance_restriction", "easement", "planning", "expropriation", "court_order", "other"] },
                text: { ...str, description: "The note as written, in Hebrew" },
                quote,
              },
              required: ["kind", "text", "quote"],
            },
          },
          owners: { type: "array", description: "Registered owners, or lessees when right_type=lease", items: { type: "object", properties: { name: str, id: nstr, share: nstr, quote }, required: ["name", "quote"] } },
          mortgages: { type: "array", items: { type: "object", properties: { lender: str, rank: nstr, amount: nstr, quote }, required: ["lender", "quote"] } },
          warnings: { type: "array", description: "הערות אזהרה", items: { type: "object", properties: { beneficiary: str, beneficiary_id: nstr, date: nstr, on_share_of: nstr, quote }, required: ["beneficiary", "quote"] } },
          liens: { type: "array", description: "עיקולים", items: { type: "object", properties: { description: str, beneficiary: nstr, date: nstr, quote }, required: ["description", "quote"] } },
        },
      },
      agreement: {
        type: "object",
        description: "Only for doc_type=agreement",
        properties: {
          signing_date: { ...nstr, description: "dd/mm/yyyy" },
          sellers: { type: "array", items: party },
          buyers: { type: "array", items: party },
          property: prop,
          attachments: attach,
          ownership_claim: {
            type: ["object", "null"],
            description: "The seller's declaration about registered ownership",
            properties: {
              text: quote,
              claims_whole_by_listed_sellers: { type: "boolean", description: "Says the listed seller(s) own the whole property (e.g. בשלמות)" },
              claims_equal_shares: { type: "boolean", description: "Says sellers own in equal shares (בחלקים שווים)" },
              claims_full_ownership_right: { type: "boolean", description: "Describes the right as בעלות / בעלות מלאה (not חכירה)" },
            },
            required: ["text"],
          },
          heirs_listed: { type: "array", items: str, description: "If the agreement recites an inheritance order (צו ירושה), ALL heirs it names" },
          heirs_quote: nstr,
          declared_mortgages: { type: "array", description: "Mortgages the agreement says exist", items: { type: "object", properties: { lender: str, quote }, required: ["lender", "quote"] } },
          declares_no_other_encumbrances: { ...flag, description: "Declares there are no other liens/charges besides the declared mortgages" },
          declares_no_warnings: { type: ["object", "null"], properties: { value: { type: "boolean" }, except_buyers: { type: "boolean", description: "Allows warnings in favor of the buyers" }, quote }, required: ["value"] },
          declares_no_liens_or_pledges: flag,
          mentions_rmi_consent: { type: "boolean", description: "Mentions רמ\"י / רשות מקרקעי ישראל consent or approval" },
          price: nstr,
          price_quote: nstr,
          payments: { type: "array", items: { type: "object", properties: { amount: str, due: nstr, to_lender: { type: "boolean", description: "Paid directly to the mortgage lender" }, quote }, required: ["amount", "to_lender", "quote"] } },
        },
      },
      bank_letter: {
        type: "object",
        description: "Only for doc_type=bank_letter",
        properties: {
          date: nstr, lender: nstr, borrowers: { type: "array", items: str }, borrowers_quote: nstr,
          property: prop, property_quote: nstr,
          balance: nstr, balance_quote: nstr,
          valid_until: { ...nstr, description: "dd/mm/yyyy" }, valid_quote: nstr,
        },
      },
      pledges: {
        type: "object",
        description: "Only for doc_type=pledges",
        properties: {
          search_date: nstr,
          searched_ids: { type: "array", items: str },
          items: { type: "array", items: { type: "object", properties: { debtor: str, debtor_id: nstr, creditor: str, asset: nstr, status: nstr, quote }, required: ["debtor", "creditor", "quote"] } },
        },
      },
    },
    required: ["doc_type", "transcript"],
  },
} as const;

export const EXTRACT_PROMPT = `You are reading one document from an Israeli real-estate sale file (Hebrew).
Call record_document exactly once.
- Copy names, ID numbers, plot numbers, amounts and dates EXACTLY as printed. Never correct typos or "fix" mismatches – mismatches are what we are looking for.
- Every "quote" field must be text that appears verbatim in the document (a short phrase, under 20 words).
- Fill only the section that matches doc_type. Use empty arrays when a section of the document says "אין רישומים".
- Dates as dd/mm/yyyy.
- IMPORTANT: the PDF's embedded text layer often stores Hebrew in visual (reversed) order, e.g. "יול דוד" instead of "דוד לוי", ")בדוי(" instead of "(בדוי)", "הינח" instead of "חניה". Always write Hebrew in normal reading order, exactly as a person reads it on the page image. Copying characters in reversed order is an error.`;
