import { Router } from "express";
import { FORMAT_INFO } from "../../assets/signatures.js";
import { listCategories } from "../../catalog/categories.js";
import { CATEGORY_RULES } from "../../catalog/rules.js";
import type { Db } from "../../db/connection.js";

export function catalogRouter(db: Db): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const categories = listCategories(db).map((category) => {
      const rule = CATEGORY_RULES[category.slug];
      return {
        slug: category.slug,
        name: category.name,
        allowedMimeTypes: rule ? rule.formats.map((format) => FORMAT_INFO[format].mime) : [],
        maxBytes: rule?.maxBytes ?? 0,
      };
    });
    res.json({ categories });
  });

  return router;
}
