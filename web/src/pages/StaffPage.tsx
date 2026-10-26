import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice, InfoNotice, Loading } from "../components/Notice";
import { RequireLogin } from "../components/RequireLogin";
import { useAction, useAsync } from "../hooks";
import { formatCents, formatDate, humanize } from "../lib/format";
import { href } from "../lib/router";
import type { BoardRequest, MyProfile, Order, ReviewReport, TakedownNotice } from "../lib/types";

type Tab = "artists" | "disputes" | "reviews" | "copyright";
const TABS: { id: Tab; label: string }[] = [
  { id: "artists", label: "Artist approvals" },
  { id: "disputes", label: "Disputes" },
  { id: "reviews", label: "Review reports" },
  { id: "copyright", label: "Copyright notices" },
];

export function StaffPage() {
  return (
    <RequireLogin path="/staff">
      <StaffGate />
    </RequireLogin>
  );
}

function StaffGate() {
  const { user } = useAuth();
  if (user?.role !== "moderator" && user?.role !== "admin") return <InfoNotice>This page is for moderators and admins.</InfoNotice>;
  return <Console />;
}

function Console() {
  const [tab, setTab] = useState<Tab>("artists");
  return (
    <>
      <h1>Staff console</h1>
      <p className="muted">
        Support tickets are in the <a href={href("/support")}>support queue</a>.
      </p>
      <div className="tabs" role="tablist">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>
      {tab === "artists" ? <ArtistApprovals /> : null}
      {tab === "disputes" ? <Disputes /> : null}
      {tab === "reviews" ? <ReviewReports /> : null}
      {tab === "copyright" ? <CopyrightNotices /> : null}
    </>
  );
}

interface Option {
  label: string;
  /** Sends the decision. The staff member's note is passed in. */
  send: (note: string) => Promise<unknown>;
  secondary?: boolean;
}

/** A note box and one or more decision buttons. Calls `onDone` after a decision is saved. */
function DecisionBar({ options, onDone, placeholder = "Note (optional)" }: { options: Option[]; onDone: () => void; placeholder?: string }) {
  const [note, setNote] = useState("");
  const { run, error, busy } = useAction(onDone);
  return (
    <div className="decision">
      <ErrorNotice error={error} />
      <input value={note} maxLength={500} placeholder={placeholder} aria-label={placeholder} onChange={(event) => setNote(event.target.value)} />
      <p className="actions">
        {options.map((option) => (
          <button key={option.label} type="button" className={option.secondary ? "secondary" : undefined} disabled={busy} onClick={() => void run(() => option.send(note.trim()))}>
            {option.label}
          </button>
        ))}
      </p>
    </div>
  );
}

const withNote = (note: string): { note?: string } => (note === "" ? {} : { note });

function ArtistApprovals() {
  const [status, setStatus] = useState("pending");
  const artists = useAsync(() => api.get<{ artists: MyProfile[] }>("/moderation/artists", { status, limit: 50 }), [status]);
  return (
    <section>
      <label>
        Show
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {["pending", "approved", "rejected"].map((entry) => (
            <option key={entry} value={entry}>
              {humanize(entry)}
            </option>
          ))}
        </select>
      </label>
      {artists.loading ? <Loading /> : <ErrorNotice error={artists.error} />}
      {artists.data && artists.data.artists.length === 0 ? <p className="muted">Nobody is waiting here.</p> : null}
      {artists.data?.artists.map((artist) => (
        <section key={artist.userId} className="panel">
          <h3>
            {artist.displayName} <span className={`status ${artist.status}`}>{humanize(artist.status)}</span>
          </h3>
          <p className="muted">Specialty: {humanize(artist.specialty.replace(/-/g, " "))}</p>
          <p>{artist.bio}</p>
          <DecisionBar
            onDone={artists.reload}
            placeholder="Reason (optional, kept in the audit log)"
            options={[
              ...(artist.status !== "approved" ? [{ label: "Approve", send: () => api.post(`/moderation/artists/${artist.userId}/approve`) }] : []),
              ...(artist.status !== "rejected" ? [{ label: "Reject", secondary: true, send: (note: string) => api.post(`/moderation/artists/${artist.userId}/reject`, note ? { reason: note } : {}) }] : []),
            ]}
          />
        </section>
      ))}
    </section>
  );
}

