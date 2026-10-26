import { useState, type FormEvent } from "react";
import { api, loadCategories } from "../api";
import { canTransact, useAuth } from "../auth";
import { navigate, useAsync } from "../hooks";
import { formatCents } from "../lib/format";
import { href } from "../lib/router";
import type { NotificationItem } from "../lib/types";

function SearchBox({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    navigate(href("/search", { q: text.trim() }));
  };
  return (
    <form className="searchbox" role="search" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="site-search">
        Search by inspiration
      </label>
      <input id="site-search" type="search" value={text} maxLength={100} placeholder="Search by Inspiration" onChange={(event) => setText(event.target.value)} />
      <button type="submit">Search</button>
    </form>
  );
}

export function Header({ path, query }: { path: string; query: URLSearchParams }) {
  const { user, loading, logout } = useAuth();
  const categories = useAsync(loadCategories, []);
  const wallet = useAsync<{ balanceCents: number } | undefined>(
    () => (canTransact(user) ? api.get<{ balanceCents: number }>("/wallet") : Promise.resolve(undefined)),
    [user?.id, path],
  );
  const unread = useAsync<{ unreadCount: number; notifications: NotificationItem[] } | undefined>(
    () => (user ? api.get<{ unreadCount: number; notifications: NotificationItem[] }>("/notifications", { unread: "true", limit: 1 }) : Promise.resolve(undefined)),
    [user?.id, path],
  );

  const current = (target: string): "page" | undefined => (path === target || path.startsWith(`${target}/`) ? "page" : undefined);

  return (
    <header className="site-header">
      <div className="bar">
        <a className="brand" href={href("/")}>
          ArtShelf
        </a>
        <nav aria-label="Main">
          <a href={href("/search")} aria-current={current("/search")}>
            Browse
          </a>
          <a href={href("/requests")} aria-current={current("/requests")}>
            Requests
          </a>
          {user?.role === "artist" ? (
            <a href={href("/artist")} aria-current={current("/artist")}>
              Dashboard
            </a>
          ) : null}
          <a href={href("/support")} aria-current={current("/support")}>
            Support
          </a>
        </nav>
        <SearchBox key={path === "/search" ? query.toString() : "other"} initial={path === "/search" ? (query.get("q") ?? "") : ""} />
        <div className="account">
          {loading ? <span className="account-placeholder" aria-hidden="true" /> : user ? (
            <>
              {wallet.data ? <a href={href("/wallet")}>{formatCents(wallet.data.balanceCents)}</a> : null}
              {user.role === "moderator" || user.role === "admin" ? <a href={href("/staff")}>Staff</a> : null}
              <a href={href("/orders")}>Orders</a>
              <a href={href("/notifications")}>
                Inbox{unread.data && unread.data.unreadCount > 0 ? <span className="badge count">{unread.data.unreadCount}</span> : null}
              </a>
              <span className="muted">{user.displayName}</span>
              <button type="button" onClick={() => void logout().then(() => navigate("/"))}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <a href={href("/login")}>Log in</a>
              <a className="button" href={href("/register")} style={{ color: "var(--accent-fg)" }}>
                Create account
              </a>
            </>
          )}
        </div>
      </div>
      <nav className="categories" aria-label="Categories">
        {categories.data?.map((category) => (
          <a
            key={category.slug}
            href={href("/search", { category: category.slug })}
            aria-current={path === "/search" && query.get("category") === category.slug ? "page" : undefined}
          >
            {category.name}
          </a>
        ))}
      </nav>
    </header>
  );
}
