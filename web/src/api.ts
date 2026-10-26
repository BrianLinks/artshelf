import { buildQuery, createClient, toApiError } from "./lib/client";
import type { AssetItem, Category } from "./lib/types";

export const api = createClient((url, init) => fetch(url, init));

let categories: Promise<Category[]> | null = null;

/** Categories rarely change, so they are fetched once per page load. */
export function loadCategories(): Promise<Category[]> {
  if (categories === null) {
    categories = api
      .get<{ categories: Category[] }>("/categories")
      .then((response) => response.categories)
      .catch((error: unknown) => {
        categories = null;
        throw error;
      });
  }
  return categories;
}

/** Uploads one file as raw bytes. The server decides what the file really is from its content. */
export async function uploadAsset(file: File, category: string): Promise<AssetItem> {
  const response = await fetch(`/api/assets${buildQuery({ category, filename: file.name })}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", Accept: "application/json" },
    body: file,
    credentials: "same-origin",
  });
  const text = await response.text();
  if (!response.ok) throw toApiError(response.status, text);
  return (JSON.parse(text) as { asset: AssetItem }).asset;
}