function Disputes() {
  const orders = useAsync(() => api.get<{ orders: Order[] }>("/moderation/orders", { status: "disputed", limit: 50 }), []);
  const requests = useAsync(() => api.get<{ requests: BoardRequest[] }>("/moderation/requests", { status: "disputed", limit: 50 }), []);
  return (
    <section>
      <h2>Disputed sales</h2>
      {orders.loading ? <Loading /> : <ErrorNotice error={orders.error} />}
      {orders.data && orders.data.orders.length === 0 ? <p className="muted">No disputed sales.</p> : null}
      {orders.data?.orders.map((order) => (
        <section key={order.id} className="panel">
          <h3>
            <a href={href(`/listings/${order.listing.id}`)}>{order.listing.title}</a> · {formatCents(order.priceCents)}
          </h3>
          <p className="muted">
            Artist {order.artist.displayName} · {humanize(order.license)} license · bought {formatDate(order.createdAt)}
          </p>
          <p>Buyer's reason: {order.disputeReason}</p>
          <DecisionBar
            onDone={orders.reload}
            options={[
              { label: "Release to the artist", send: (note) => api.post(`/moderation/orders/${order.id}/resolve`, { outcome: "release", ...withNote(note) }) },
              { label: "Refund the buyer", secondary: true, send: (note) => api.post(`/moderation/orders/${order.id}/resolve`, { outcome: "refund", ...withNote(note) }) },
            ]}
          />
        </section>
      ))}

      <h2>Disputed commissions</h2>
      {requests.loading ? <Loading /> : <ErrorNotice error={requests.error} />}
      {requests.data && requests.data.requests.length === 0 ? <p className="muted">No disputed commissions.</p> : null}
      {requests.data?.requests.map((request) => (
        <section key={request.id} className="panel">
          <h3>
            <a href={href(`/requests/${request.id}`)}>{request.title}</a> · {formatCents(request.priceCents ?? 0)}
          </h3>
          <p className="muted">
            Client {request.client.displayName} · artist {request.artist?.displayName}
          </p>
          <p>Reason: {request.disputeReason}</p>
          <DecisionBar
            onDone={requests.reload}
            options={[
              { label: "Release to the artist", send: (note) => api.post(`/moderation/requests/${request.id}/resolve`, { outcome: "release", ...withNote(note) }) },
              { label: "Refund the client", secondary: true, send: (note) => api.post(`/moderation/requests/${request.id}/resolve`, { outcome: "refund", ...withNote(note) }) },
            ]}
          />
        </section>
      ))}
    </section>
  );
}

function ReviewReports() {
  const [status, setStatus] = useState("flagged");
  const reviews = useAsync(() => api.get<{ reviews: ReviewReport[] }>("/moderation/reviews", { status, limit: 50 }), [status]);
  return (
    <section>
      <label>
        Show
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="flagged">Reported</option>
          <option value="hidden">Hidden</option>
        </select>
      </label>
      {reviews.loading ? <Loading /> : <ErrorNotice error={reviews.error} />}
      {reviews.data && reviews.data.reviews.length === 0 ? <p className="muted">Nothing to review.</p> : null}
      {reviews.data?.reviews.map((review) => (
        <section key={review.id} className="panel">
          <h3>
            {review.rating} star{review.rating === 1 ? "" : "s"} by {review.reviewer.displayName} <span className="muted">{formatDate(review.createdAt)}</span>
          </h3>
          <p>{review.comment || <span className="muted">(no comment)</span>}</p>
          <ul>
            {review.flags.map((flag, index) => (
              <li key={index}>
                {humanize(flag.reason)}
                {flag.note ? `: ${flag.note}` : ""} {flag.resolved ? <span className="muted">(closed)</span> : null}
              </li>
            ))}
          </ul>
          <DecisionBar
            onDone={reviews.reload}
            options={
              status === "flagged"
                ? [
                    { label: "Hide the review", send: (note) => api.post(`/moderation/reviews/${review.id}/hide`, withNote(note)) },
                    { label: "Dismiss the reports", secondary: true, send: (note) => api.post(`/moderation/reviews/${review.id}/dismiss`, withNote(note)) },
                  ]
                : [{ label: "Restore the review", send: (note) => api.post(`/moderation/reviews/${review.id}/restore`, withNote(note)) }]
            }
          />
        </section>
      ))}
    </section>
  );
}

function CopyrightNotices() {
  const [status, setStatus] = useState("received");
  const notices = useAsync(() => api.get<{ notices: TakedownNotice[] }>("/moderation/takedowns", { status, limit: 50 }), [status]);
  return (
    <section>
      <label>
        Show
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {["received", "upheld", "counter_noticed", "reinstated", "closed", "rejected"].map((entry) => (
            <option key={entry} value={entry}>
              {humanize(entry)}
            </option>
          ))}
        </select>
      </label>
      {notices.loading ? <Loading /> : <ErrorNotice error={notices.error} />}
      {notices.data && notices.data.notices.length === 0 ? <p className="muted">No notices in this state.</p> : null}
      {notices.data?.notices.map((notice) => (
        <section key={notice.id} className="panel">
          <h3>
            <a href={href(`/listings/${notice.listing.id}`)}>{notice.listing.title}</a> <span className={`status ${notice.status}`}>{humanize(notice.status)}</span>
          </h3>
          <p className="muted">
            Filed by {notice.claimant.displayName} on {formatDate(notice.createdAt)}, signed "{notice.signature}"
          </p>
          <p>{notice.workDescription}</p>
          {notice.originalUrl ? <p className="muted">Original: {notice.originalUrl}</p> : null}
          {notice.counterStatement ? (
            <p>
              <strong>Artist's counter-notice</strong> (signed "{notice.counterSignature}"): {notice.counterStatement}
            </p>
          ) : null}
          {notice.resolutionNote ? <p className="muted">Note: {notice.resolutionNote}</p> : null}
          {notice.status === "received" ? (
            <DecisionBar
              onDone={notices.reload}
              options={[
                { label: "Uphold and remove the listing", send: (note) => api.post(`/moderation/takedowns/${notice.id}/uphold`, withNote(note)) },
                { label: "Reject the notice", secondary: true, send: (note) => api.post(`/moderation/takedowns/${notice.id}/reject`, withNote(note)) },
              ]}
            />
          ) : null}
          {notice.status === "counter_noticed" ? (
            <DecisionBar
              onDone={notices.reload}
              options={[
                { label: "Reinstate the listing", send: (note) => api.post(`/moderation/takedowns/${notice.id}/reinstate`, withNote(note)) },
                { label: "Keep it removed and close", secondary: true, send: (note) => api.post(`/moderation/takedowns/${notice.id}/close`, withNote(note)) },
              ]}
            />
          ) : null}
        </section>
      ))}
    </section>
  );
}
