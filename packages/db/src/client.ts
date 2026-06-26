import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

export interface DatabaseConfig {
  connectionString: string;
}

export function createDatabaseConfig(connectionString: string): DatabaseConfig {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to create a database client');
  }

  return { connectionString };
}

export function createDatabasePool(config: DatabaseConfig): Pool {
  return new Pool({ connectionString: config.connectionString });
}

export function createDatabaseClient(config: DatabaseConfig, pool?: Pool) {
  const client = pool ?? createDatabasePool(config);
  return drizzle(client, { schema });
}

export async function closeDatabasePool(pool: Pool): Promise<void> {
  await pool.end();
}
