import { api, loadCategories } from "../api";
import { ErrorNotice, Loading } from "../components/Notice";
import { ListingGrid } from "../components/ListingCard";
import { useAsync } from "../hooks";
import { href } from "../lib/router";
import type { ArtistProfile, Listing } from "../lib/types";

export function HomePage() {
  const latest = useAsync(() => api.get<{ listings: Listing[] }>("/search", { limit: 8, sort: "newest" }), []);
  const artists = useAsync(() => api.get<{ artists: ArtistProfile[] }>("/artists", { tier: "premium", limit: 6 }), []);
  const categories = useAsync(loadCategories, []);

  return (
    <>
      <section className="hero">
        <h1>ArtShelf</h1>
        <p>Original artwork, licensed clearly. Browse by category, search by color, or commission something new.</p>
        <p>
          <a className="button" href={href("/search")}>
            Browse artwork
          </a>
        </p>
      </section>

      <section>
        <h2>Discover works by various authors</h2>
        {latest.loading ? <Loading /> : <ErrorNotice error={latest.error} />}
        {latest.data ? <ListingGrid listings={latest.data.listings} /> : null}
        <p>
          <a href={href("/search", { sort: "newest" })}>Explore all →</a>
        </p>
      </section>

      <section>
        <h2>Premium Artists</h2>
        {artists.data && artists.data.artists.length === 0 ? <p className="muted">No premium artists yet.</p> : null}
        <div className="grid small">
          {artists.data?.artists.map((artist) => (
            <a key={artist.userId} className="card artist" href={href("/search", { artist: artist.userId })}>
              <div className="card-body">
                <h3>{artist.displayName}</h3>
                <p className="muted">Specialty: {artist.specialty}</p>
              </div>
            </a>
          ))}
        </div>
      </section>

      <section>
        <h2>Categories</h2>
        <p className="chips">
          {categories.data?.map((category) => (
            <a key={category.slug} className="chip" href={href("/search", { category: category.slug })}>
              {category.name}
            </a>
          ))}
        </p>
      </section>
    </>
  );
}
