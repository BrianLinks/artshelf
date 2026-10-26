import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY } from "../src/http/app.js";
import { makeTestApp } from "./helpers.js";

function builtWebApp(): string {
  const dir = mkdtempSync(join(tmpdir(), "artshelf-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), '<!doctype html><html><head><title>ArtShelf</title></head><body><div id="root"></div></body></html>');
  writeFileSync(join(dir, "assets", "app.js"), "console.log('app');");
  writeFileSync(join(dir, ".secret"), "hidden");
  return dir;
}

describe("serving the built web app", () => {
  const dir = builtWebApp();
  const { app } = makeTestApp({ WEB_DIST: dir });

  it("serves index.html at the root with a content security policy", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.text).toContain("<title>ArtShelf</title>");
    expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("restricts the policy to this site", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("serves built assets with caching", async () => {
    const response = await request(app).get("/assets/app.js");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/javascript/);
    expect(response.headers["cache-control"]).toMatch(/max-age=3600/);
  });

  it("returns index.html for unknown paths so the app can route them, without caching it", async () => {
    for (const path of ["/listings/5", "/some/deep/link", "/search"]) {
      const response = await request(app).get(path);
      expect(response.status).toBe(200);
      expect(response.text).toContain('<div id="root">');
      expect(response.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("keeps JSON errors and no-store caching for the API", async () => {
    const missing = await request(app).get("/api/does-not-exist");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.headers["cache-control"]).toBe("no-store");
    expect(health.headers["content-security-policy"]).toBeUndefined();
  });

  it("only answers GET and HEAD for pages", async () => {
    expect((await request(app).post("/")).status).toBe(404);
    expect((await request(app).put("/listings/5").send({})).status).toBe(404);
    expect((await request(app).head("/")).status).toBe(200);
  });

  it("does not serve dotfiles or files outside the folder", async () => {
    const dotfile = await request(app).get("/.secret");
    expect(dotfile.text).not.toContain("hidden");
    for (const path of ["/..%2f..%2fetc%2fpasswd", "/%2e%2e/%2e%2e/etc/passwd", "/assets/..%2f..%2f..%2fetc%2fpasswd"]) {
      const response = await request(app).get(path);
      expect(response.text).not.toContain("root:");
    }
  });
});

describe("without a built web app", () => {
  const { app } = makeTestApp({ WEB_DIST: join(tmpdir(), "artshelf-no-such-folder") });

  it("behaves like an API-only server", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
    expect(response.headers["content-security-policy"]).toBeUndefined();
    expect((await request(app).get("/api/health")).status).toBe(200);
  });
});
