import { describe, expect, it } from "vitest";
import { ApiError, buildQuery, createClient, describeError, toApiError } from "../src/lib/client.js";

interface Call {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string; credentials?: string };
}

function fakeFetch(status: number, body: string, calls: Call[] = []) {
  const fn = async (url: string, init?: Call["init"]) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fn, calls };
}

describe("buildQuery", () => {
  it("encodes values and skips empty ones", () => {
    expect(buildQuery({ q: "a b", n: 2, off: false, none: undefined, nothing: null, empty: "" })).toBe("?q=a+b&n=2&off=false");
    expect(buildQuery()).toBe("");
    expect(buildQuery({})).toBe("");
  });
});

describe("createClient", () => {
  it("sends GET requests with a query and same-origin credentials", async () => {
    const { fn, calls } = fakeFetch(200, '{"ok":true}');
    const result = await createClient(fn).get<{ ok: boolean }>("/search", { q: "cat" });
    expect(result).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ url: "/api/search?q=cat", init: { method: "GET", credentials: "same-origin" } });
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(calls[0]?.init?.headers).toEqual({ Accept: "application/json" });
  });

  it("sends JSON bodies for POST and PUT", async () => {
    const { fn, calls } = fakeFetch(201, '{"id":1}');
    const client = createClient(fn);
    await client.post("/orders", { listingId: 1, license: "commercial" });
    await client.put("/reviews/1", { rating: 4 });
    expect(calls[0]?.init).toMatchObject({ method: "POST", body: '{"listingId":1,"license":"commercial"}' });
    expect(calls[0]?.init?.headers?.["Content-Type"]).toBe("application/json");
    expect(calls[1]?.init).toMatchObject({ method: "PUT", body: '{"rating":4}' });
  });

  it("returns undefined for an empty response", async () => {
    const { fn } = fakeFetch(204, "");
    expect(await createClient(fn).post("/auth/logout")).toBeUndefined();
  });

  it("raises ApiError with the server's code and message", async () => {
    const { fn } = fakeFetch(402, '{"error":{"code":"insufficient_funds","message":"Your wallet balance is too low"}}');
    const error = await createClient(fn).post("/orders", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 402, code: "insufficient_funds", message: "Your wallet balance is too low" });
  });

  it("copes with error bodies that are not JSON", async () => {
    const { fn } = fakeFetch(502, "<html>Bad gateway</html>");
    const error = await createClient(fn).get("/x").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: "http_error", message: "Request failed (502)" });
  });

  it("sends DELETE without a body", async () => {
    const { fn, calls } = fakeFetch(204, "");
    await createClient(fn).del("/assets/1");
    expect(calls[0]).toMatchObject({ url: "/api/assets/1", init: { method: "DELETE" } });
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("honors a custom base path", async () => {
    const { fn, calls } = fakeFetch(200, "{}");
    await createClient(fn, "/v2").get("/ping");
    expect(calls[0]?.url).toBe("/v2/ping");
  });
});

describe("describeError", () => {
  it("lists validation problems", () => {
    const error = new ApiError(400, "validation_error", "Invalid request", [
      { path: "email", message: "Invalid email" },
      { path: "", message: "Bad body" },
    ]);
    expect(describeError(error)).toBe("email: Invalid email; Bad body");
  });

  it("falls back to the message", () => {
    expect(describeError(new ApiError(404, "not_found", "Not found"))).toBe("Not found");
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("weird")).toBe("Something went wrong");
    expect(describeError(new ApiError(400, "validation_error", "Invalid request", []))).toBe("Invalid request");
  });
});

describe("toApiError", () => {
  it("reads the server's error envelope", () => {
    const error = toApiError(409, '{"error":{"code":"asset_in_use","message":"In use","details":[1]}}');
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "asset_in_use", message: "In use", details: [1] });
  });

  it.each(["", "not json", "[]", "null", '{"error":null}', '{"other":1}'])("falls back for %j", (body) => {
    expect(toApiError(500, body)).toMatchObject({ status: 500, code: "http_error", message: "Request failed (500)" });
  });
});
