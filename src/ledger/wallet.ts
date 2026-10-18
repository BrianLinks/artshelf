import { recordAudit } from "../auth/audit.js";
import type { Db } from "../db/connection.js";
import { balanceOf, postEntry, recentWalletEntries, systemAccountId, walletAccountId } from "./ledger.js";

/** Simulated top-up: money enters from the external account. No real payment provider is involved. */
export function deposit(db: Db, userId: number, amountCents: number): number {
  return db.transaction(() => {
    postEntry(db, {
      kind: "deposit",
      memo: "Simulated wallet top-up",
      createdByUserId: userId,
      lines: [
        { accountId: systemAccountId(db, "external"), amountCents: -amountCents },
        { accountId: walletAccountId(db, userId), amountCents },
      ],
    });
    recordAudit(db, { actorUserId: userId, action: "wallet.deposit", targetType: "user", targetId: userId, detail: { amountCents } });
    return balanceOf(db, walletAccountId(db, userId));
  })();
}

export function walletSummary(db: Db, userId: number) {
  return {
    balanceCents: balanceOf(db, walletAccountId(db, userId)),
    entries: recentWalletEntries(db, userId),
  };
}
