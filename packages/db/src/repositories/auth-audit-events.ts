import type { AuthAuditWriter, JsonValue, WriteAuthAuditEventInput } from '@time-management/auth';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { authAuditEvents } from '../schema.js';
import type * as dbSchema from '../schema.js';

type AuthAuditDatabase = Pick<NodePgDatabase<typeof dbSchema>, 'insert'>;

const unsafeAuditMetadataKeys = new Set([
  'password',
  'password_hash',
  'token',
  'session_token',
  'token_hash',
  'secret',
  'api_key',
  'authorization',
  'cookie',
  'bearer',
  'raw_secret',
]);

export function createAuthAuditWriter(db: AuthAuditDatabase): AuthAuditWriter {
  return {
    async writeAuthAuditEvent(input) {
      if (input.metadata !== null) {
        validateAuditMetadataSafety(input.metadata);
      }

      await db.insert(authAuditEvents).values(mapAuthAuditEventInput(input));
    },
  };
}

function mapAuthAuditEventInput(
  input: WriteAuthAuditEventInput,
): typeof authAuditEvents.$inferInsert {
  return {
    id: input.id,
    userId: input.userId,
    emailNormalized: input.emailNormalized,
    eventType: input.eventType,
    success: input.success,
    reason: input.reason,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: input.metadata,
    retentionUntil: input.retentionUntil,
    createdAt: input.createdAt,
  };
}

function validateAuditMetadataSafety(metadata: JsonValue, seen = new WeakSet<object>()): void {
  if (metadata === null || typeof metadata !== 'object') {
    return;
  }

  if (seen.has(metadata)) {
    return;
  }

  seen.add(metadata);

  if (Array.isArray(metadata)) {
    metadata.forEach((item) => validateAuditMetadataSafety(item, seen));
    seen.delete(metadata);
    return;
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (unsafeAuditMetadataKeys.has(normalizeMetadataKey(key))) {
      throw new Error(`Auth audit metadata contains unsafe key: ${key}`);
    }

    validateAuditMetadataSafety(value, seen);
  }

  seen.delete(metadata);
}

function normalizeMetadataKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}
