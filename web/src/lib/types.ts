/** The parts of the API's responses the UI reads. */
export type Role = "client" | "artist" | "moderator" | "admin";

export interface User {
  id: number;
  email: string;
  displayName: string;
  role: Role;
}

export interface Category {
  slug: string;
  name: string;
  allowedMimeTypes: string[];
  maxBytes: number;
}

export interface LicenseDefinition {
  type: string;
  name: string;
  priceMultiplierBps: number;
  allowedUses: string[];
}

export interface RatingSummary {
  count: number;
  average: number | null;
  averageTenths: number | null;
  distribution: Record<string, number>;
}

export interface Listing {
  id: number;
  title: string;
  description: string;
  status: string;
  publiclyVisible: boolean;
  category: { slug: string; name: string };
  basePriceCents: number;
  licenses: { license: string; priceCents: number }[];
  tags: string[];
  rating: RatingSummary;
  artist: { userId: number; displayName: string; tier: string };
  asset: { mime: string; width: number | null; height: number | null; previewUrl: string | null; palette: { hex: string; weightBps: number }[] };
  createdAt: string;
  colorScore?: number | null;
}

export interface ArtistProfile {
  userId: number;
  displayName: string;
  bio: string;
  specialty: string;
  tier: string;
}

export interface Review {
  id: number;
  rating: number;
  comment: string;
  reviewer: { userId: number; displayName: string };
  edited: boolean;
  createdAt: string;
}

export interface Order {
  id: number;
  status: string;
  listing: { id: number; title: string };
  license: string;
  priceCents: number;
  commissionBps: number;
  commissionCents: number;
  payoutCents: number;
  buyer: { userId: number };
  artist: { userId: number; displayName: string };
  holdUntil: string;
  disputeReason: string | null;
  resolutionNote: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WalletEntry {
  entryId: number;
  kind: string;
  orderId: number | null;
  memo: string;
  amountCents: number;
  createdAt: string;
}

export interface NotificationItem {
  id: number;
  kind: string;
  title: string;
  body: string;
  ref: { type: string; id: number } | null;
  read: boolean;
  createdAt: string;
}

export interface HelpArticleSummary {
  slug: string;
  title: string;
  summary: string;
}

export interface HelpArticle extends HelpArticleSummary {
  body: string;
}

export interface AssetItem {
  id: number;
  category: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
  createdAt: string;
}

export interface MyProfile extends ArtistProfile {
  status: string;
}

export interface Statement {
  totals: { orderCount: number; grossCents: number; commissionCents: number; netCents: number };
  pendingNetCents: number;
}

export interface BoardRequest {
  id: number;
  title: string;
  description: string;
  category: { slug: string; name: string };
  budgetCents: number;
  status: string;
  client: { userId: number; displayName: string };
  artist: { userId: number; displayName: string | null } | null;
  proposalCount: number;
  priceCents: number | null;
  commissionBps: number | null;
  commissionCents: number | null;
  payoutCents: number | null;
  maxRevisions: number | null;
  revisionsUsed: number;
  dueAt: string | null;
  deliveredAt: string | null;
  autoApproveAt: string | null;
  completedAt: string | null;
  disputeReason: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface Proposal {
  id: number;
  requestId: number;
  artist: { userId: number; displayName: string; tier: string };
  priceCents: number;
  message: string;
  deliveryDays: number;
  maxRevisions: number;
  status: string;
  createdAt: string;
}

export interface RequestEvent {
  id: number;
  actorUserId: number | null;
  kind: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
}

export interface TicketSummary {
  id: number;
  category: string;
  subject: string;
  status: string;
  requester: { userId: number; displayName: string };
  assignee: { userId: number; displayName: string | null } | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: number;
  author: { userId: number; displayName: string; staff: boolean };
  body: string;
  internal: boolean;
  createdAt: string;
}

export interface TicketDetail extends TicketSummary {
  messages: TicketMessage[];
}
