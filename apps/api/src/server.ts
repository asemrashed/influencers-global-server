import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { loadEnvOrExit } from './cli/context.js';
import { buildContainer } from './container.js';

const env = loadEnvOrExit(); // refuses to start on invalid configuration
const c = buildContainer(env);
const { app } = createApp(c);

const { newPermissions } = await bootstrap(c);
if (newPermissions.length) c.logger.info({ newPermissions }, 'new permissions registered');
if (c.jobs.enabled) await c.jobs.start();

const server = app.listen(env.PORT, env.HOST, () => {
  c.logger.info({ port: env.PORT, env: env.NODE_ENV, version: env.APP_VERSION, docs: env.API_DOCS_ENABLED }, 'api listening');
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  c.logger.info({ signal }, 'shutting down');
  server.close();
  await c.jobs.stop().catch((err) => c.logger.error({ err }, 'job shutdown failed'));
  await c.db.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
