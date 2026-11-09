/**
 * Shared test bootstrap: loads .env.test when running tests directly (not only via npm scripts).
 * Import this first in integration tests if needed. Safe: does not override already-set env vars.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const envTest = path.join(here, '..', '.env.test');
if (existsSync(envTest)) dotenv.config({ path: envTest, override: false });
