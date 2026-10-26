import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice, Loading } from "../components/Notice";
import { RequireLogin } from "../components/RequireLogin";
import { ReviewForm } from "../components/ReviewForm";
import { useAction, useAsync } from "../hooks";
import { formatCents, formatDate, humanize } from "../lib/format";
import { href } from "../lib/router";
import type { Order } from "../lib/types";

export function OrdersPage() {
  return (
    <RequireLogin path="/orders" needsWallet>
      <Orders />
    </RequireLogin>
  );
}

function Orders() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"purchases" | "sales">("purchases");
  const isArtist = user?.role === "artist";

  return (
    <>
      <h1>Orders</h1>
      {isArtist ? (
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "purchases"} onClick={() => setTab("purchases")}>
            My purchases
          </button>
          <button type="button" role="tab" aria-selected={tab === "sales"} onClick={() => setTab("sales")}>
            My sales
          </button>
        </div>
      ) : null}
      {tab === "purchases" ? <Purchases /> : <Sales />}
    </>
  );
}

function Purchases() {
  const orders = useAsync(() => api.get<{ orders: Order[] }>("/orders"), []);
  const reviewable = useAsync(() => api.get<{ orders: { orderId: number }[] }>("/reviews/reviewable"), []);
  const toReview = new Set(reviewable.data?.orders.map((entry) => entry.orderId));
  const refresh = (): void => {
    orders.reload();
    reviewable.reload();
  };

  return (
    <>
      {orders.loading ? <Loading /> : <ErrorNotice error={orders.error} />}
      {orders.data && orders.data.orders.length === 0 ? (
        <p className="muted">
          You have not bought anything yet. <a href={href("/search")}>Browse artwork</a>.
        </p>
      ) : null}
      {orders.data?.orders.map((order) => (
        <PurchaseRow key={order.id} order={order} canReview={toReview.has(order.id)} onChanged={refresh} />
      ))}
    </>
  );
}

function Sales() {
  const orders = useAsync(() => api.get<{ orders: Order[] }>("/orders/sales"), []);
  return (
    <>
      {orders.loading ? <Loading /> : <ErrorNotice error={orders.error} />}
      {orders.data && orders.data.orders.length === 0 ? <p className="muted">No sales yet.</p> : null}
      {orders.data?.orders.map((order) => (
        <SaleRow key={order.id} order={order} onChanged={orders.reload} />
      ))}
    </>
  );
}

function OrderSummary({ order }: { order: Order }) {
  return (
    <>
      <h3>
        <a href={href(`/listings/${order.listing.id}`)}>{order.listing.title}</a> <span className={`status ${order.status}`}>{humanize(order.status)}</span>
      </h3>
      <p className="muted">
        {humanize(order.license)} license · {formatCents(order.priceCents)} · bought {formatDate(order.createdAt)}
        {order.status === "escrow" ? ` · released automatically on ${formatDate(order.holdUntil)}` : ""}
      </p>
      {order.disputeReason ? <p>Dispute: {order.disputeReason}</p> : null}
      {order.resolutionNote ? <p>Moderator note: {order.resolutionNote}</p> : null}
    </>
  );
}

function PurchaseRow({ order, canReview, onChanged }: { order: Order; canReview: boolean; onChanged: () => void }) {
  const { run, error, busy } = useAction(onChanged);
  const [panel, setPanel] = useState<"dispute" | "review" | "license" | null>(null);

  return (
    <section className="panel">
      <OrderSummary order={order} />
      <ErrorNotice error={error} />
      <p className="actions">
        {order.status !== "refunded" ? (
          <a className="button secondary" href={`/api/orders/${order.id}/download`}>
            Download
          </a>
        ) : null}
        <button type="button" className="secondary" onClick={() => setPanel(panel === "license" ? null : "license")}>
          License
        </button>
        {order.status === "escrow" ? (
          <>
            <button type="button" disabled={busy} onClick={() => void run(() => api.post(`/orders/${order.id}/confirm`))}>
              Confirm and pay the artist
            </button>
            <button type="button" className="secondary" onClick={() => setPanel(panel === "dispute" ? null : "dispute")}>
              Report a problem
            </button>
          </>
        ) : null}
        {canReview ? (
          <button type="button" className="secondary" onClick={() => setPanel(panel === "review" ? null : "review")}>
            Leave a review
          </button>
        ) : null}
      </p>
      {panel === "license" ? <LicenseGrant orderId={order.id} /> : null}
      {panel === "dispute" ? (
        <TextForm
          label="What went wrong?"
          submit="Open dispute"
          busy={busy}
          onSubmit={(reason) => run(() => api.post(`/orders/${order.id}/dispute`, { reason }))}
        />
      ) : null}
      {panel === "review" ? <ReviewForm target={{ orderId: order.id }} onDone={onChanged} /> : null}
    </section>
  );
}

function SaleRow({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const { run, error, busy } = useAction(onChanged);
  return (
    <section className="panel">
      <OrderSummary order={order} />
      <p className="muted">
        Your payout: {formatCents(order.payoutCents)} after a {order.commissionBps / 100}% platform commission.
      </p>
      <ErrorNotice error={error} />
      {order.status === "escrow" ? (
        <p className="actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => api.post(`/orders/${order.id}/refund`))}>
            Refund the buyer
          </button>
        </p>
      ) : null}
    </section>
  );
}

function LicenseGrant({ orderId }: { orderId: number }) {
  const grant = useAsync(
    () => api.get<{ valid: boolean; licenseName: string; allowedUses: string[]; priceCents: number; grantedAt: string }>(`/orders/${orderId}/license`),
    [orderId],
  );
  if (grant.loading) return <Loading />;
  if (grant.error || !grant.data) return <ErrorNotice error={grant.error} />;
  return (
    <div className="grant">
      <p>
        <strong>{grant.data.licenseName} license</strong> granted {formatDate(grant.data.grantedAt)} {grant.data.valid ? "" : "(no longer valid)"}
      </p>
      <p>You may use this artwork for: {grant.data.allowedUses.map(humanize).join(", ")}.</p>
      <p className="muted">You may not resell the artwork as-is.</p>
    </div>
  );
}

function TextForm({ label, submit, busy, onSubmit }: { label: string; submit: string; busy: boolean; onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const handle = (event: FormEvent): void => {
    event.preventDefault();
    if (text.trim() !== "") void onSubmit(text.trim());
  };
  return (
    <form onSubmit={handle}>
      <label>
        {label}
        <textarea value={text} maxLength={1000} rows={3} required onChange={(event) => setText(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        {submit}
      </button>
    </form>
  );
}
