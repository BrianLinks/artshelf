import type { ReactNode } from "react";
import { canTransact, useAuth } from "../auth";
import { href } from "../lib/router";
import { InfoNotice, Loading } from "./Notice";

/** Shows its children only to a signed-in person. `needsWallet` also requires a client or artist account. */
export function RequireLogin({ path, needsWallet = false, children }: { path: string; needsWallet?: boolean; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) {
    return (
      <InfoNotice>
        Please <a href={href("/login", { next: path })}>log in</a> or <a href={href("/register")}>register</a> to continue.
      </InfoNotice>
    );
  }
  if (needsWallet && !canTransact(user)) return <InfoNotice>This page is for client and artist accounts.</InfoNotice>;
  return <>{children}</>;
}
