import { useState, type FormEvent } from "react";
import { api } from "../api";
import { canTransact, useAuth } from "../auth";
import { ErrorNotice, InfoNotice, Loading } from "../components/Notice";
import { Stars } from "../components/Stars";
import { useAction, useAsync } from "../hooks";
import { ApiError } from "../lib/client";
import { formatCents, formatDate, humanize } from "../lib/format";
import { href } from "../lib/router";
import type { LicenseDefinition, Listing, Order, Review } from "../lib/types";

export function ListingPage({ id }: { id: string }) {
  const { user } = useAuth();
  const listing = useAsync(() => api.get<{ listing: Listing }>(`/listings/${id}`), [id]);
  const licenses = useAsync(() => api.get<{ licenses: LicenseDefinition[] }>("/licenses"), []);
  const reviews = useAsync(() => api.get<{ reviews: Review[]; total: number }>("/reviews", { listing: id, limit: 10 }), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(undefined);
  const [bought, setBought] = useState<Order | null>(null);

  if (listing.loading) return <Loading />;
  if (listing.error || !listing.data) return <ErrorNotice error={listing.error ?? new Error("Listing not found")} />;
  const item = listing.data.listing;
  const definitions = new Map((licenses.data?.licenses ?? []).map((definition): [string, LicenseDefinition] => [definition.type, definition]));
  const isOwner = user?.id === item.artist.userId;

  const buy = async (license: string): Promise<void> => {
    setBusy(license);
    setError(undefined);
    try {
      const response = await api.post<{ order: Order }>("/orders", { listingId: item.id, license });
      setBought(response.order);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="listing">
      <div className="listing-media">
        {item.asset.previewUrl ? <img src={item.asset.previewUrl} alt={item.title} /> : <div className="placeholder big">{item.asset.mime}</div>}
        <p className="card-links">
          {item.asset.palette.map((color) => (
            <a key={color.hex} className="swatch" href={href("/search", { color: color.hex.slice(1) })} style={{ background: color.hex }} title={`Search ${color.hex}`}>
              <span className="visually-hidden">Search {color.hex}</span>
            </a>
          ))}
          <a href={href("/search", { similarTo: item.id })}>More like this</a>
        </p>
      </div>

      <div className="listing-info">
        {!item.publiclyVisible ? <InfoNotice>This listing is {item.status} and only you and moderators can see it.</InfoNotice> : null}
        <h1>{item.title}</h1>
        <p>
          by <a href={href("/search", { artist: item.artist.userId })}>{item.artist.displayName}</a> in{" "}
          <a href={href("/search", { category: item.category.slug })}>{item.category.name}</a>
        </p>
        <Stars average={item.rating.average} count={item.rating.count} />
        {item.description ? <p>{item.description}</p> : null}
        <p className="chips">
          {item.tags.map((tag) => (
            <a key={tag} className="chip" href={href("/search", { tag })}>
              {tag}
            </a>
          ))}
        </p>

        <h2>Licenses</h2>
        <ErrorNotice error={error} />
        {error instanceof ApiError && error.code === "insufficient_funds" ? (
          <InfoNotice>
            Add funds on the <a href={href("/wallet")}>wallet page</a>.
          </InfoNotice>
        ) : null}
        {bought ? (
          <InfoNotice>
            Purchased! The payment is held in escrow until you confirm. <a href={href("/orders")}>View your orders</a>.
          </InfoNotice>
        ) : null}
        <table className="licenses">
          <thead>
            <tr>
              <th>License</th>
              <th>Allowed uses</th>
              <th>Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {item.licenses.map((entry) => {
              const definition = definitions.get(entry.license);
              return (
                <tr key={entry.license}>
                  <td>{definition?.name ?? humanize(entry.license)}</td>
                  <td>{definition?.allowedUses.map(humanize).join(", ")}</td>
                  <td>{formatCents(entry.priceCents)}</td>
                  <td>
                    {!item.publiclyVisible || isOwner ? null : !user ? (
                      <a className="button" href={href("/login", { next: `/listings/${item.id}` })}>
                        Log in to buy
                      </a>
                    ) : canTransact(user) ? (
                      <button type="button" disabled={busy !== null} onClick={() => void buy(entry.license)}>
                        {busy === entry.license ? "Buying…" : "Buy"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted">Reselling the artwork as-is is never allowed. The payment is held in escrow until you confirm the order.</p>

        {user && !isOwner && item.publiclyVisible ? <TakedownForm listingId={item.id} /> : null}

        <h2>Reviews</h2>
        {reviews.data && reviews.data.reviews.length === 0 ? <p className="muted">No reviews yet.</p> : null}
        <ul className="reviews">
          {reviews.data?.reviews.map((review) => (
            <li key={review.id}>
              <Stars average={review.rating} /> <strong>{review.reviewer.displayName}</strong> <span className="muted">{formatDate(review.createdAt)}{review.edited ? " (edited)" : ""}</span>
              {review.comment ? <p>{review.comment}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function TakedownForm({ listingId }: { listingId: number }) {
  const [open, setOpen] = useState(false);
  const [workDescription, setWorkDescription] = useState("");
  const [originalUrl, setOriginalUrl] = useState("");
  const [signature, setSignature] = useState("");
  const [goodFaith, setGoodFaith] = useState(false);
  const [accurate, setAccurate] = useState(false);
  const [sent, setSent] = useState(false);
  const { run, error, busy } = useAction(() => setSent(true));

  if (sent) return <InfoNotice>Thank you. A moderator will review your notice and tell you the outcome in your inbox.</InfoNotice>;
  if (!open) {
    return (
      <p>
        <button type="button" className="link" onClick={() => setOpen(true)}>
          Report a copyright problem with this listing
        </button>
      </p>
    );
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(() =>
      api.post("/takedowns", {
        listingId,
        workDescription,
        originalUrl: originalUrl.trim() === "" ? undefined : originalUrl.trim(),
        goodFaithStatement: goodFaith,
        accuracyStatement: accurate,
        signature,
      }),
    );
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h3>Copyright notice</h3>
      <ErrorNotice error={error} />
      <label>
        Describe your original work and how this listing copies it
        <textarea value={workDescription} rows={4} minLength={10} maxLength={2000} required onChange={(event) => setWorkDescription(event.target.value)} />
      </label>
      <label>
        Link to your original (optional)
        <input type="url" value={originalUrl} maxLength={500} onChange={(event) => setOriginalUrl(event.target.value)} />
      </label>
      <label className="inline">
        <input type="checkbox" checked={goodFaith} onChange={(event) => setGoodFaith(event.target.checked)} /> I believe in good faith that this use is not authorized.
      </label>
      <label className="inline">
        <input type="checkbox" checked={accurate} onChange={(event) => setAccurate(event.target.checked)} /> The information in this notice is accurate.
      </label>
      <label>
        Your full name (as a signature)
        <input value={signature} maxLength={120} required onChange={(event) => setSignature(event.target.value)} />
      </label>
      <p className="actions">
        <button type="submit" disabled={busy || !goodFaith || !accurate}>
          Send notice
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </p>
    </form>
  );
}
