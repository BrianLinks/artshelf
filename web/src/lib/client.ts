/** A small JSON client for the ArtShelf API. The fetch function is injectable so tests need no network. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Builds an ApiError from a failed response, whatever its body looks like. */
export function toApiError(status: number, text: string): ApiError {
  let error: { code?: string; message?: string; details?: unknown } | undefined;
  try {
    error = (JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown } }).error;
  } catch {
    error = undefined;
  }
  return new ApiError(status, error?.code ?? "http_error", error?.message ?? `Request failed (${status})`, error?.details);
}

export type QueryValue = string | number | boolean | undefined | null;
export type Query = Record<string, QueryValue>;

export function buildQuery(query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export interface Client {
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

type FetchFn = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; credentials?: "same-origin" }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export function createClient(fetchFn: FetchFn, base = "/api"): Client {
  async function request<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetchFn(`${base}${path}${buildQuery(query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const text = await response.text();
    if (!response.ok) throw toApiError(response.status, text);
    let data: unknown;
    if (text !== "") {
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined;
      }
    }
    return data as T;
  }

  return {
    get: (path, query) => request("GET", path, query),
    post: (path, body) => request("POST", path, undefined, body),
    put: (path, body) => request("PUT", path, undefined, body),
    del: (path) => request("DELETE", path),
  };
}

/** A readable message for any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "validation_error" && Array.isArray(error.details)) {
      const parts = (error.details as { path?: string; message?: string }[]).map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message));
      return parts.filter(Boolean).join("; ") || error.message;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
}
