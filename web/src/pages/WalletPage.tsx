import { useState, type FormEvent } from "react";
import { api } from "../api";
import { ErrorNotice, InfoNotice, Loading } from "../components/Notice";
import { RequireLogin } from "../components/RequireLogin";
import { useAsync } from "../hooks";
import { formatCents, formatDate, humanize, parseDollarsToCents } from "../lib/format";
import type { WalletEntry } from "../lib/types";

const MIN_CENTS = 100;
const MAX_CENTS = 1_000_000;

export function WalletPage() {
  return (
    <RequireLogin path="/wallet" needsWallet>
      <Wallet />
    </RequireLogin>
  );
}

function Wallet() {
  const wallet = useAsync(() => api.get<{ balanceCents: number; entries: WalletEntry[] }>("/wallet"), []);
  const [amount, setAmount] = useState("50");
  const [error, setError] = useState<unknown>(undefined);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deposit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(undefined);
    setDone(null);
    const cents = parseDollarsToCents(amount);
    if (cents === null || cents < MIN_CENTS || cents > MAX_CENTS) {
      setError(new Error(`Enter an amount from ${formatCents(MIN_CENTS)} to ${formatCents(MAX_CENTS)}.`));
      return;
    }
    setBusy(true);
    try {
      await api.post("/wallet/deposit", { amountCents: cents });
      setDone(`Added ${formatCents(cents)} to your wallet.`);
      wallet.reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Wallet</h1>
      <InfoNotice>This is a simulated wallet. No real money is involved.</InfoNotice>
      {wallet.loading ? <Loading /> : <ErrorNotice error={wallet.error} />}
      {wallet.data ? (
        <>
          <p className="balance">{formatCents(wallet.data.balanceCents)}</p>
          <form className="panel inline-form" onSubmit={(event) => void deposit(event)}>
            <label>
              Add funds ($)
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
            {["10", "50", "100"].map((preset) => (
              <button key={preset} type="button" className="secondary" onClick={() => setAmount(preset)}>
                ${preset}
              </button>
            ))}
            <button type="submit" disabled={busy}>
              Add funds
            </button>
          </form>
          <ErrorNotice error={error} />
          {done ? <InfoNotice>{done}</InfoNotice> : null}

          <h2>History</h2>
          {wallet.data.entries.length === 0 ? <p className="muted">No activity yet.</p> : null}
          <table className="plain">
            <tbody>
              {wallet.data.entries.map((entry) => (
                <tr key={entry.entryId}>
                  <td>{formatDate(entry.createdAt)}</td>
                  <td>{entry.memo || humanize(entry.kind)}</td>
                  <td className={entry.amountCents < 0 ? "negative" : "positive"}>{formatCents(entry.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </>
  );
}
