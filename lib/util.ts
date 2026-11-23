// Small helpers: Hebrew-aware normalization, names, IDs, dates, money.

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
const NIKUD = /[֑-ׇ]/g;

export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .replace(BIDI, "")
    .replace(NIKUD, "")
    .replace(/[״"'׳`’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Company/bank names: drop legal suffixes, "(בדוי)", the word "בנק", punctuation. */
export function normOrg(s: string | null | undefined): string {
  return norm(s)
    .replace(/[()]/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !ORG_STOP.has(w) && !ORG_STOP.has(rev(w)))
    .join(" ");
}

const ORG_STOP = new Set(["בנק", "בעמ", "בע", "מ", "בדוי", "בדויה"]);

/** Reverse a string. PDF text layers often store Hebrew in visual order ("יול דוד" for "דוד לוי"). */
export function rev(s: string): string {
  return [...s].reverse().join("");
}

export function normName(s: string | null | undefined): string {
  return norm(s).replace(/[^\u05d0-\u05eaA-Za-z ]/g, "").replace(/\s+/g, " ").trim();
}

export function normId(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** Same person by name. Tolerates swapped word order and words stored in visual (reversed) order. */
export function sameName(a?: string | null, b?: string | null): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const key = (w: string[]) => [...w].sort().join(" ");
  const xs = x.split(" "), ys = y.split(" ");
  if (key(xs) === key(ys) || key(xs) === key(ys.map(rev))) return true;
  // titles/extra words ("גב' שרה מזרחי"): all words of the shorter name appear in the longer one
  const [s, l] = xs.length <= ys.length ? [xs, ys] : [ys, xs];
  return s.length >= 2 && (s.every((w) => l.includes(w)) || s.every((w) => l.map(rev).includes(w)));
}

/** Names that differ by a small typo (e.g. אלקבץ / אלקבס). */
export function similarName(a?: string | null, b?: string | null): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y || x === y) return false;
  return levenshtein(x, y) <= 2;
}

export function sameOrg(a?: string | null, b?: string | null): boolean {
  const x = normOrg(a), y = normOrg(b);
  if (!x || !y) return false;
  const tx = x.split(" "), ty = y.split(" ");
  const sub = (p: string[], q: string[]) => p.every((w) => q.includes(w) || q.includes(rev(w)));
  return sub(tx, ty) || sub(ty, tx);
}

/** Same ID number, also when the digits came out reversed. */
export function sameId(a?: string | null, b?: string | null): boolean {
  const x = normId(a), y = normId(b);
  return !!x && !!y && (x === y || x === rev(y));
}

/** Two IDs that differ only by swapped adjacent digits. */
export function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diff: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

export function parseDate(s?: string | null): Date | null {
  const t = s ?? "";
  const m = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/) ?? rev(t).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function parseMoney(s?: string | null): number | null {
  const digits = (s ?? "").replace(/[^\d.]/g, "");
  if (!digits) return null;
  const v = Number(digits);
  return Number.isFinite(v) ? v : null;
}

export function ils(n: number): string {
  return n.toLocaleString("en-US") + " ₪";
}

export function parseArea(s?: string | null): number | null {
  const m = (s ?? "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Fractions like "1/2", "בשלמות". Returns a number or null. */
export function parseShare(s?: string | null): number | null {
  const t = norm(s);
  if (/בשלמות|שלם/.test(t)) return 1;
  const m = t.match(/(\d+)\s*\/\s*(\d+)/);
  return m ? Number(m[1]) / Number(m[2]) : null;
}

/** Normalized attachment mark: "מ-5" / "מ 5" / "5" -> "5"-ish key with type letter kept when present. */
export function markKey(s?: string | null): string {
  return norm(s).replace(/[^\p{L}\p{N}]/gu, "");
}

export function sameMark(a?: string | null, b?: string | null): boolean {
  const x = markKey(a), y = markKey(b);
  if (!x || !y) return false;
  if (x === y || x === rev(y)) return true;
  // same letter + same number in any order: "ח12" / "12ח"
  const parts = (k: string) => [k.replace(/\d/g, ""), k.replace(/\D/g, "")];
  const [lx, nx] = parts(x), [ly, ny] = parts(y);
  return nx === ny && (lx === ly || lx === rev(ly));
}

export function attachmentType(desc: string): string {
  const d0 = norm(desc);
  const d = /מחסן|חני|גינ|גג/.test(d0) ? d0 : rev(d0);
  if (/מחסן/.test(d)) return "מחסן";
  if (/חני/.test(d)) return "חניה";
  if (/גינ|גן/.test(d)) return "גינה";
  if (/גג/.test(d)) return "גג";
  return d0;
}

/** Same party: same ID number, or same name. */
export function sameParty(a: { name?: string | null; id?: string | null }, b: { name?: string | null; id?: string | null }): boolean {
  return sameId(a.id, b.id) || sameName(a.name, b.name);
}
