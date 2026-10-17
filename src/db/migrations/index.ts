import type { Migration } from "../migrate.js";
import { migration001 } from "./001_init.js";
import { migration002 } from "./002_catalog.js";

export const MIGRATIONS: readonly Migration[] = [migration001, migration002];
