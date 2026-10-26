import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchRoute } from "../src/lib/router.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path: path.slice(SRC.length + 1), text: readFileSync(path, "utf8") }));
const code = files.filter((file) => /\.tsx?$/.test(file.path));
const components = code.filter((file) => file.path.endsWith(".tsx"));

/** "/listings/${id}" becomes "/listings/1" so it can be matched against the route table. */
const concrete = (path: string): string => path.replace(/\$\{[^}]*\}/g, "1");

describe("links in the web app", () => {
  it("only point at pages that exist", () => {
    const broken: string[] = [];
    let checked = 0;
    for (const file of components) {
      for (const match of file.text.matchAll(/\bhref(?:WithParams)?\(\s*(["'`])([^"'`]*)\1/g)) {
        checked += 1;
        if (!matchRoute(concrete(match[2] as string))) broken.push(`${file.path}: ${match[2]}`);
      }
      for (const match of file.text.matchAll(/\bnavigate\(\s*(["'`])([^"'`]*)\1/g)) {
        checked += 1;
        const target = concrete(match[2] as string).split("?")[0] as string;
        if (!matchRoute(target.replace(/^#/, ""))) broken.push(`${file.path}: navigate ${match[2]}`);
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(broken).toEqual([]);
  });

  it("never use plain path or #anchor hrefs that the hash router would misread", () => {
    const suspicious: string[] = [];
    for (const file of components) {
      for (const match of file.text.matchAll(/\bhref=(["'])([^"']*)\1/g)) {
        const value = match[2] as string;
        const ok = value === "#/" || (value.startsWith("#/") && matchRoute(value.slice(1).split("?")[0] as string) !== null);
        if (!ok) suspicious.push(`${file.path}: href="${value}"`);
      }
      for (const match of file.text.matchAll(/\bhref=\{`([^`]*)`\}/g)) {
        if (!(match[1] as string).startsWith("/api/")) suspicious.push(`${file.path}: href={\`${match[1]}\`}`);
      }
    }
    expect(suspicious).toEqual([]);
  });
});

describe("React effects", () => {
  it("never return a value from an expression-bodied effect", () => {
    // `useEffect(() => window.scrollTo(0, 0))` returns scrollTo's result, which React then calls as a cleanup function.
    const offenders = code.filter((file) => /useEffect\(\s*\(\)\s*=>\s*[^{\s]/.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("only use #/ style navigation through the router helpers", () => {
    const offenders = components.filter((file) => /location\.href\s*=/.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
