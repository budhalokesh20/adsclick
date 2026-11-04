import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

/** Ask the OS for a free ephemeral port (avoids conflicts with orphaned postmasters). */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr != null ? addr.port : 5444;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Starts a disposable PostgreSQL instance for the test session, applies
 * migrations, and stops it at the end. Set TEST_DATABASE_URL to use an
 * external database instead (e.g. CI).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    return async () => undefined;
  }

  const port = await getFreePort();
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(os.tmpdir(), `adshare-pg-${randomUUID()}`),
    user: 'postgres',
    password: 'postgres',
    port,
  });

  await pg.initialise();
  await pg.start();
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;

  execSync('npx prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });

  return async () => {
    await pg.stop().catch(() => undefined);
  };
}
