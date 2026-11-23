// Entry point. Configuration comes from environment variables (see .env.example in the repo root).
import { buildApp } from './app';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const app = buildApp({
  dbPath: process.env.DB_PATH ?? './lumen.db',
  staticDir: process.env.STATIC_DIR,
  logger: true,
});

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}
