/** Display helpers. Pure functions with no DOM access, so they run under Node in tests. */

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Parses what a person types into a dollar field ("12", "12.5", "$1,200.05") into whole cents, or null if invalid. */
export function parseDollarsToCents(input: string): number | null {
  const match = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = Number((match[1] as string).replace(/,/g, ""));
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "21 Oct 2026" in UTC, or an empty string for an invalid date. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export interface StarParts {
  full: number;
  half: boolean;
  empty: number;
}

/** Splits an average rating into whole, half and empty stars (rounded to the nearest half). */
export function starParts(average: number | null): StarParts {
  if (average === null) return { full: 0, half: false, empty: 5 };
  const halves = Math.max(0, Math.min(10, Math.round(average * 2)));
  const full = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  return { full, half, empty: 5 - full - (half ? 1 : 0) };
}

/** "non_commercial" becomes "Non commercial"; "resale_as_is" becomes "Resale as is". */
export function humanize(code: string): string {
  const text = code.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Strips a leading # so a hex color can go in a URL. */
export function colorParam(hex: string): string {
  return hex.replace(/^#/, "").toLowerCase();
}

export function isHexColor(value: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** Turns a color from the page's color input ("#rrggbb") into the API's form, or an empty string if it is not a color. */
export function normalizeColor(value: string): string {
  return isHexColor(value) ? colorParam(value.trim()) : "";
}

/** The value a <input type="color"> needs: "#rrggbb". Short or invalid input becomes a neutral default. */
export function toColorInputValue(hex: string): string {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "#dc1414";
  let digits = (match[1] as string).toLowerCase();
  if (digits.length === 3) digits = [...digits].map((digit) => digit + digit).join("");
  return `#${digits}`;
}
