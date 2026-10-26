/** A tiny hash router. "#/listings/5?x=1" is path "/listings/5" with query x=1. */
export interface Location {
  path: string;
  query: URLSearchParams;
}

export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#/, "");
  const cut = raw.indexOf("?");
  const pathPart = cut === -1 ? raw : raw.slice(0, cut);
  const queryPart = cut === -1 ? "" : raw.slice(cut + 1);
  let path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { path, query: new URLSearchParams(queryPart) };
}

export const ROUTES = [
  { name: "home", pattern: "/" },
  { name: "search", pattern: "/search" },
  { name: "listing", pattern: "/listings/:id" },
  { name: "login", pattern: "/login" },
  { name: "register", pattern: "/register" },
  { name: "wallet", pattern: "/wallet" },
  { name: "orders", pattern: "/orders" },
  { name: "notifications", pattern: "/notifications" },
  { name: "help", pattern: "/help" },
  { name: "help-article", pattern: "/help/:slug" },
  { name: "artist", pattern: "/artist" },
  { name: "requests", pattern: "/requests" },
  { name: "request-new", pattern: "/requests/new" },
  { name: "requests-mine", pattern: "/requests/mine" },
  { name: "request", pattern: "/requests/:id" },
  { name: "support", pattern: "/support" },
  { name: "ticket", pattern: "/support/:id" },
] as const;

export type RouteName = (typeof ROUTES)[number]["name"];

export interface RouteMatch {
  name: RouteName;
  params: Record<string, string>;
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function matchRoute(path: string): RouteMatch | null {
  const segments = path.split("/").filter((segment) => segment !== "");
  for (const route of ROUTES) {
    const pattern = route.pattern.split("/").filter((segment) => segment !== "");
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      const expected = pattern[i] as string;
      const actual = segments[i] as string;
      if (expected.startsWith(":")) {
        const value = decode(actual);
        if (value === null || value === "") {
          ok = false;
          break;
        }
        params[expected.slice(1)] = value;
      } else if (expected !== actual) {
        ok = false;
        break;
      }
    }
    if (ok) return { name: route.name, params };
  }
  return null;
}

/** Builds a link target such as "#/search?q=cat". Empty and undefined values are left out. */
export function href(path: string, query?: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return `#${path}${text ? `?${text}` : ""}`;
}

/** Like href, for a query that is already a URLSearchParams. */
export function hrefWithParams(path: string, params: URLSearchParams): string {
  const text = params.toString();
  return `#${path}${text ? `?${text}` : ""}`;
}
