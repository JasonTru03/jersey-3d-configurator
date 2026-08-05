import { cleanExpiredProductionDrafts } from '../workers/production/cleanupDrafts.js';
import { readServerConfig } from './config.js';
import { createNodeHttpServer } from './httpServer.js';
import { createServerRuntime } from './runtime.js';

const CLEANUP_INTERVAL_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = readServerConfig();
const runtime = createServerRuntime({ config });
const server = createNodeHttpServer({
  handler: runtime.handler,
  publicOrigin: config.publicOrigin,
  trustProxy: config.trustProxy,
});
let cleanupRunning = false;
const cleanupTimer = setInterval(() => {
  void runCleanup();
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

server.listen(config.port, '0.0.0.0', () => {
  console.log(`JERSEY_SERVER_READY port=${config.port}`);
});

server.on('error', (error) => {
  console.error('JERSEY_SERVER_LISTEN_FAILED', error?.code ?? error?.name ?? 'Error');
  shutdown(1);
});

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

async function runCleanup() {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    const summary = await cleanExpiredProductionDrafts(runtime.env, Date.now());
    if (summary.scanned > 0 || summary.failed > 0) {
      console.log(
        `PRODUCTION_DRAFT_CLEANUP scanned=${summary.scanned} deleted=${summary.deleted} failed=${summary.failed}`,
      );
    }
  } catch (error) {
    console.error('PRODUCTION_DRAFT_CLEANUP_FAILED', error?.code ?? error?.name ?? 'Error');
  } finally {
    cleanupRunning = false;
  }
}

function shutdown(exitCode) {
  clearInterval(cleanupTimer);
  const forced = setTimeout(() => {
    server.closeAllConnections();
  }, SHUTDOWN_TIMEOUT_MS);
  forced.unref();
  server.close(() => {
    clearTimeout(forced);
    try {
      runtime.close();
    } finally {
      process.exit(exitCode);
    }
  });
}
