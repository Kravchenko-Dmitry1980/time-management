import type { AuthUserRecord, AuthUserRepository } from '@time-management/auth';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { users } from '../schema.js';
import type * as dbSchema from '../schema.js';

type AuthUserDatabase = Pick<NodePgDatabase<typeof dbSchema>, 'select'>;
type UserRow = typeof users.$inferSelect;

export function createAuthUserRepository(db: AuthUserDatabase): AuthUserRepository {
  return {
    async findByEmail(emailNormalized) {
      const [row] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${emailNormalized}`)
        .limit(1);

      return row === undefined ? null : mapUser(row);
    },

    async findById(userId) {
      const [row] = await db
        .select()
        .from(users)
        .where(sql`${users.id} = ${userId}`)
        .limit(1);

      return row === undefined ? null : mapUser(row);
    },
  };
}

function mapUser(row: UserRow): AuthUserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    name: row.name,
    status: row.status,
    disabledAt: row.disabledAt,
    archivedAt: row.archivedAt,
  };
}
