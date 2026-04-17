/**
 * Sanitize user- or API-derived strings and numbers for safe chart labels and values.
 */

const MAX_LABEL_LEN = 64;
const MAX_TITLE_LEN = 200;

/** Strip control chars and angle brackets; trim length. */
export function sanitizeLabel(raw: string): string {
  const s = String(raw)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/g, "")
    .trim()
    .slice(0, MAX_LABEL_LEN);
  return s || "?";
}

export function sanitizeTitle(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/g, "")
    .trim()
    .slice(0, MAX_TITLE_LEN);
  return s || undefined;
}

/** Accept finite numbers only; coerce string numbers. */
export function sanitizeValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function clampPoints<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  return arr.slice(0, max);
}
