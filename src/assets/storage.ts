import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

/** Generated names only: 32 hex chars plus a known extension, or the ".thumb.webp" thumbnail form. */
const STORED_NAME = /^[a-f0-9]{32}(\.thumb\.webp|\.(png|jpg|webp|pdf|zip|wav|mp3|mp4))$/;

export class LocalStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  /** Maps a generated name to a path inside the root. Anything else, including traversal attempts, throws. */
  pathFor(name: string): string {
    if (!STORED_NAME.test(name)) throw new Error("Invalid stored file name");
    const full = resolve(this.root, name);
    if (!full.startsWith(this.root + sep)) throw new Error("Path escapes storage root");
    return full;
  }

  /** Never overwrites an existing file. */
  async write(name: string, data: Buffer): Promise<void> {
    await writeFile(this.pathFor(name), data, { flag: "wx" });
  }

  read(name: string): Promise<Buffer> {
    return readFile(this.pathFor(name));
  }

  async remove(name: string): Promise<void> {
    await rm(this.pathFor(name), { force: true });
  }
}

/** Keeps only the last path segment and a conservative character set. The result is for display only. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 100);
  return cleaned === "" ? "upload" : cleaned;
}
