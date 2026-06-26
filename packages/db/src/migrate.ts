import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const { Pool } = pg;

const migrationsFolder = new URL('../migrations', import.meta.url);

export async function runMigrations(connectionString: string): Promise<void> {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const pool = new Pool({ connectionString });

  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: fileURLToPath(migrationsFolder) });
  } finally {
    await pool.end();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];

  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL is required to run migrations');
    process.exit(1);
  }

  runMigrations(connectionString).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Migration failed');
    process.exit(1);
  });
}
