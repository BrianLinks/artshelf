import { useState, type FormEvent } from "react";
import { api, loadCategories, uploadAsset } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice, InfoNotice, Loading } from "../components/Notice";
import { RequireLogin } from "../components/RequireLogin";
import { useAction, useAsync } from "../hooks";
import { ApiError } from "../lib/client";
import { formatCents, formatDate, humanize, parseDollarsToCents } from "../lib/format";
import { href } from "../lib/router";
import { LICENSE_TYPES } from "../lib/searchState";
import type { AssetItem, Listing, MyProfile, Statement } from "../lib/types";

export function ArtistPage() {
  return (
    <RequireLogin path="/artist" needsWallet>
      <Dashboard />
    </RequireLogin>
  );
}

function Dashboard() {
  const { user } = useAuth();
  if (user?.role !== "artist") return <InfoNotice>The artist dashboard is for artist accounts. You can register a new account as an artist.</InfoNotice>;
  return <ArtistTools />;
}

function ArtistTools() {
  const assets = useAsync(() => api.get<{ assets: AssetItem[] }>("/assets"), []);
  const listings = useAsync(() => api.get<{ listings: Listing[] }>("/listings/mine"), []);
  const refresh = (): void => {
    assets.reload();
    listings.reload();
  };

  return (
    <>
      <h1>Artist dashboard</h1>
      <ProfileSection />
      <Earnings />
      <h2>My listings</h2>
      {listings.loading ? <Loading /> : <ErrorNotice error={listings.error} />}
      {listings.data && listings.data.listings.length === 0 ? <p className="muted">No listings yet. Upload a file below and make a listing from it.</p> : null}
      {listings.data?.listings.map((listing) => (
        <MyListingRow key={listing.id} listing={listing} onChanged={refresh} />
      ))}
      <h2>My uploads</h2>
      <UploadForm onUploaded={assets.reload} />
      {assets.loading ? <Loading /> : <ErrorNotice error={assets.error} />}
      {assets.data?.assets.map((asset) => (
        <AssetRow key={asset.id} asset={asset} onChanged={refresh} />
      ))}
    </>
  );
}

function ProfileSection() {
  const profile = useAsync<{ profile: MyProfile } | null>(
    () =>
      api.get<{ profile: MyProfile }>("/artists/me").catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
    [],
  );
  const categories = useAsync(loadCategories, []);
  const [bio, setBio] = useState<string | null>(null);
  const [specialty, setSpecialty] = useState<string | null>(null);
  const { run, error, busy } = useAction(profile.reload);

  if (profile.loading) return <Loading />;
  const current = profile.data?.profile;
  const bioValue = bio ?? current?.bio ?? "";
  const specialtyValue = specialty ?? current?.specialty ?? categories.data?.[0]?.slug ?? "";

  const save = (event: FormEvent): void => {
    event.preventDefault();
    void run(() => api.put("/artists/me", { bio: bioValue, specialty: specialtyValue }));
  };

  return (
    <section className="panel">
      <h2>Profile</h2>
      <ErrorNotice error={profile.error} />
      {current ? (
        <p>
          Status: <span className={`status ${current.status}`}>{humanize(current.status)}</span>{" "}
          {current.status === "pending" ? <span className="muted">A moderator must approve your profile before you can publish listings or bid on requests.</span> : null}
          {current.status === "rejected" ? <span className="muted">Edit and save your profile to send it for review again.</span> : null}
        </p>
      ) : (
        <InfoNotice>Create your profile to start uploading and selling.</InfoNotice>
      )}
      <form onSubmit={save}>
        <ErrorNotice error={error} />
        <label>
          About you
          <textarea value={bioValue} rows={3} maxLength={2000} required onChange={(event) => setBio(event.target.value)} />
        </label>
        <label>
          Specialty
          <select value={specialtyValue} onChange={(event) => setSpecialty(event.target.value)}>
            {categories.data?.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy}>
          {current ? "Save profile" : "Create profile"}
        </button>
      </form>
    </section>
  );
}

function Earnings() {
  const statement = useAsync(() => api.get<{ statement: Statement }>("/royalties"), []);
  if (!statement.data) return statement.error ? null : <Loading />;
  const { totals, pendingNetCents } = statement.data.statement;
  return (
    <section className="panel">
      <h2>Earnings</h2>
      <p>
        {totals.orderCount} completed sale{totals.orderCount === 1 ? "" : "s"}: <strong>{formatCents(totals.netCents)}</strong> paid out after{" "}
        {formatCents(totals.commissionCents)} in platform commission (gross {formatCents(totals.grossCents)}).
      </p>
      <p className="muted">{formatCents(pendingNetCents)} is still in escrow.</p>
    </section>
  );
}

