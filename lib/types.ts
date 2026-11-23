export type DocType = "tabu" | "agreement" | "bank_letter" | "pledges" | "other";
export type Severity = "גבוה" | "בינוני" | "נמוך";

export interface Party { name: string; id?: string | null }
export interface PropertyIds { gush?: string | null; helka?: string | null; tat?: string | null; area?: string | null; address?: string | null }
export interface Attachment { mark: string; desc: string }

export type TabuNoteKind = "transfer_restriction" | "inheritance_restriction" | "easement" | "planning" | "expropriation" | "court_order" | "other";

export interface TabuData {
  issued_date?: string | null;
  property?: PropertyIds;
  attachments?: Attachment[];
  right_type?: "ownership" | "lease" | null;
  lessor?: string | null;
  lease_until?: string | null;
  lease_capitalized?: boolean | null;
  notes?: { kind?: TabuNoteKind | null; text: string; quote?: string }[];
  owners?: (Party & { share?: string | null; quote?: string })[];
  mortgages?: { lender: string; rank?: string | null; amount?: string | null; quote?: string }[];
  warnings?: { beneficiary: string; beneficiary_id?: string | null; date?: string | null; on_share_of?: string | null; quote?: string }[];
  liens?: { description: string; beneficiary?: string | null; date?: string | null; quote?: string }[];
}

export interface AgreementData {
  signing_date?: string | null;
  sellers?: Party[];
  buyers?: Party[];
  property?: PropertyIds;
  attachments?: Attachment[];
  ownership_claim?: { text: string; claims_whole_by_listed_sellers?: boolean; claims_equal_shares?: boolean; claims_full_ownership_right?: boolean } | null;
  heirs_listed?: string[];
  heirs_quote?: string | null;
  declared_mortgages?: { lender: string; quote?: string }[];
  declares_no_other_encumbrances?: { value: boolean; quote?: string } | null;
  declares_no_warnings?: { value: boolean; except_buyers?: boolean; quote?: string } | null;
  declares_no_liens_or_pledges?: { value: boolean; quote?: string } | null;
  mentions_rmi_consent?: boolean;
  price?: string | null;
  price_quote?: string | null;
  payments?: { amount: string; due?: string | null; to_lender: boolean; quote?: string }[];
}

export interface BankLetterData {
  date?: string | null;
  lender?: string | null;
  borrowers?: string[];
  property?: PropertyIds;
  balance?: string | null;
  balance_quote?: string | null;
  valid_until?: string | null;
  valid_quote?: string | null;
  property_quote?: string | null;
  borrowers_quote?: string | null;
}

export interface PledgesData {
  search_date?: string | null;
  searched_ids?: string[];
  items?: { debtor: string; debtor_id?: string | null; creditor: string; asset?: string | null; status?: string | null; quote?: string }[];
}

export interface ExtractedDoc {
  file: string;
  doc_type: DocType;
  transcript: string;      // Claude's verbatim reading of the document
  text_layer: string;      // text from the PDF itself ("" for scans)
  tabu?: TabuData;
  agreement?: AgreementData;
  bank_letter?: BankLetterData;
  pledges?: PledgesData;
}

export interface Evidence { doc: DocType; file?: string; quote: string; verified?: boolean; verified_against?: "text_layer" | "transcript" }

export interface Finding {
  code: string;            // rule code, or "REVIEW" for reviewer findings
  severity: Severity;
  title: string;
  detail: string;
  action?: string;
  evidence: Evidence[];
  source: "rules" | "review";
}

/** One line of "what was read from the documents", shown above the findings. */
export interface Fact { doc: DocType; label: string; value: string }

export interface Report {
  files: { file: string; doc_type: DocType; scanned: boolean }[];
  findings: Finding[];
  counts: Record<Severity, number>;
  missing_docs: DocType[];
  facts?: Fact[];
  seconds: number;
  model: string;
}
