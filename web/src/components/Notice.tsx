import type { ReactNode } from "react";
import { ApiError, describeError } from "../lib/client";
import { href } from "../lib/router";

export function ErrorNotice({ error }: { error: unknown }) {
  if (error === undefined || error === null) return null;
  return (
    <p className="notice error" role="alert">
      {describeError(error)}
      {error instanceof ApiError && error.status === 401 ? (
        <>
          {" "}
          <a href={href("/login")}>Sign in</a>
        </>
      ) : null}
    </p>
  );
}

export function InfoNotice({ children }: { children: ReactNode }) {
  return (
    <p className="notice info" role="status">
      {children}
    </p>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return (
    <p className="muted" aria-live="polite">
      {what}…
    </p>
  );
}
