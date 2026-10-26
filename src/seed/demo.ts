import { setTier, transitionStatus, upsertProfile } from "../artists/profiles.js";
import { hashPassword } from "../auth/password.js";
import type { Role } from "../auth/roles.js";
import { createUser, findCredentialsByEmail } from "../auth/users.js";
import { uploadAsset } from "../assets/service.js";
import type { LocalStorage } from "../assets/storage.js";
import type { Config } from "../config.js";
import type { Db } from "../db/connection.js";
import type { LicenseType } from "../licenses/definitions.js";
import { deposit } from "../ledger/wallet.js";
import { createListing, publishListing } from "../listings/service.js";
import { confirmOrder, placeOrder } from "../orders/service.js";
import { createRequest, submitProposal } from "../requests/service.js";
import { createReview } from "../reviews/service.js";
import { generateArtSvg, type Triple } from "./art.js";

export const DEMO_PASSWORD = "demo-password-123";
const DOMAIN = "demo.artshelf.test";

interface Person {
  key: string;
  name: string;
  role: Role;
  specialty?: string;
  premium?: boolean;
}

const PEOPLE: Person[] = [
  { key: "lena", name: "Lena Okafor", role: "artist", specialty: "illustration", premium: true },
  { key: "marco", name: "Marco Silva", role: "artist", specialty: "character-illustration", premium: true },
  { key: "yuki", name: "Yuki Tanaka", role: "artist", specialty: "design" },
  { key: "sam", name: "Sam Rivers", role: "artist", specialty: "illustration" },
  { key: "ada", name: "Ada Client", role: "client" },
  { key: "ben", name: "Ben Buyer", role: "client" },
  { key: "mod", name: "Morgan Moderator", role: "moderator" },
  { key: "admin", name: "Alex Admin", role: "admin" },
];

interface DemoListing {
  artist: string;
  category: string;
  title: string;
  description: string;
  tags: string[];
  price: number;
  licenses: LicenseType[];
  colors: Triple;
}

const LISTINGS: DemoListing[] = [
  { artist: "lena", category: "illustration", title: "Crimson Dragon", description: "A fierce dragon coiled around a burning tower.", tags: ["dragon", "fantasy", "fire"], price: 45_000, licenses: ["non_commercial", "commercial"], colors: ["#7f1d1d", "#dc1414", "#fbbf24"] },
  { artist: "lena", category: "illustration", title: "Ocean Whale", description: "A calm whale drifting through deep blue water.", tags: ["whale", "sea", "calm"], price: 30_000, licenses: ["non_commercial", "commercial", "broadcast"], colors: ["#0b1d51", "#1428dc", "#7dd3fc"] },
  { artist: "lena", category: "illustration", title: "Forest Spirit", description: "A gentle guardian of the glade, half hidden by ferns.", tags: ["forest", "spirit", "nature"], price: 38_000, licenses: ["non_commercial", "commercial"], colors: ["#14532d", "#14c828", "#bbf7d0"] },
  { artist: "sam", category: "illustration", title: "Sunset Cat", description: "A warm orange cat watching the last light of the day.", tags: ["cat", "sunset", "warm"], price: 12_000, licenses: ["non_commercial"], colors: ["#7c2d12", "#f08c14", "#fde68a"] },
  { artist: "sam", category: "illustration", title: "Rose Garden", description: "Petals and thorns in soft evening colors.", tags: ["flower", "garden"], price: 18_000, licenses: ["non_commercial", "commercial"], colors: ["#831843", "#c82832", "#fecdd3"] },
  { artist: "sam", category: "illustration", title: "Violet Storm", description: "Clouds gathering over an empty field.", tags: ["storm", "sky"], price: 22_000, licenses: ["non_commercial", "commercial"], colors: ["#2e1065", "#7c3aed", "#ddd6fe"] },
  { artist: "marco", category: "character-illustration", title: "Night Owl", description: "A scholar owl in a navy coat, reading by lamplight.", tags: ["owl", "night", "character"], price: 35_000, licenses: ["non_commercial", "commercial", "broadcast"], colors: ["#0f172a", "#1e1e3c", "#facc15"] },
  { artist: "marco", category: "character-illustration", title: "Teal Courier", description: "A cheerful courier mid-stride across the rooftops.", tags: ["courier", "city", "character"], price: 28_000, licenses: ["non_commercial", "commercial"], colors: ["#134e4a", "#14b8a6", "#ccfbf1"] },
  { artist: "marco", category: "character-illustration", title: "Amber Knight", description: "A knight in amber armor resting after a long road.", tags: ["knight", "fantasy", "character"], price: 52_000, licenses: ["commercial", "broadcast"], colors: ["#78350f", "#d97706", "#fef3c7"] },
  { artist: "yuki", category: "design", title: "Monochrome Poster", description: "A bold typographic poster in black, grey and one red line.", tags: ["poster", "typography"], price: 20_000, licenses: ["non_commercial", "commercial"], colors: ["#111111", "#6b7280", "#dc1414"] },
  { artist: "yuki", category: "design", title: "Pastel Pattern", description: "A repeating pattern in pastel pink and mint.", tags: ["pattern", "pastel"], price: 15_000, licenses: ["non_commercial", "commercial"], colors: ["#fbcfe8", "#a7f3d0", "#fde68a"] },
  { artist: "yuki", category: "design", title: "Deep Space Banner", description: "A wide banner of stars in indigo and gold.", tags: ["space", "banner"], price: 26_000, licenses: ["commercial", "broadcast"], colors: ["#1e1b4b", "#312e81", "#fcd34d"] },
];

