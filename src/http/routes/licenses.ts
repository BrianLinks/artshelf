import { Router } from "express";
import { LICENSE_TYPES, LICENSES, USES } from "../../licenses/definitions.js";

export function licensesRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      licenses: LICENSE_TYPES.map((type) => ({
        type,
        name: LICENSES[type].name,
        priceMultiplierBps: LICENSES[type].priceMultiplierBps,
        allowedUses: LICENSES[type].allowedUses,
      })),
      uses: USES,
    });
  });

  return router;
}
