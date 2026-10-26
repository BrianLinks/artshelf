import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice, InfoNotice, Loading } from "../components/Notice";
import { RequireLogin } from "../components/RequireLogin";
import { navigate, useAction, useAsync } from "../hooks";
import { formatDate, humanize } from "../lib/format";
import { href } from "../lib/router";
import type { TicketDetail, TicketSummary } from "../lib/types";

const CATEGORIES = ["account", "payment", "order", "technical", "other"] as const;
const STATUSES = ["open", "pending_user", "resolved", "closed"] as const;

export function SupportPage() {
  return (
    <RequireLogin path="/support">
      <Support />
    </RequireLogin>
  );
}

function Support() {
  const { user } = useAuth();
  const isStaff = user?.role === "moderator" || user?.role === "admin";
  return (
    <>
      <h1>Support</h1>
      <p>
        Looking for answers first? Try the <a href={href("/help")}>help center</a>.
      </p>
      {isStaff ? <StaffQueue /> : null}
      <MyTickets />
      <NewTicketForm />
    </>
  );
}

function TicketList({ tickets }: { tickets: TicketSummary[] }) {
  return (
    <ul className="articles">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <a href={href(`/support/${ticket.id}`)}>{ticket.subject}</a> <span className={`status ${ticket.status}`}>{humanize(ticket.status)}</span>
          <p className="muted">
            {humanize(ticket.category)} · {ticket.requester.displayName} · updated {formatDate(ticket.updatedAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function MyTickets() {
  const tickets = useAsync(() => api.get<{ tickets: TicketSummary[] }>("/support/tickets"), []);
  return (
    <>
      <h2>My tickets</h2>
      {tickets.loading ? <Loading /> : <ErrorNotice error={tickets.error} />}
      {tickets.data && tickets.data.tickets.length === 0 ? <p className="muted">You have no tickets.</p> : null}
      {tickets.data ? <TicketList tickets={tickets.data.tickets} /> : null}
    </>
  );
}

function StaffQueue() {
  const [status, setStatus] = useState<string>("open");
  const queue = useAsync(() => api.get<{ tickets: TicketSummary[] }>("/support/queue", { status }), [status]);
  return (
    <section className="panel">
      <h2>Staff queue</h2>
      <label>
        Show
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {STATUSES.map((entry) => (
            <option key={entry} value={entry}>
              {humanize(entry)}
            </option>
          ))}
        </select>
      </label>
      {queue.loading ? <Loading /> : <ErrorNotice error={queue.error} />}
      {queue.data && queue.data.tickets.length === 0 ? <p className="muted">Nothing in this queue.</p> : null}
      {queue.data ? <TicketList tickets={queue.data.tickets} /> : null}
    </section>
  );
}

function NewTicketForm() {
  const [category, setCategory] = useState<string>("other");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.post<{ ticket: TicketDetail }>("/support/tickets", { category, subject, message });
      navigate(`/support/${response.ticket.id}`);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={(event) => void submit(event)}>
      <h2>Open a ticket</h2>
      <ErrorNotice error={error} />
      <label>
        Topic
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          {CATEGORIES.map((entry) => (
            <option key={entry} value={entry}>
              {humanize(entry)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Subject
        <input value={subject} maxLength={120} required onChange={(event) => setSubject(event.target.value)} />
      </label>
      <label>
        How can we help?
        <textarea value={message} rows={4} maxLength={4000} required onChange={(event) => setMessage(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Send
      </button>
    </form>
  );
}

export function TicketPage({ id }: { id: string }) {
  return (
    <RequireLogin path={`/support/${id}`}>
      <Ticket id={id} />
    </RequireLogin>
  );
}

function Ticket({ id }: { id: string }) {
  const { user } = useAuth();
  const isStaff = user?.role === "moderator" || user?.role === "admin";
  const ticket = useAsync(() => api.get<{ ticket: TicketDetail }>(`/support/tickets/${id}`), [id]);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const { run, error, busy } = useAction(() => {
    setBody("");
    ticket.reload();
  });

  if (ticket.loading && !ticket.data) return <Loading />;
  if (ticket.error || !ticket.data) return <ErrorNotice error={ticket.error ?? new Error("Ticket not found")} />;
  const item = ticket.data.ticket;
  const closed = item.status === "closed";

  const send = (event: FormEvent): void => {
    event.preventDefault();
    if (body.trim() !== "") void run(() => api.post(`/support/tickets/${id}/messages`, { body: body.trim(), internal: isStaff && internal }));
  };

  return (
    <>
      <p>
        <a href={href("/support")}>← Support</a>
      </p>
      <h1>
        {item.subject} <span className={`status ${item.status}`}>{humanize(item.status)}</span>
      </h1>
      <p className="muted">
        {humanize(item.category)} · opened by {item.requester.displayName} on {formatDate(item.createdAt)}
        {item.assignee ? ` · handled by ${item.assignee.displayName}` : ""}
      </p>
      <ul className="reviews">
        {item.messages.map((message) => (
          <li key={message.id} className={message.internal ? "internal" : undefined}>
            <strong>{message.author.displayName}</strong> {message.author.staff ? <span className="badge">Staff</span> : null}{" "}
            {message.internal ? <span className="badge">Internal note</span> : null} <span className="muted">{formatDate(message.createdAt)}</span>
            <p>{message.body}</p>
          </li>
        ))}
      </ul>
      <ErrorNotice error={error} />
      {closed ? (
        <InfoNotice>This ticket is closed. Open a new ticket if you still need help.</InfoNotice>
      ) : (
        <form className="panel" onSubmit={send}>
          <label>
            Reply
            <textarea value={body} rows={3} maxLength={4000} required onChange={(event) => setBody(event.target.value)} />
          </label>
          {isStaff ? (
            <label className="inline">
              <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> Internal note (the requester cannot see it)
            </label>
          ) : null}
          <p className="actions">
            <button type="submit" disabled={busy}>
              Send reply
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => api.post(`/support/tickets/${id}/close`))}>
              Close ticket
            </button>
            {isStaff ? (
              <>
                <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => api.post(`/support/tickets/${id}/assign`))}>
                  Assign to me
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => api.post(`/support/tickets/${id}/resolve`))}>
                  Mark resolved
                </button>
              </>
            ) : null}
          </p>
        </form>
      )}
    </>
  );
}
