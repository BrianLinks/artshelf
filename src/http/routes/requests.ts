import { Router, type Request } from "express";
import { z } from "zod";
import type { LocalStorage } from "../../assets/storage.js";
import type { Config } from "../../config.js";
import type { Db } from "../../db/connection.js";
import { DomainError } from "../../errors.js";
import { BOARD_STATUSES } from "../../requests/machine.js";
import {
  BOARD_SORTS,
  findRequest,
  latestDelivery,
  listBoard,
  listEvents,
  listForArtist,
  listForClient,
  listProposals,
  toProposalView,
  toRequestView,
  type RequestRecord,
} from "../../requests/repo.js";
import {
  acceptProposal,
  approveDelivery,
  artistWithdraw,
  cancelRequest,
  createRequest,
  deliver,
  openRequestDispute,
  requestRevision,
  startWork,
  submitProposal,
  updateProposal,
  withdrawProposal,
} from "../../requests/service.js";
import { parse } from "../errors.js";
import { currentUser, requireAuth, requireRole } from "../middleware.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const createBody = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(4000),
  category: z.string().min(1).max(60),
  budgetCents: z.number().int().min(100).max(10_000_000),
});
const proposalBody = z.object({
  priceCents: z.number().int().min(100).max(10_000_000),
  message: z.string().trim().min(1).max(2000),
  deliveryDays: z.number().int().min(1).max(365),
  maxRevisions: z.number().int().min(0).max(5).default(2),
});
const acceptBody = z.object({ proposalId: z.number().int().positive() });
const deliverBody = z.object({ assetId: z.number().int().positive(), note: z.string().trim().max(1000).default("") });
const noteBody = z.object({ note: z.string().trim().min(1).max(1000) });
const reasonBody = z.object({ reason: z.string().trim().min(1).max(1000) });
const boardQuery = z.object({
  category: z.string().min(1).max(60).optional(),
  status: z.enum(BOARD_STATUSES).optional(),
  minBudgetCents: z.coerce.number().int().min(0).optional(),
  maxBudgetCents: z.coerce.number().int().min(0).optional(),
  sort: z.enum(BOARD_SORTS).default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export function requestsRouter(db: Db, config: Config, storage: LocalStorage): Router {
  const router = Router();

  const isStaff = (req: Request): boolean => req.user?.role === "moderator" || req.user?.role === "admin";
  const isParty = (req: Request, request: RequestRecord): boolean =>
    req.user !== undefined && (req.user.id === request.clientUserId || req.user.id === request.artistUserId);

  function loadRequest(req: Request): RequestRecord {
    const { id } = parse(idParams, req.params);
    const request = findRequest(db, id);
    if (!request) throw new DomainError("not_found", "Request not found");
    return request;
  }

  /** Open and proposed requests are public. Everything past acceptance is private to the parties and staff. */
  function loadVisible(req: Request): RequestRecord {
    const request = loadRequest(req);
    const onBoard = request.status === "open" || request.status === "proposed";
    if (!onBoard && !isParty(req, request) && !isStaff(req)) throw new DomainError("not_found", "Request not found");
    return request;
  }

  /** Parties and staff only, whatever the status. */
  function loadPrivate(req: Request): RequestRecord {
    const request = loadRequest(req);
    if (!isParty(req, request) && !isStaff(req)) throw new DomainError("not_found", "Request not found");
    return request;
  }

  router.get("/", (req, res) => {
    const query = parse(boardQuery, req.query);
    const { requests, total } = listBoard(db, query);
    res.json({ requests: requests.map(toRequestView), total, limit: query.limit, offset: query.offset });
  });

  router.post("/", requireRole("client", "artist"), (req, res) => {
    const input = parse(createBody, req.body);
    res.status(201).json({ request: createRequest(db, currentUser(req).id, input) });
  });

  router.get("/mine", requireAuth, (req, res) => {
    res.json({ requests: listForClient(db, currentUser(req).id).map(toRequestView) });
  });

  router.get("/assigned", requireRole("artist"), (req, res) => {
    res.json({ requests: listForArtist(db, currentUser(req).id).map(toRequestView) });
  });

  router.get("/:id", (req, res) => {
    res.json({ request: toRequestView(loadVisible(req)) });
  });

  router.get("/:id/events", requireAuth, (req, res) => {
    res.json({ events: listEvents(db, loadPrivate(req).id) });
  });

  router.get("/:id/proposals", requireAuth, (req, res) => {
    const user = currentUser(req);
    const request = loadRequest(req);
    let proposals;
    if (request.clientUserId === user.id || isStaff(req)) proposals = listProposals(db, request.id);
    else if (user.role === "artist") proposals = listProposals(db, request.id, user.id);
    else throw new DomainError("not_found", "Request not found");
    res.json({ proposals: proposals.map(toProposalView) });
  });

  router.post("/:id/proposals", requireRole("artist"), (req, res) => {
    const { id } = parse(idParams, req.params);
    const input = parse(proposalBody, req.body);
    res.status(201).json({ proposal: submitProposal(db, currentUser(req).id, id, input) });
  });

  router.put("/:id/proposals", requireRole("artist"), (req, res) => {
    const { id } = parse(idParams, req.params);
    const input = parse(proposalBody, req.body);
    res.json({ proposal: updateProposal(db, currentUser(req).id, id, input) });
  });

  router.delete("/:id/proposals", requireRole("artist"), (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ proposal: withdrawProposal(db, currentUser(req).id, id) });
  });

  router.post("/:id/accept", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    const { proposalId } = parse(acceptBody, req.body);
    res.json({ request: acceptProposal(db, currentUser(req).id, id, proposalId) });
  });

  router.post("/:id/start", requireRole("artist"), (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ request: startWork(db, currentUser(req).id, id) });
  });

  router.post("/:id/deliver", requireRole("artist"), (req, res) => {
    const { id } = parse(idParams, req.params);
    const input = parse(deliverBody, req.body);
    res.json({ request: deliver(db, config, currentUser(req).id, id, input) });
  });

  router.post("/:id/revise", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    const { note } = parse(noteBody, req.body);
    res.json({ request: requestRevision(db, currentUser(req).id, id, note) });
  });

  router.post("/:id/approve", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ request: approveDelivery(db, currentUser(req).id, id) });
  });

  router.post("/:id/dispute", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    const { reason } = parse(reasonBody, req.body);
    res.json({ request: openRequestDispute(db, currentUser(req).id, id, reason) });
  });

  router.post("/:id/withdraw", requireRole("artist"), (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ request: artistWithdraw(db, currentUser(req).id, id) });
  });

  router.post("/:id/cancel", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ request: cancelRequest(db, currentUser(req).id, id) });
  });

  /** The latest delivered file. Parties may download it; staff only while the request is disputed. */
  router.get("/:id/delivery", requireAuth, async (req, res) => {
    const request = loadPrivate(req);
    const staffAllowed = isStaff(req) && request.status === "disputed";
    if (!isParty(req, request) && !staffAllowed) throw new DomainError("not_found", "Request not found");
    if (request.status === "refunded" && req.user?.id === request.clientUserId) {
      throw new DomainError("invalid_request_state", "This request was refunded");
    }
    const delivery = latestDelivery(db, request.id);
    if (!delivery) throw new DomainError("not_found", "Nothing has been delivered yet");
    const data = await storage.read(delivery.storedName);
    res.setHeader("Content-Type", delivery.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${delivery.originalName}"`);
    res.setHeader("X-Delivery-Version", String(delivery.version));
    res.send(data);
  });

  return router;
}
