import { existsSync } from 'node:fs';
import { EnvValidationError, loadApiEnv, type ApiEnv } from '@platform/config';

/** Loads `.env` (if present) and validates. Shared by the server and CLI scripts so they cannot disagree. */
export function loadEnvOrExit(): ApiEnv {
  if (existsSync('.env')) process.loadEnvFile('.env');
  try {
    return loadApiEnv(process.env);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
