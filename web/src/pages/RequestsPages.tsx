import { useState, type FormEvent, type ReactNode } from "react";
import { api, loadCategories } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice, InfoNotice, Loading } from "../components/Notice";
import { RequireLogin } from "../components/RequireLogin";
import { ReviewForm } from "../components/ReviewForm";
import { navigate, useAction, useAsync } from "../hooks";
import { formatCents, formatDate, humanize, parseDollarsToCents } from "../lib/format";
import { href, hrefWithParams } from "../lib/router";
import type { AssetItem, BoardRequest, Proposal, RequestEvent, User } from "../lib/types";

const BOARD_SORTS = ["newest", "budget_desc", "budget_asc"] as const;

function RequestCard({ request }: { request: BoardRequest }) {
  return (
    <section className="panel">
      <h3>
        <a href={href(`/requests/${request.id}`)}>{request.title}</a> <span className={`status ${request.status}`}>{humanize(request.status)}</span>
      </h3>
      <p className="muted">
        {request.category.name} · budget {formatCents(request.budgetCents)} · {request.proposalCount} proposal{request.proposalCount === 1 ? "" : "s"} · posted by{" "}
        {request.client.displayName} on {formatDate(request.createdAt)}
      </p>
      <p>{request.description.length > 240 ? `${request.description.slice(0, 240)}…` : request.description}</p>
    </section>
  );
}

