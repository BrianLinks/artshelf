import type { Migration } from "../migrate.js";
import { migration001 } from "./001_init.js";

export const MIGRATIONS: readonly Migration[] = [migration001];
