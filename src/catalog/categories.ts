import type { Db } from "../db/connection.js";

export interface Category {
  id: number;
  slug: string;
  name: string;
}

export function listCategories(db: Db): Category[] {
  return db.prepare("SELECT id, slug, name FROM categories ORDER BY sort_order").all() as Category[];
}

export function findCategoryBySlug(db: Db, slug: string): Category | undefined {
  return db.prepare("SELECT id, slug, name FROM categories WHERE slug = ?").get(slug) as Category | undefined;
}