export interface SeedSummary {
  created: boolean;
  password: string;
  accounts: { email: string; role: Role }[];
  listings: number;
  orders: number;
  reviews: number;
  requests: number;
}

const email = (key: string): string => `${key}@${DOMAIN}`;

async function pngFor(svg: string): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Fills an empty database with demo accounts, artwork, sales, reviews and a commission request. Does nothing if the
 * demo accounts already exist, so it is safe to run twice. All artwork is generated, and every account uses `password`.
 */
export async function seedDemoData(
  db: Db,
  storage: LocalStorage,
  config: Pick<Config, "BCRYPT_ROUNDS" | "ESCROW_HOLD_DAYS" | "MAX_UPLOAD_MB" | "USER_QUOTA_MB">,
  password: string = DEMO_PASSWORD,
): Promise<SeedSummary> {
  const accounts = PEOPLE.map((person) => ({ email: email(person.key), role: person.role }));
  const summary: SeedSummary = { created: false, password, accounts, listings: 0, orders: 0, reviews: 0, requests: 0 };
  if (findCredentialsByEmail(db, email(PEOPLE[0]?.key ?? "lena"))) return summary;

  const hash = await hashPassword(password, config.BCRYPT_ROUNDS);
  const ids = new Map<string, number>();
  for (const person of PEOPLE) {
    const user = createUser(db, { email: email(person.key), passwordHash: hash, displayName: person.name, role: person.role });
    ids.set(person.key, user.id);
    if (person.role === "artist" && person.specialty) {
      upsertProfile(db, user.id, { bio: `${person.name} makes original ${person.specialty.replace(/-/g, " ")} work.`, specialty: person.specialty });
      transitionStatus(db, user.id, "approved");
      if (person.premium) setTier(db, user.id, "premium");
    }
  }
  const id = (key: string): number => {
    const value = ids.get(key);
    if (value === undefined) throw new Error(`Unknown demo person: ${key}`);
    return value;
  };

  const listingIds = new Map<string, number>();
  for (const [index, item] of LISTINGS.entries()) {
    const data = await pngFor(generateArtSvg(1000 + index, item.colors));
    const asset = await uploadAsset(
      { db, storage, config },
      { ownerId: id(item.artist), categorySlug: item.category, filename: `${item.title}.png`, data },
    );
    const listing = createListing(db, id(item.artist), {
      assetId: asset.id,
      title: item.title,
      description: item.description,
      basePriceCents: item.price,
      licenses: item.licenses,
      tags: item.tags,
    });
    publishListing(db, id(item.artist), listing.id);
    listingIds.set(item.title, listing.id);
    summary.listings += 1;
  }
  const listingId = (title: string): number => {
    const value = listingIds.get(title);
    if (value === undefined) throw new Error(`Unknown demo listing: ${title}`);
    return value;
  };

  deposit(db, id("ada"), 1_000_000);
  deposit(db, id("ben"), 1_000_000);

  const sales: { buyer: string; title: string; license: LicenseType; confirm: boolean; review?: { rating: number; comment: string } }[] = [
    { buyer: "ada", title: "Crimson Dragon", license: "commercial", confirm: true, review: { rating: 5, comment: "Exactly what I hoped for, and the license was clear." } },
    { buyer: "ben", title: "Crimson Dragon", license: "non_commercial", confirm: true, review: { rating: 4, comment: "Beautiful colors." } },
    { buyer: "ada", title: "Night Owl", license: "commercial", confirm: true, review: { rating: 5, comment: "Great character work." } },
    { buyer: "ben", title: "Sunset Cat", license: "non_commercial", confirm: true, review: { rating: 4, comment: "Warm and friendly." } },
    { buyer: "ada", title: "Ocean Whale", license: "non_commercial", confirm: false },
  ];
  for (const sale of sales) {
    const order = placeOrder(db, config, id(sale.buyer), { listingId: listingId(sale.title), license: sale.license });
    summary.orders += 1;
    if (!sale.confirm) continue;
    confirmOrder(db, id(sale.buyer), order.id);
    if (sale.review) {
      createReview(db, id(sale.buyer), { orderId: order.id, rating: sale.review.rating, comment: sale.review.comment });
      summary.reviews += 1;
    }
  }

  const request = createRequest(db, id("ada"), {
    title: "Portrait of my cat, Biscuit",
    description: "A soft watercolor-style portrait of a grey cat sitting on a windowsill. For a birthday present.",
    category: "illustration",
    budgetCents: 80_000,
  });
  submitProposal(db, id("lena"), request.id, { priceCents: 70_000, message: "I would love to paint Biscuit. I can start this week.", deliveryDays: 7, maxRevisions: 2 });
  submitProposal(db, id("sam"), request.id, { priceCents: 55_000, message: "Happy to take this on at a friendly price.", deliveryDays: 10, maxRevisions: 1 });
  summary.requests = 1;

  summary.created = true;
  return summary;
}
