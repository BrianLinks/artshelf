import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage, sanitizeFilename } from "../src/assets/storage.js";

describe("LocalStorage", () => {
  let dir: string;
  let storage: LocalStorage;
  const name = "0123456789abcdef0123456789abcdef.png";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "artshelf-storage-"));
    storage = new LocalStorage(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes, reads and removes a file", async () => {
    await storage.write(name, Buffer.from("data"));
    expect((await storage.read(name)).toString()).toBe("data");
    await storage.remove(name);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("accepts thumbnail names", () => {
    expect(() => storage.pathFor("0123456789abcdef0123456789abcdef.thumb.webp")).not.toThrow();
  });

  it("refuses to overwrite an existing file", async () => {
    await storage.write(name, Buffer.from("one"));
    await expect(storage.write(name, Buffer.from("two"))).rejects.toThrow();
    expect((await storage.read(name)).toString()).toBe("one");
  });

  it.each([
    "../secret.png",
    "..\\secret.png",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "0123456789abcdef0123456789abcdef.png/../../x",
    "0123456789ABCDEF0123456789ABCDEF.png",
    "short.png",
    "0123456789abcdef0123456789abcdef.php5",
    "0123456789abcdef0123456789abcdef",
    "",
  ])("rejects the unsafe name %j", (unsafe) => {
    expect(() => storage.pathFor(unsafe)).toThrow();
  });

  it("keeps resolved paths inside the root", () => {
    expect(storage.pathFor(name).startsWith(storage.root)).toBe(true);
  });
});

describe("sanitizeFilename", () => {
  it.each([
    ["art.png", "art.png"],
    ["../../etc/passwd.png", "passwd.png"],
    ["C:\\Users\\me\\pic.jpg", "pic.jpg"],
    ["we!rd<>name?.png", "we_rd__name_.png"],
    [".hidden", "hidden"],
    ["", "upload"],
    ["///", "upload"],
    ["   ", "upload"],
  ])("cleans %j to %j", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("limits length", () => {
    expect(sanitizeFilename("a".repeat(500) + ".png").length).toBeLessThanOrEqual(100);
  });
});
