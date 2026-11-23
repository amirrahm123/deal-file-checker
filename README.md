# Deal File Checker

**AI document review for Israeli real-estate lawyers.** Upload the documents of an apartment sale (land-registry extract, sale agreement, bank payoff letter, pledges-registry report), including scanned ones, and get every contradiction between them, with a verified quote from the source document for each finding.

[Hebrew README](README.he.md) · [Live demo, lighter version](https://amirrahm.dev/legal) · Built by [Amir Rahm](https://amirrahm.dev)

## Results

The eval runs on 6 synthetic deal files, each with a hand-written answer key. An LLM judge matches the reported findings against the expected ones:

| Case | What it tests | Expected | Found | Invented |
|---|---|---|---|---|
| case01 | A deal with many problems | 11 | 11 | 0 |
| case02 | A clean deal (any finding is a false positive) | 0 | 0 | 0 |
| case03 | A sale by heirs | 3 | 3 | 0 |
| case04 | Israel Land Authority lease + a lien | 4 | 4 | 0 |
| case05 | Subtle gaps + a trap | 2 | 2 | 0 |
| case06 | All documents scanned (vision only) | 2 | 2 | 0 |
| **Total** | | **22** | **22** | **0** |

The full output for each case is in [`eval-results/`](eval-results). All case files are fictional.

## How it works

The design splits the work so that the LLM reads and a deterministic engine decides:

```
PDFs ──► 1. Extract (Claude) ──► structured facts + a quote for each fact
                                     │
                                     ▼
         2. Rules engine (TypeScript, no LLM) ──► findings: same files → same findings, every time
                                     │
         3. Review pass (Claude) ──► extra findings the rules don't cover, kept only if their quote exists
                                     │
                                     ▼
         4. Quote verification ──► every quote is checked against the PDF's own text layer
                                   (or against the transcript, for scans); unmatched → "check manually"
```

1. **Extraction** ([`lib/extract.ts`](lib/extract.ts), [`lib/schema.ts`](lib/schema.ts)). Each PDF goes to Claude as a document block. Tool use with a strict JSON schema returns the document type, a full transcript and structured data (owners, ID numbers, parcel, mortgages, warning notes, liens, payments), with a quote for every field. Scanned PDFs are read through Claude's vision.
2. **Rules engine** ([`lib/rules.ts`](lib/rules.ts)). 26 deterministic cross-document checks: registered owners vs. sellers, ID numbers, block/parcel/sub-parcel, area, attachments, mortgage lender, warning notes, liens, pledges, payoff balance vs. the bank payment, bank-letter validity vs. the payment date, sum of payments vs. price, extract freshness, leasehold from the Israel Land Authority, inheritance.
3. **Review pass** ([`lib/review.ts`](lib/review.ts)). Claude reads the whole file and looks for problems the rules don't cover. A finding survives only if its quote is found in a document.
4. **Quote verification** ([`lib/verify.ts`](lib/verify.ts)). Hebrew-aware normalisation, then an exact check against the PDF text extracted locally with `unpdf`, independent of the model.

Documents are processed in memory and never stored.

## Stack

Next.js 15 (App Router) · TypeScript · Claude API (tool use, PDF/vision) · `unpdf` for the PDF text layer · `tsx` scripts for tests and evals · GitHub Actions CI

## Run it

```bash
npm install
npm run test:rules     # rules engine on all 6 cases, from saved fixtures: no API key, free
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm run eval           # full pipeline on all 6 cases, scored against the answer keys
npm run dev            # web app on http://localhost:3000
```

`npm run eval -- case01 case05` runs selected cases. `npm run eval -- --no-review` skips the review pass.

## Known limits

- Evaluated on synthetic files only. It was also run on one real land-registry extract, which is not included here for privacy reasons. The next step is a pilot on real, redacted deal files.
- It assists the lawyer. It does not replace their review or judgement.