export function RequestsBoardPage({ query }: { query: URLSearchParams }) {
  const category = query.get("category") ?? "";
  const sortParam = query.get("sort") ?? "";
  const sort = (BOARD_SORTS as readonly string[]).includes(sortParam) ? sortParam : "newest";
  const categories = useAsync(loadCategories, []);
  const board = useAsync(() => api.get<{ requests: BoardRequest[]; total: number }>("/requests", { category, sort, limit: 50 }), [category, sort]);

  const update = (next: { category?: string; sort?: string }): void => {
    const params = new URLSearchParams();
    const nextCategory = next.category ?? category;
    const nextSort = next.sort ?? sort;
    if (nextCategory) params.set("category", nextCategory);
    if (nextSort !== "newest") params.set("sort", nextSort);
    navigate(hrefWithParams("/requests", params));
  };

  return (
    <>
      <h1>Request board</h1>
      <p>
        Need something made? <a className="button" href={href("/requests/new")}>Post a request</a> <a href={href("/requests/mine")}>My requests</a>
      </p>
      <div className="filters">
        <label>
          Category
          <select value={category} onChange={(event) => update({ category: event.target.value })}>
            <option value="">All</option>
            {categories.data?.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(event) => update({ sort: event.target.value })}>
            {BOARD_SORTS.map((entry) => (
              <option key={entry} value={entry}>
                {humanize(entry)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {board.loading ? <Loading /> : <ErrorNotice error={board.error} />}
      {board.data ? <p className="muted">{board.data.total} open request{board.data.total === 1 ? "" : "s"}</p> : null}
      {board.data?.requests.map((request) => (
        <RequestCard key={request.id} request={request} />
      ))}
    </>
  );
}

export function RequestNewPage() {
  return (
    <RequireLogin path="/requests/new" needsWallet>
      <NewRequestForm />
    </RequireLogin>
  );
}

function NewRequestForm() {
  const categories = useAsync(loadCategories, []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [budget, setBudget] = useState("100");
  const [localError, setLocalError] = useState<unknown>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const cents = parseDollarsToCents(budget);
    if (cents === null || cents < 100 || cents > 10_000_000) {
      setLocalError(new Error("Budget must be between $1.00 and $100,000.00."));
      return;
    }
    setLocalError(undefined);
    setError(undefined);
    setBusy(true);
    try {
      const response = await api.post<{ request: BoardRequest }>("/requests", {
        title,
        description,
        category: category || categories.data?.[0]?.slug,
        budgetCents: cents,
      });
      navigate(`/requests/${response.request.id}`);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel narrow" onSubmit={(event) => void submit(event)}>
      <h1>Post a request</h1>
      <ErrorNotice error={localError ?? error} />
      <label>
        Title
        <input value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        What do you need?
        <textarea value={description} rows={5} maxLength={4000} required onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label>
        Category
        <select value={category || (categories.data?.[0]?.slug ?? "")} onChange={(event) => setCategory(event.target.value)}>
          {categories.data?.map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Maximum budget ($)
        <input inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Post request
      </button>
    </form>
  );
}

export function MyRequestsPage() {
  return (
    <RequireLogin path="/requests/mine" needsWallet>
      <MyRequests />
    </RequireLogin>
  );
}

function MyRequests() {
  const { user } = useAuth();
  const mine = useAsync(() => api.get<{ requests: BoardRequest[] }>("/requests/mine"), []);
  const jobs = useAsync(() => (user?.role === "artist" ? api.get<{ requests: BoardRequest[] }>("/requests/assigned") : Promise.resolve({ requests: [] as BoardRequest[] })), [user?.id]);
  return (
    <>
      <h1>My requests</h1>
      {mine.loading ? <Loading /> : <ErrorNotice error={mine.error} />}
      {mine.data && mine.data.requests.length === 0 ? (
        <p className="muted">
          You have not posted a request. <a href={href("/requests/new")}>Post one</a>.
        </p>
      ) : null}
      {mine.data?.requests.map((request) => (
        <RequestCard key={request.id} request={request} />
      ))}
      {user?.role === "artist" ? (
        <>
          <h2>My jobs</h2>
          {jobs.data && jobs.data.requests.length === 0 ? <p className="muted">No accepted jobs yet. Bid on requests from the board.</p> : null}
          {jobs.data?.requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </>
      ) : null}
    </>
  );
}

const FUNDED = ["accepted", "in_progress", "delivered", "revised"];

export function RequestPage({ id }: { id: string }) {
  const { user } = useAuth();
  const request = useAsync(() => api.get<{ request: BoardRequest }>(`/requests/${id}`), [id, user?.id]);
  const proposals = useAsync(
    () => (user ? api.get<{ proposals: Proposal[] }>(`/requests/${id}/proposals`).catch(() => ({ proposals: [] as Proposal[] })) : Promise.resolve({ proposals: [] as Proposal[] })),
    [id, user?.id, request.data?.request.status],
  );
  const events = useAsync(
    () => (user ? api.get<{ events: RequestEvent[] }>(`/requests/${id}/events`).catch(() => ({ events: [] as RequestEvent[] })) : Promise.resolve({ events: [] as RequestEvent[] })),
    [id, user?.id, request.data?.request.status],
  );
  const refresh = (): void => {
    request.reload();
    proposals.reload();
    events.reload();
  };

  if (request.loading && !request.data) return <Loading />;
  if (request.error || !request.data) return <ErrorNotice error={request.error ?? new Error("Request not found")} />;
  const item = request.data.request;

  return (
    <article>
      <h1>
        {item.title} <span className={`status ${item.status}`}>{humanize(item.status)}</span>
      </h1>
      <p className="muted">
        {item.category.name} · budget {formatCents(item.budgetCents)} · posted by {item.client.displayName} on {formatDate(item.createdAt)}
      </p>
      <p>{item.description}</p>
      <Summary request={item} user={user} />
      <Actions request={item} user={user} proposals={proposals.data?.proposals ?? []} onChanged={refresh} />
      {user && (proposals.data?.proposals.length ?? 0) > 0 ? <ProposalList request={item} user={user} proposals={proposals.data?.proposals ?? []} onChanged={refresh} /> : null}
      {events.data && events.data.events.length > 0 ? (
        <>
          <h2>History</h2>
          <ul className="reviews">
            {events.data.events.map((event) => (
              <li key={event.id}>
                <strong>{humanize(event.kind)}</strong> <span className="muted">{formatDate(event.createdAt)}</span>
                {event.note ? <p>{event.note}</p> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

function Summary({ request, user }: { request: BoardRequest; user: User | null }) {
  if (request.priceCents === null) return null;
  const isArtist = user?.id === request.artist?.userId;
  return (
    <section className="panel">
      <p>
        Artist: <strong>{request.artist?.displayName}</strong> · agreed price <strong>{formatCents(request.priceCents)}</strong>
        {isArtist && request.payoutCents !== null ? ` (you receive ${formatCents(request.payoutCents)} after the ${(request.commissionBps ?? 0) / 100}% platform commission)` : ""}
      </p>
      <p className="muted">
        Revisions used {request.revisionsUsed} of {request.maxRevisions ?? 0}
        {request.dueAt ? ` · due ${formatDate(request.dueAt)}` : ""}
        {request.status === "delivered" && request.autoApproveAt ? ` · approved automatically on ${formatDate(request.autoApproveAt)} unless you respond` : ""}
      </p>
      {request.disputeReason ? <p>Dispute: {request.disputeReason}</p> : null}
      {request.resolutionNote ? <p>Moderator note: {request.resolutionNote}</p> : null}
    </section>
  );
}

function Actions({ request, user, proposals, onChanged }: { request: BoardRequest; user: User | null; proposals: Proposal[]; onChanged: () => void }) {
  const { run, error, busy } = useAction(onChanged);
  const [panel, setPanel] = useState<string | null>(null);
  const waitingForReview = request.status === "completed" && user?.id === request.client.userId;
  const reviewable = useAsync<{ requests: { requestId: number }[] }>(
    () => (waitingForReview ? api.get<{ requests: { requestId: number }[] }>("/reviews/reviewable") : Promise.resolve({ requests: [] })),
    [request.id, request.status, waitingForReview],
  );
  if (!user) {
    return (
      <InfoNotice>
        <a href={href("/login", { next: `/requests/${request.id}` })}>Log in</a> to take part.
      </InfoNotice>
    );
  }

  const isClient = user.id === request.client.userId;
  const isWorker = user.id === request.artist?.userId;
  const canBid = user.role === "artist" && !isClient && (request.status === "open" || request.status === "proposed");
  const mine = proposals.find((proposal) => proposal.artist.userId === user.id);
  const buttons: ReactNode[] = [];
  const add = (key: string, label: string, onClick: () => void, secondary = false): void => {
    buttons.push(
      <button key={key} type="button" className={secondary ? "secondary" : undefined} disabled={busy} onClick={onClick}>
        {label}
      </button>,
    );
  };
  const post = (action: string): void => void run(() => api.post(`/requests/${request.id}/${action}`));
  const toggle = (name: string) => (): void => setPanel(panel === name ? null : name);

  if (isClient && (request.status === "open" || request.status === "proposed")) add("cancel", "Cancel request", () => post("cancel"), true);
  if (isWorker && request.status === "accepted") add("start", "Start work", () => post("start"));
  if (isWorker && (request.status === "in_progress" || request.status === "revised")) add("deliver", "Deliver work", toggle("deliver"));
  if (isWorker && ["accepted", "in_progress", "revised"].includes(request.status)) add("withdraw", "Withdraw and refund the client", () => post("withdraw"), true);
  if (isClient && request.status === "delivered") {
    add("approve", "Approve and pay the artist", () => post("approve"));
    add("revise", "Ask for changes", toggle("revise"), true);
  }
  if ((isClient || isWorker) && FUNDED.includes(request.status)) add("dispute", "Report a problem", toggle("dispute"), true);

  const hasDelivery = (isClient || isWorker) && ["delivered", "revised", "completed", "disputed"].includes(request.status) && request.deliveredAt !== null;

  return (
    <section className="panel">
      <ErrorNotice error={error} />
      {reviewable.data?.requests.some((entry) => entry.requestId === request.id) ? (
        <>
          <h3>Leave a review</h3>
          <ReviewForm target={{ requestId: request.id }} onDone={reviewable.reload} />
        </>
      ) : null}
      <p className="actions">
        {buttons}
        {hasDelivery ? (
          <a className="button secondary" href={`/api/requests/${request.id}/delivery`}>
            Download delivery
          </a>
        ) : null}
      </p>
      {panel === "revise" ? <NoteForm label="What should change?" submit="Request changes" busy={busy} onSubmit={(note) => run(() => api.post(`/requests/${request.id}/revise`, { note }))} /> : null}
      {panel === "dispute" ? <NoteForm label="What went wrong?" submit="Open dispute" busy={busy} onSubmit={(reason) => run(() => api.post(`/requests/${request.id}/dispute`, { reason }))} /> : null}
      {panel === "deliver" ? <DeliverForm request={request} onDone={() => { setPanel(null); onChanged(); }} /> : null}
      {canBid ? <BidForm request={request} existing={mine} onChanged={onChanged} /> : null}
    </section>
  );
}

function NoteForm({ label, submit, busy, onSubmit }: { label: string; submit: string; busy: boolean; onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const handle = (event: FormEvent): void => {
    event.preventDefault();
    if (text.trim() !== "") void onSubmit(text.trim());
  };
  return (
    <form onSubmit={handle}>
      <label>
        {label}
        <textarea value={text} rows={3} maxLength={1000} required onChange={(event) => setText(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        {submit}
      </button>
    </form>
  );
}

function DeliverForm({ request, onDone }: { request: BoardRequest; onDone: () => void }) {
  const assets = useAsync(() => api.get<{ assets: AssetItem[] }>("/assets"), []);
  const [assetId, setAssetId] = useState("");
  const [note, setNote] = useState("");
  const { run, error, busy } = useAction(onDone);
  const eligible = assets.data?.assets.filter((asset) => asset.category === request.category.slug) ?? [];
  const chosen = assetId || String(eligible[0]?.id ?? "");

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (chosen) void run(() => api.post(`/requests/${request.id}/deliver`, { assetId: Number(chosen), note }));
  };

  return (
    <form onSubmit={submit}>
      <ErrorNotice error={error} />
      {eligible.length === 0 ? (
        <InfoNotice>
          Upload your finished work to the {request.category.name} category on the <a href={href("/artist")}>dashboard</a> first.
        </InfoNotice>
      ) : (
        <label>
          Finished file
          <select value={chosen} onChange={(event) => setAssetId(event.target.value)}>
            {eligible.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.originalName}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Note to the client (optional)
        <textarea value={note} rows={2} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button type="submit" disabled={busy || eligible.length === 0}>
        Deliver
      </button>
    </form>
  );
}

function BidForm({ request, existing, onChanged }: { request: BoardRequest; existing: Proposal | undefined; onChanged: () => void }) {
  const [price, setPrice] = useState(existing ? String(existing.priceCents / 100) : String(request.budgetCents / 100));
  const [message, setMessage] = useState(existing?.message ?? "");
  const [days, setDays] = useState(String(existing?.deliveryDays ?? 7));
  const [revisions, setRevisions] = useState(String(existing?.maxRevisions ?? 2));
  const [localError, setLocalError] = useState<unknown>(undefined);
  const { run, error, busy } = useAction(onChanged);
  const editing = existing !== undefined && (existing.status === "pending" || existing.status === "withdrawn");
  if (existing && !editing) return null;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const cents = parseDollarsToCents(price);
    if (cents === null || cents < 100 || cents > request.budgetCents) {
      setLocalError(new Error(`Your price must be between $1.00 and the budget of ${formatCents(request.budgetCents)}.`));
      return;
    }
    setLocalError(undefined);
    const body = { priceCents: cents, message, deliveryDays: Number(days), maxRevisions: Number(revisions) };
    void run(() => (existing ? api.put(`/requests/${request.id}/proposals`, body) : api.post(`/requests/${request.id}/proposals`, body)));
  };

  return (
    <form onSubmit={submit}>
      <h3>{existing ? "Your proposal" : "Make a proposal"}</h3>
      <ErrorNotice error={localError ?? error} />
      <label>
        Your price ($)
        <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
      </label>
      <label>
        Message
        <textarea value={message} rows={3} maxLength={2000} required onChange={(event) => setMessage(event.target.value)} />
      </label>
      <label>
        Days to deliver
        <input type="number" min={1} max={365} value={days} onChange={(event) => setDays(event.target.value)} />
      </label>
      <label>
        Revisions included
        <input type="number" min={0} max={5} value={revisions} onChange={(event) => setRevisions(event.target.value)} />
      </label>
      <p className="actions">
        <button type="submit" disabled={busy}>
          {existing ? "Update proposal" : "Send proposal"}
        </button>
        {existing && existing.status === "pending" ? (
          <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => api.del(`/requests/${request.id}/proposals`))}>
            Withdraw
          </button>
        ) : null}
      </p>
    </form>
  );
}

function ProposalList({ request, user, proposals, onChanged }: { request: BoardRequest; user: User; proposals: Proposal[]; onChanged: () => void }) {
  const { run, error, busy } = useAction(onChanged);
  const isClient = user.id === request.client.userId;
  return (
    <>
      <h2>{isClient ? "Proposals" : "Your proposal"}</h2>
      <ErrorNotice error={error} />
      {isClient && request.status === "proposed" ? <p className="muted">Accepting a proposal moves its price from your wallet into escrow. You pay the artist when you approve the finished work.</p> : null}
      {proposals.map((proposal) => (
        <section key={proposal.id} className="panel">
          <h3>
            {proposal.artist.displayName} {proposal.artist.tier === "premium" ? <span className="badge">Premium</span> : null}{" "}
            <span className={`status ${proposal.status}`}>{humanize(proposal.status)}</span>
          </h3>
          <p>
            {formatCents(proposal.priceCents)} · {proposal.deliveryDays} day{proposal.deliveryDays === 1 ? "" : "s"} · {proposal.maxRevisions} revision{proposal.maxRevisions === 1 ? "" : "s"}
          </p>
          <p>{proposal.message}</p>
          {isClient && request.status === "proposed" && proposal.status === "pending" ? (
            <button type="button" disabled={busy} onClick={() => void run(() => api.post(`/requests/${request.id}/accept`, { proposalId: proposal.id }))}>
              Accept for {formatCents(proposal.priceCents)}
            </button>
          ) : null}
        </section>
      ))}
    </>
  );
}
