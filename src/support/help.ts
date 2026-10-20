import { FORMAT_INFO } from "../assets/signatures.js";
import { CATEGORY_RULES } from "../catalog/rules.js";
import { LICENSE_TYPES, LICENSES, USES } from "../licenses/definitions.js";
import { COMMISSION_BPS } from "../orders/pricing.js";

export interface HelpArticle {
  slug: string;
  title: string;
  summary: string;
  body: string;
}

const percent = (bps: number): string => `${bps / 100}%`;
const multiple = (bps: number): string => `${bps / 10_000}x`;
const mb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Numbers in these articles come from the same constants the code uses, so the help cannot drift from behavior. */
function buildArticles(): HelpArticle[] {
  const licenseLines = LICENSE_TYPES.map(
    (type) => `- ${LICENSES[type].name}: ${multiple(LICENSES[type].priceMultiplierBps)} the base price. Allowed uses: ${LICENSES[type].allowedUses.join(", ")}.`,
  ).join("\n");
  const formatLines = Object.entries(CATEGORY_RULES)
    .map(([slug, rule]) => `- ${slug}: ${rule.formats.map((format) => FORMAT_INFO[format].ext).join(", ")} (up to ${mb(rule.maxBytes)})`)
    .join("\n");

  return [
    {
      slug: "getting-started",
      title: "Getting started",
      summary: "Create an account, choose a role and find your way around.",
      body: [
        "Register as a client to buy artwork and post commission requests, or as an artist to sell and take commissions.",
        "Artists create a profile and choose a specialty. A moderator approves the profile before your listings and bids become public.",
        "Add simulated funds to your wallet to buy a license or fund a commission. No real money is involved.",
      ].join("\n\n"),
    },
    {
      slug: "licenses",
      title: "Licenses and what they allow",
      summary: "Non-Commercial, Commercial and Broadcast licenses explained.",
      body: `Each listing has one base price and the artist chooses which licenses to offer. A broader license costs more and includes everything a narrower one allows.\n\n${licenseLines}\n\nUses covered by the system: ${USES.join(", ")}. Reselling the artwork as-is is never allowed under any license. After you buy, your order has a license grant showing exactly what you may do.`,
    },
    {
      slug: "escrow-and-payments",
      title: "How escrow and fees work",
      summary: "Where your money is held and when the artist is paid.",
      body: `When you buy a license or accept a commission proposal, the price leaves your wallet and is held in escrow. The artist is paid when you confirm the order or approve the delivery. If you do nothing, escrowed orders are released automatically after a hold period and delivered commissions are approved automatically after a review period.\n\nThe platform keeps a commission: ${percent(COMMISSION_BPS.standard)} for standard artists and ${percent(COMMISSION_BPS.premium)} for premium artists. The rate is fixed on each order when it is placed.`,
    },
    {
      slug: "commissions",
      title: "Commissions and the request board",
      summary: "Posting a request, choosing a proposal, revisions and delivery.",
      body: [
        "Clients post a request with a budget. Approved artists bid with a price, a delivery time and the number of revisions they include. Bids cannot exceed the budget.",
        "When you accept a proposal, the price moves into escrow and the other bids are declined. The artist starts work and delivers a file. You can approve it, or ask for changes up to the promised number of revisions.",
        "Until a delivery is approved or a dispute is settled, the money stays in escrow. The artist may withdraw before delivering and you are refunded in full.",
      ].join("\n\n"),
    },
    {
      slug: "disputes-and-refunds",
      title: "Disputes and refunds",
      summary: "What to do when something goes wrong with an order or commission.",
      body: "A buyer can dispute an order during its hold period, and either party can dispute a commission that has been funded. A dispute freezes the money and automatic release stops. A moderator reviews the case and either releases the payment to the artist or refunds the buyer in full. An artist may also refund an order that is still in escrow. Open a support ticket if you need help.",
    },
    {
      slug: "uploads",
      title: "Uploading files",
      summary: "Accepted formats and size limits for each category.",
      body: `Files are identified by their content, not their name, and must be allowed for the category you upload to. SVG, HTML and GIF files are not accepted. Images must be real images that can be decoded, and each upload gets a thumbnail. Each person has a storage quota.\n\n${formatLines}\n\nThe server's upload limit may be lower than a category's maximum.`,
    },
    {
      slug: "reviews",
      title: "Reviews",
      summary: "Who can review and how reports work.",
      body: "You can review a purchase or a commission once it is completed, one review each. You can edit your review and it is marked as edited. Anyone can report a review as spam, abusive, off topic or another reason. Reported reviews stay visible until a moderator decides to hide them or dismiss the report. Hidden reviews do not count toward ratings.",
    },
    {
      slug: "copyright-takedowns",
      title: "Copyright notices and counter-notices",
      summary: "Reporting infringing work and responding to a takedown.",
      body: "If you believe a listing copies your work, file a notice describing the original work, stating in good faith that the use is unauthorized and that your statement is accurate, and signing with your full name. A moderator reviews it and either removes the listing or rejects the notice. If a listing is removed, its artist can file a counter-notice with a signed good-faith statement. A moderator then reinstates the listing as a draft or confirms the removal.",
    },
    {
      slug: "account-security",
      title: "Keeping your account safe",
      summary: "Passwords, sessions and what we will never ask for.",
      body: "Use a passphrase of at least 12 characters. Sessions expire automatically and you can sign out at any time. Staff will never ask for your password. If you notice activity you do not recognize, open a support ticket in the account category.",
    },
  ];
}

export const HELP_ARTICLES: readonly HelpArticle[] = buildArticles();

export function findArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

/** Case-insensitive search over titles, summaries and bodies, best title matches first. */
export function searchArticles(query: string | undefined): HelpArticle[] {
  const needle = query?.trim().toLowerCase();
  if (!needle) return [...HELP_ARTICLES];
  const score = (article: HelpArticle): number => {
    if (article.title.toLowerCase().includes(needle)) return 3;
    if (article.summary.toLowerCase().includes(needle)) return 2;
    if (article.body.toLowerCase().includes(needle)) return 1;
    return 0;
  };
  return HELP_ARTICLES.map((article) => ({ article, score: score(article) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.article);
}
