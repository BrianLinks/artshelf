import { formatCents } from "../lib/format";
import { href } from "../lib/router";
import type { Listing } from "../lib/types";
import { Stars } from "./Stars";

export function ListingCard({ listing }: { listing: Listing }) {
  const prices = listing.licenses.map((license) => license.priceCents);
  const from = prices.length > 0 ? Math.min(...prices) : listing.basePriceCents;
  return (
    <article className="card">
      <a className="card-image" href={href(`/listings/${listing.id}`)}>
        {listing.asset.previewUrl ? (
          <img src={listing.asset.previewUrl} alt={listing.title} loading="lazy" width={320} height={240} />
        ) : (
          <span className="placeholder">{listing.asset.mime}</span>
        )}
      </a>
      <div className="card-body">
        <h3>
          <a href={href(`/listings/${listing.id}`)}>{listing.title}</a>
        </h3>
        <p className="muted">
          <a href={href("/search", { artist: listing.artist.userId })}>{listing.artist.displayName}</a>
          {listing.artist.tier === "premium" ? <span className="badge">Premium</span> : null}
        </p>
        <p className="price">From {formatCents(from)}</p>
        <Stars average={listing.rating.average} count={listing.rating.count} />
        <p className="card-links">
          {listing.asset.palette.map((color) => (
            <a key={color.hex} className="swatch" href={href("/search", { color: color.hex.slice(1) })} title={`Search ${color.hex}`} style={{ background: color.hex }}>
              <span className="visually-hidden">Search {color.hex}</span>
            </a>
          ))}
          {listing.colorScore !== undefined && listing.colorScore !== null ? <span className="badge">{Math.round(listing.colorScore / 10)}% match</span> : null}
        </p>
      </div>
    </article>
  );
}

export function ListingGrid({ listings }: { listings: Listing[] }) {
  if (listings.length === 0) return <p className="muted">Nothing found.</p>;
  return (
    <div className="grid">
      {listings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}
