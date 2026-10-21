export const MAX_QUERY_TOKENS = 8;
export const MAX_TOKEN_LENGTH = 40;

export interface TextQuery {
  /** The FTS5 MATCH expression, or null when the input held no searchable words. */
  match: string | null;
  tokens: string[];
}

/**
 * Turns whatever a person typed into a safe FTS5 expression. Only letters and digits survive, accents are folded,
 * and every word is quoted as a prefix term, so operators such as OR, NEAR or quotes are treated as plain words
 * and can never break the query. Words are combined with AND.
 */
export function toMatchQuery(input: string): TextQuery {
  const words = input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  const tokens = [...new Set((words ?? []).map((word) => word.slice(0, MAX_TOKEN_LENGTH)))].slice(0, MAX_QUERY_TOKENS);
  return { match: tokens.length > 0 ? tokens.map((token) => `"${token}"*`).join(" ") : null, tokens };
}
