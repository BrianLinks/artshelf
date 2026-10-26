# 0010: A small React app with pure, tested logic and cookie sessions

## Status
Accepted

## Context
The API is complete enough to drive a real interface. The UI must work offline against the local server, add few dependencies, and stay as verifiable as the back end.

## Decision
- React and Vite, in `web/`, sharing the repository's TypeScript, lint and test setup. Dependencies beyond React are limited to the build tooling.
- Hash routing (`#/listings/5`) through a ~60-line router. The app is static, deep links need no server rewrite in development, and the router is a pure, tested function.
- Logic that can be pure lives in `web/src/lib` with no DOM access: the API client takes `fetch` as a parameter, the search page's state round-trips through the URL, and money, date and star formatting are plain functions. These run in the existing Vitest suite and are also type-checked by the server's TypeScript project.
- Components stay thin and fetch through one `useAsync` hook that ignores stale responses. No global state library: the signed-in user is the only shared state.
- Authentication reuses the server's `HttpOnly` session cookie, so the app stores no credentials. In development Vite proxies `/api`, keeping requests same-origin so the server's origin check passes.
- The API server serves the built app when present, with a content security policy that allows only its own scripts, and falls back to `index.html` for non-API GET paths.

## Consequences
- Components are not covered by automated tests yet; the logic they depend on is. Browser-level tests would be a later addition.
- Hash routes are not indexed by search engines, which is acceptable for an application behind sign-in and an offline demo.
- The screens for the request board, artist dashboard and support tickets use APIs that already exist and are the next UI work.
