import { randomUUID } from 'node:crypto';

import { InvalidCredentialsError, InvalidSessionError } from './errors.js';
import { verifyPassword } from './password.js';
import { generateSessionToken, hashSessionToken } from './session-token.js';
import type {
  AuthAuditEventType,
  AuthServiceDependencies,
  AuthSessionRecord,
  AuthUserRecord,
  JsonValue,
  LoginInput,
  LoginSuccess,
  SafeAuthUser,
} from './types.js';

const defaultSessionTtlMs = 1000 * 60 * 60 * 24 * 14;

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

export class AuthService {
  private readonly passwordVerifier: (password: string, passwordHash: string) => Promise<boolean>;
  private readonly sessionTokenGenerator: () => string;
  private readonly sessionTokenHasher: (sessionToken: string) => string;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;
  private readonly sessionTtlMs: number;

  constructor(private readonly dependencies: AuthServiceDependencies) {
    this.passwordVerifier = dependencies.passwordVerifier ?? verifyPassword;
    this.sessionTokenGenerator = dependencies.sessionTokenGenerator ?? generateSessionToken;
    this.sessionTokenHasher = dependencies.sessionTokenHasher ?? hashSessionToken;
    this.idGenerator = dependencies.idGenerator ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
    this.sessionTtlMs = dependencies.sessionTtlMs ?? defaultSessionTtlMs;
  }

  async login(input: LoginInput): Promise<LoginSuccess> {
    const emailNormalized = normalizeEmail(input.email);
    const context = normalizeContext(input);
    const user = await this.dependencies.userRepository.findByEmail(emailNormalized);

    if (user === null) {
      await this.writeAudit({
        eventType: 'login_failed',
        userId: null,
        emailNormalized,
        success: false,
        reason: 'user_not_found',
        context,
      });
      throw new InvalidCredentialsError();
    }

    if (!isActivePasswordUser(user)) {
      await this.writeAudit({
        eventType: 'login_failed',
        userId: user.id,
        emailNormalized,
        success: false,
        reason: user.passwordHash === null ? 'password_auth_unavailable' : `user_${user.status}`,
        context,
      });
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await this.passwordVerifier(input.password, user.passwordHash);

    if (!passwordMatches) {
      await this.writeAudit({
        eventType: 'login_failed',
        userId: user.id,
        emailNormalized,
        success: false,
        reason: 'invalid_password',
        context,
      });
      throw new InvalidCredentialsError();
    }

    const createdAt = this.now();
    const sessionToken = this.sessionTokenGenerator();
    const tokenHash = this.sessionTokenHasher(sessionToken);
    const session = await this.dependencies.sessionRepository.createSession({
      id: this.idGenerator(),
      userId: user.id,
      tokenHash,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      expiresAt: new Date(createdAt.getTime() + this.sessionTtlMs),
      createdAt,
      updatedAt: createdAt,
    });

    await this.writeAudit({
      eventType: 'login_success',
      userId: user.id,
      emailNormalized,
      success: true,
      reason: null,
      context,
      metadata: { session_id: session.id },
    });

    return {
      user: toSafeUser(user),
      session,
      sessionToken,
    };
  }

  async logout(
    sessionToken: string,
    context: { userAgent?: string | null; ipAddress?: string | null } = {},
  ): Promise<void> {
    const revokedAt = this.now();
    const tokenHash = this.sessionTokenHasher(sessionToken);
    const session = await this.dependencies.sessionRepository.findActiveByTokenHash(
      tokenHash,
      revokedAt,
    );

    await this.dependencies.sessionRepository.revokeByTokenHash(tokenHash, revokedAt);
    await this.writeAudit({
      eventType: 'logout',
      userId: session?.userId ?? null,
      emailNormalized: null,
      success: true,
      reason: session === null ? 'session_not_found' : null,
      context: normalizeContext(context),
      metadata: session === null ? null : { session_id: session.id },
    });
  }

  async validateSession(
    sessionToken: string,
  ): Promise<{ user: SafeAuthUser; session: AuthSessionRecord }> {
    const validatedAt = this.now();
    const tokenHash = this.sessionTokenHasher(sessionToken);
    const session = await this.dependencies.sessionRepository.findActiveByTokenHash(
      tokenHash,
      validatedAt,
    );

    if (session === null) {
      throw new InvalidSessionError();
    }

    const user = await this.dependencies.userRepository.findById(session.userId);

    if (user === null || user.status !== 'active') {
      await this.dependencies.sessionRepository.revokeByTokenHash(tokenHash, validatedAt);
      await this.writeAudit({
        eventType: 'session_revoked',
        userId: session.userId,
        emailNormalized: user?.email ? normalizeEmail(user.email) : null,
        success: false,
        reason: user === null ? 'user_not_found' : `user_${user.status}`,
        context: { userAgent: null, ipAddress: null },
        metadata: { session_id: session.id },
      });
      throw new InvalidSessionError();
    }

    await this.dependencies.sessionRepository.touch(session.id, validatedAt);
    await this.writeAudit({
      eventType: 'session_validated',
      userId: user.id,
      emailNormalized: normalizeEmail(user.email),
      success: true,
      reason: null,
      context: { userAgent: null, ipAddress: null },
      metadata: { session_id: session.id },
    });

    return {
      user: toSafeUser(user),
      session: {
        ...session,
        lastUsedAt: validatedAt,
      },
    };
  }

  private async writeAudit(input: {
    eventType: AuthAuditEventType;
    userId: string | null;
    emailNormalized: string | null;
    success: boolean;
    reason: string | null;
    context: { userAgent: string | null; ipAddress: string | null };
    metadata?: JsonValue | null;
  }): Promise<void> {
    const metadata = input.metadata ?? null;

    if (metadata !== null) {
      validateAuditMetadataSafety(metadata);
    }

    await this.dependencies.auditWriter.writeAuthAuditEvent({
      id: this.idGenerator(),
      userId: input.userId,
      emailNormalized: input.emailNormalized,
      eventType: input.eventType,
      success: input.success,
      reason: input.reason,
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
      metadata,
      retentionUntil: null,
      createdAt: this.now(),
    });
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toSafeUser(user: AuthUserRecord): SafeAuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
  };
}

function isActivePasswordUser(
  user: AuthUserRecord,
): user is AuthUserRecord & { passwordHash: string } {
  return (
    user.status === 'active' &&
    user.disabledAt === null &&
    user.archivedAt === null &&
    user.passwordHash !== null
  );
}

function normalizeContext(input: { userAgent?: string | null; ipAddress?: string | null }): {
  userAgent: string | null;
  ipAddress: string | null;
} {
  return {
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null,
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
