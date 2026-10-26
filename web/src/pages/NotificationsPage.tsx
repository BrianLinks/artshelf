import { api } from "../api";
import { ErrorNotice, Loading } from "../components/Notice";
import { RequireLogin } from "../components/RequireLogin";
import { useAsync } from "../hooks";
import { formatDate } from "../lib/format";
import { href } from "../lib/router";
import type { NotificationItem } from "../lib/types";

export function NotificationsPage() {
  return (
    <RequireLogin path="/notifications">
      <Inbox />
    </RequireLogin>
  );
}

function linkFor(item: NotificationItem): string | null {
  switch (item.ref?.type) {
    case "order":
      return href("/orders");
    case "request":
      return href(`/requests/${item.ref.id}`);
    case "ticket":
      return href(`/support/${item.ref.id}`);
    case "listing":
      return href(`/listings/${item.ref.id}`);
    default:
      return null;
  }
}

function Inbox() {
  const inbox = useAsync(() => api.get<{ notifications: NotificationItem[]; unreadCount: number }>("/notifications", { limit: 50 }), []);

  const markRead = async (id: number): Promise<void> => {
    await api.post(`/notifications/${id}/read`);
    inbox.reload();
  };
  const markAll = async (): Promise<void> => {
    await api.post("/notifications/read-all");
    inbox.reload();
  };

  return (
    <>
      <h1>Inbox</h1>
      {inbox.loading ? <Loading /> : <ErrorNotice error={inbox.error} />}
      {inbox.data ? (
        <>
          <p>
            {inbox.data.unreadCount} unread{" "}
            {inbox.data.unreadCount > 0 ? (
              <button type="button" className="secondary" onClick={() => void markAll()}>
                Mark all read
              </button>
            ) : null}
          </p>
          {inbox.data.notifications.length === 0 ? <p className="muted">Nothing here yet.</p> : null}
          <ul className="inbox">
            {inbox.data.notifications.map((item) => {
              const link = linkFor(item);
              return (
                <li key={item.id} className={item.read ? "read" : "unread"}>
                  <strong>{item.title}</strong> <span className="muted">{formatDate(item.createdAt)}</span>
                  <p>{item.body}</p>
                  <p className="actions">
                    {link ? <a href={link}>Open</a> : null}
                    {item.read ? null : (
                      <button type="button" className="link" onClick={() => void markRead(item.id)}>
                        Mark read
                      </button>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </>
  );
}
