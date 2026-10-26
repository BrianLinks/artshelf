import { useState, type FormEvent } from "react";
import { api, loadCategories } from "../api";
import { ErrorNotice, InfoNotice, Loading } from "../components/Notice";
import { ListingGrid } from "../components/ListingCard";
import { navigate, useAsync } from "../hooks";
import { humanize, normalizeColor, toColorInputValue } from "../lib/format";
import { hrefWithParams } from "../lib/router";
import { LICENSE_TYPES, SORTS, pageCount, stateFromQuery, stateToQuery, toApiParams, type SearchState } from "../lib/searchState";
import type { Listing } from "../lib/types";

interface SearchResponse {
  listings: Listing[];
  total: number;
  tokens: string[];
}

export function SearchPage({ query }: { query: URLSearchParams }) {
  const state = stateFromQuery(query);
  const key = query.toString();
  const categories = useAsync(loadCategories, []);
  const results = useAsync(() => api.get<SearchResponse>("/search", toApiParams(state)), [key]);

  const goto = (next: Partial<SearchState>): void => navigate(hrefWithParams("/search", stateToQuery(next)));

  return (
    <>
      <h1>Browse artwork</h1>
      <Filters key={key} state={state} categories={categories.data ?? []} onSubmit={(next) => goto({ ...next, page: 1 })} />

      {state.similarTo !== null ? (
        <InfoNotice>
          Showing artwork with colors similar to listing #{state.similarTo}.{" "}
          <button type="button" className="link" onClick={() => goto({ ...state, similarTo: null, page: 1 })}>
            Clear
          </button>
        </InfoNotice>
      ) : null}

      {results.loading ? <Loading what="Searching" /> : <ErrorNotice error={results.error} />}
      {results.data ? (
        <>
          <p className="muted" aria-live="polite">
            {results.data.total} result{results.data.total === 1 ? "" : "s"}
          </p>
          <ListingGrid listings={results.data.listings} />
          <Pager page={state.page} total={results.data.total} onPage={(page) => goto({ ...state, page })} />
        </>
      ) : null}
    </>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = pageCount(total);
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

function Filters({
  state,
  categories,
  onSubmit,
}: {
  state: SearchState;
  categories: { slug: string; name: string }[];
  onSubmit: (state: SearchState) => void;
}) {
  const [draft, setDraft] = useState<SearchState>(state);
  const set = <K extends keyof SearchState>(field: K, value: SearchState[K]): void => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSubmit(draft);
  };

  return (
    <form className="filters" onSubmit={submit}>
      <label>
        Words
        <input type="search" value={draft.q} maxLength={100} onChange={(event) => set("q", event.target.value)} />
      </label>
      <label>
        Category
        <select value={draft.category} onChange={(event) => set("category", event.target.value)}>
          <option value="">All</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        License
        <select value={draft.license} onChange={(event) => set("license", event.target.value)}>
          <option value="">Any</option>
          {LICENSE_TYPES.map((license) => (
            <option key={license} value={license}>
              {humanize(license)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Min price ($)
        <input inputMode="decimal" value={draft.minPrice} onChange={(event) => set("minPrice", event.target.value)} />
      </label>
      <label>
        Max price ($)
        <input inputMode="decimal" value={draft.maxPrice} onChange={(event) => set("maxPrice", event.target.value)} />
      </label>
      <label>
        Color
        <span className="color-field">
          <input type="color" value={toColorInputValue(draft.color)} onChange={(event) => set("color", normalizeColor(event.target.value))} />
          {draft.color ? (
            <button type="button" className="link" onClick={() => set("color", "")}>
              Clear
            </button>
          ) : (
            <span className="muted">none</span>
          )}
        </span>
      </label>
      <label>
        Sort by
        <select value={draft.sort} onChange={(event) => set("sort", event.target.value)}>
          {SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {humanize(sort)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Apply</button>
    </form>
  );
}
