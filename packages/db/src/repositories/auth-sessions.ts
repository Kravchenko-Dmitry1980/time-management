import type {
  AuthSessionRecord,
  AuthSessionRepository,
  CreateSessionInput,
} from '@time-management/auth';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { authSessions } from '../schema.js';
import type * as dbSchema from '../schema.js';

type AuthSessionDatabase = Pick<NodePgDatabase<typeof dbSchema>, 'insert' | 'select' | 'update'>;
type AuthSessionRow = typeof authSessions.$inferSelect;

export function createAuthSessionRepository(db: AuthSessionDatabase): AuthSessionRepository {
  return {
    async createSession(input) {
      const [row] = await db.insert(authSessions).values(mapCreateSessionInput(input)).returning();

      if (row === undefined) {
        throw new Error('Failed to create auth session');
      }

      return mapSession(row);
    },

    async findActiveByTokenHash(tokenHash, now) {
      const [row] = await db
        .select()
        .from(authSessions)
        .where(
          and(
            eq(authSessions.tokenHash, tokenHash),
            isNull(authSessions.revokedAt),
            gt(authSessions.expiresAt, now),
          ),
        )
        .limit(1);

      return row === undefined ? null : mapSession(row);
    },

    async revokeByTokenHash(tokenHash, revokedAt) {
      await db
        .update(authSessions)
        .set({ revokedAt, updatedAt: revokedAt })
        .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)));
    },

    async touch(sessionId, lastUsedAt) {
      await db
        .update(authSessions)
        .set({ lastUsedAt, updatedAt: lastUsedAt })
        .where(eq(authSessions.id, sessionId));
    },
  };
}

function mapCreateSessionInput(input: CreateSessionInput): typeof authSessions.$inferInsert {
  return {
    id: input.id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    expiresAt: input.expiresAt,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function mapSession(row: AuthSessionRow): AuthSessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