function MyListingRow({ listing, onChanged }: { listing: Listing; onChanged: () => void }) {
  const { run, error, busy } = useAction(onChanged);
  return (
    <section className="panel">
      <h3>
        <a href={href(`/listings/${listing.id}`)}>{listing.title}</a> <span className={`status ${listing.status}`}>{humanize(listing.status)}</span>
      </h3>
      <p className="muted">
        {listing.category.name} · base price {formatCents(listing.basePriceCents)} · {listing.licenses.map((license) => humanize(license.license)).join(", ")}
      </p>
      <ErrorNotice error={error} />
      <p className="actions">
        {listing.status === "draft" ? (
          <button type="button" disabled={busy} onClick={() => void run(() => api.post(`/listings/${listing.id}/publish`))}>
            Publish
          </button>
        ) : null}
        {listing.status === "published" ? (
          <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => api.post(`/listings/${listing.id}/unpublish`))}>
            Unpublish
          </button>
        ) : null}
        {listing.status === "removed" ? <span className="muted">Removed by a moderator. See the help center about counter-notices.</span> : null}
      </p>
    </section>
  );
}

function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const categories = useAsync(loadCategories, []);
  const [category, setCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const { run, error, busy } = useAction(onUploaded);
  const chosen = category || categories.data?.[0]?.slug || "";

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (file) void run(() => uploadAsset(file, chosen));
  };

  return (
    <form className="panel inline-form" onSubmit={submit}>
      <label>
        Category
        <select value={chosen} onChange={(event) => setCategory(event.target.value)}>
          {categories.data?.map((entry) => (
            <option key={entry.slug} value={entry.slug}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        File
        <input type="file" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      <button type="submit" disabled={busy || !file}>
        {busy ? "Uploading…" : "Upload"}
      </button>
      <ErrorNotice error={error} />
    </form>
  );
}

function AssetRow({ asset, onChanged }: { asset: AssetItem; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const { run, error, busy } = useAction(onChanged);
  return (
    <section className="panel asset">
      <div className="asset-head">
        {asset.hasThumbnail ? <img src={`/api/assets/${asset.id}/thumbnail`} alt="" width={96} /> : <span className="placeholder">{asset.mime}</span>}
        <div>
          <strong>{asset.originalName}</strong>
          <p className="muted">
            {humanize(asset.category)} · {Math.max(1, Math.round(asset.sizeBytes / 1024))} KB · uploaded {formatDate(asset.createdAt)}
          </p>
        </div>
      </div>
      <ErrorNotice error={error} />
      <p className="actions">
        <button type="button" className="secondary" onClick={() => setOpen(!open)}>
          {open ? "Cancel" : "Make a listing"}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => api.del(`/assets/${asset.id}`))}>
          Delete
        </button>
      </p>
      {open ? (
        <ListingForm
          assetId={asset.id}
          defaultTitle={asset.originalName.replace(/\.[^.]+$/, "")}
          onCreated={() => {
            setOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function parseTags(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[\s,]+/).filter((tag) => tag !== ""))];
}

function ListingForm({ assetId, defaultTitle, onCreated }: { assetId: number; defaultTitle: string; onCreated: () => void }) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("100");
  const [licenses, setLicenses] = useState<string[]>(["non_commercial", "commercial"]);
  const [tags, setTags] = useState("");
  const [localError, setLocalError] = useState<unknown>(undefined);
  const { run, error, busy } = useAction(onCreated);

  const toggle = (license: string): void => setLicenses((current) => (current.includes(license) ? current.filter((entry) => entry !== license) : [...current, license]));

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const cents = parseDollarsToCents(price);
    if (cents === null || cents < 100 || cents > 10_000_000) return setLocalError(new Error("Price must be between $1.00 and $100,000.00."));
    if (licenses.length === 0) return setLocalError(new Error("Offer at least one license."));
    setLocalError(undefined);
    void run(() => api.post("/listings", { assetId, title, description, basePriceCents: cents, licenses, tags: parseTags(tags) }));
  };

  return (
    <form onSubmit={submit}>
      <ErrorNotice error={localError ?? error} />
      <label>
        Title
        <input value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Description
        <textarea value={description} rows={2} maxLength={2000} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label>
        Base price ($) — the Non-Commercial price. Commercial costs 2.5x and Broadcast 5x.
        <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
      </label>
      <fieldset>
        <legend>Licenses to offer</legend>
        {LICENSE_TYPES.map((license) => (
          <label key={license} className="inline">
            <input type="checkbox" checked={licenses.includes(license)} onChange={() => toggle(license)} /> {humanize(license)}
          </label>
        ))}
      </fieldset>
      <label>
        Tags (separated by commas or spaces)
        <input value={tags} onChange={(event) => setTags(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Create draft
      </button>
    </form>
  );
}
