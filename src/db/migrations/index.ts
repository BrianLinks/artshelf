import type { Migration } from "../migrate.js";
import { migration001 } from "./001_init.js";
import { migration002 } from "./002_catalog.js";
import { migration003 } from "./003_listings.js";

export const MIGRATIONS: readonly Migration[] = [migration001, migration002, migration003];
