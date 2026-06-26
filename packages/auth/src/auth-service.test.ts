import { describe, expect, it } from 'vitest';

import { AuthService } from './auth-service.js';
import { InvalidCredentialsError, InvalidSessionError } from './errors.js';
import { hashPassword, verifyPassword } from './password.js';
import { generateSessionToken, hashSessionToken } from './session-token.js';
import type {
  AuthAuditWriter,
  AuthSessionRecord,
  AuthSessionRepository,
  AuthUserRecord,
  AuthUserRepository,
  CreateSessionInput,
  WriteAuthAuditEventInput,
} from './types.js';

const fixedNow = new Date('2026-06-26T12:00:00.000Z');
const fixedTtlMs = 1000 * 60 * 60;
const fixedSessionToken = 'plain-session-token';
const fixedTokenHash = hashSessionToken(fixedSessionToken);

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    email: 'owner@local.dev',
    passwordHash: 'valid-hash',
    name: 'Owner',
    status: 'active',
    disabledAt: null,
    archivedAt: null,
    ...overrides,
  };
}

class FakeUserRepository implements AuthUserRepository {
  constructor(public users: AuthUserRecord[]) {}

  async findByEmail(emailNormalized: string): Promise<AuthUserRecord | null> {
    return this.users.find((user) => user.email.toLowerCase() === emailNormalized) ?? null;
  }

  async findById(userId: string): Promise<AuthUserRecord | null> {
    return this.users.find((user) => user.id === userId) ?? null;
  }
}

class FakeSessionRepository implements AuthSessionRepository {
  public sessions: AuthSessionRecord[] = [];
  public touchedSessionIds: string[] = [];

  async createSession(input: CreateSessionInput): Promise<AuthSessionRecord> {
    const session: AuthSessionRecord = {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };

    this.sessions.push(session);

    return session;
  }

  async findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthSessionRecord | null> {
    return (
      this.sessions.find(
        (session) =>
          session.tokenHash === tokenHash &&
          session.revokedAt === null &&
          session.expiresAt.getTime() > now.getTime(),
      ) ?? null
    );
  }

  async revokeByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.find(
      (candidate) => candidate.tokenHash === tokenHash && candidate.revokedAt === null,
    );

    if (session !== undefined) {
      session.revokedAt = revokedAt;
      session.updatedAt = revokedAt;
    }
  }

  async touch(sessionId: string, lastUsedAt: Date): Promise<void> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);

    if (session !== undefined) {
      session.lastUsedAt = lastUsedAt;
      session.updatedAt = lastUsedAt;
      this.touchedSessionIds.push(sessionId);
    }
  }
}

class FakeAuditWriter implements AuthAuditWriter {
  public events: WriteAuthAuditEventInput[] = [];

  async writeAuthAuditEvent(input: WriteAuthAuditEventInput): Promise<void> {
    this.events.push(input);
  }
}

function createService({
  users = [createUser()],
  sessions = new FakeSessionRepository(),
  audit = new FakeAuditWriter(),
}: {
  users?: AuthUserRecord[];
  sessions?: FakeSessionRepository;
  audit?: FakeAuditWriter;
} = {}) {
  let idCounter = 0;

  const service = new AuthService({
    userRepository: new FakeUserRepository(users),
    sessionRepository: sessions,
    auditWriter: audit,
    passwordVerifier: async (password, passwordHash) =>
      password === 'correct-password' && passwordHash === 'valid-hash',
    sessionTokenGenerator: () => fixedSessionToken,
    sessionTokenHasher: hashSessionToken,
    idGenerator: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
    now: () => new Date(fixedNow),
    sessionTtlMs: fixedTtlMs,
  });

  return { service, sessions, audit };
}

function createSession(overrides: Partial<AuthSessionRecord> = {}): AuthSessionRecord {
  return {
    id: '00000000-0000-4000-8000-000000000201',
    userId: '00000000-0000-4000-8000-000000000101',
    tokenHash: fixedTokenHash,
    expiresAt: new Date(fixedNow.getTime() + fixedTtlMs),
    revokedAt: null,
    lastUsedAt: null,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    ...overrides,
  };
}

function expectNoAuthSecretInAuditMetadata(metadata: unknown): void {
  const serialized = JSON.stringify(metadata);

  expect(serialized).not.toContain(fixedSessionToken);
  expect(serialized).not.toContain('token');
  expect(serialized).not.toContain('token_hash');
}

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const passwordHash = await hashPassword('correct-password', {
      salt: Buffer.alloc(16, 1),
      N: 16,
      keyLength: 32,
    });

    await expect(verifyPassword('correct-password', passwordHash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const passwordHash = await hashPassword('correct-password', {
      salt: Buffer.alloc(16, 2),
      N: 16,
      keyLength: 32,
    });

    await expect(verifyPassword('wrong-password', passwordHash)).resolves.toBe(false);
  });

  it('fails safely for a malformed hash', async () => {
    await expect(verifyPassword('correct-password', 'not-a-valid-hash')).resolves.toBe(false);
  });
});

describe('session tokens', () => {
  it('generates a plaintext token that differs from its hash', () => {
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);

    expect(token).not.toEqual(tokenHash);
    expect(tokenHash).toHaveLength(64);
  });

  it('hashes the same token deterministically', () => {
    expect(hashSessionToken(fixedSessionToken)).toEqual(hashSessionToken(fixedSessionToken));
  });

  it('does not expose the plaintext token in the hash', () => {
    expect(hashSessionToken(fixedSessionToken)).not.toContain(fixedSessionToken);
  });
});

describe('AuthService login', () => {
  it('creates a session and audit event for successful login', async () => {
    const { service, sessions, audit } = createService();

    const result = await service.login({
      email: ' OWNER@LOCAL.DEV ',
      password: 'correct-password',
      userAgent: 'Vitest',
      ipAddress: '127.0.0.1',
    });

    expect(result.user).toEqual({
      id: '00000000-0000-4000-8000-000000000101',
      email: 'owner@local.dev',
      name: 'Owner',
      status: 'active',
    });
    expect('passwordHash' in result.user).toBe(false);
    expect(result.sessionToken).toBe(fixedSessionToken);
    expect(result.session.tokenHash).toBe(fixedTokenHash);
    expect(result.session.tokenHash).not.toBe(result.sessionToken);
    expect(sessions.sessions).toHaveLength(1);
    expect(audit.events.map((event) => event.eventType)).toEqual(['login_success']);
    expect(audit.events[0]?.metadata).toEqual({ session_id: result.session.id });
  });

  it('fails wrong password with InvalidCredentialsError', async () => {
    const { service, audit } = createService();

    await expect(
      service.login({ email: 'owner@local.dev', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(audit.events[0]).toMatchObject({
      eventType: 'login_failed',
      reason: 'invalid_password',
      success: false,
    });
  });

  it('fails missing user with the same public error', async () => {
    const { service, audit } = createService({ users: [] });

    await expect(
      service.login({ email: 'missing@local.dev', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(audit.events[0]).toMatchObject({
      eventType: 'login_failed',
      reason: 'user_not_found',
      success: false,
    });
  });

  it('rejects disabled users', async () => {
    const disabledAt = new Date('2026-06-01T00:00:00.000Z');
    const { service, audit } = createService({
      users: [createUser({ status: 'disabled', disabledAt })],
    });

    await expect(
      service.login({ email: 'owner@local.dev', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(audit.events[0]).toMatchObject({
      eventType: 'login_failed',
      reason: 'user_disabled',
    });
  });

  it('rejects archived users', async () => {
    const archivedAt = new Date('2026-06-01T00:00:00.000Z');
    const { service, sessions, audit } = createService({
      users: [createUser({ status: 'archived', archivedAt })],
    });

    await expect(
      service.login({ email: 'owner@local.dev', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(sessions.sessions).toHaveLength(0);
    expect(audit.events[0]).toMatchObject({
      eventType: 'login_failed',
      reason: 'user_archived',
      success: false,
    });
  });

  it('rejects invited users', async () => {
    const { service, sessions, audit } = createService({
      users: [createUser({ status: 'invited' })],
    });

    await expect(
      service.login({ email: 'owner@local.dev', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(sessions.sessions).toHaveLength(0);
    expect(audit.events[0]).toMatchObject({
      eventType: 'login_failed',
      reason: 'user_invited',
      success: false,
    });
  });

  it('rejects active users without password hash', async () => {
    const { service, audit } = createService({
      users: [createUser({ passwordHash: null })],
    });

    await expect(
      service.login({ email: 'owner@local.dev', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(audit.events[0]).toMatchObject({
      eventType: 'login_failed',
      reason: 'password_auth_unavailable',
    });
  });
});

describe('AuthService logout', () => {
  it('revokes a known session and writes correlated audit', async () => {
    const { service, sessions, audit } = createService();
    await service.login({ email: 'owner@local.dev', password: 'correct-password' });

    await service.logout(fixedSessionToken);

    const session = sessions.sessions[0];
    const logoutAudit = audit.events.find((event) => event.eventType === 'logout');

    expect(session?.revokedAt).toEqual(fixedNow);
    expect(audit.events.map((event) => event.eventType)).toEqual(['login_success', 'logout']);
    expect(logoutAudit).toMatchObject({
      userId: session?.userId,
      eventType: 'logout',
      success: true,
      reason: null,
      metadata: { session_id: session?.id },
    });
    expectNoAuthSecretInAuditMetadata(logoutAudit?.metadata);
  });

  it('does not throw for an unknown token', async () => {
    const { service, audit } = createService();

    await expect(service.logout('unknown-token')).resolves.toBeUndefined();
    expect(audit.events[0]).toMatchObject({
      eventType: 'logout',
      userId: null,
      success: true,
      reason: 'session_not_found',
      metadata: null,
    });
    expectNoAuthSecretInAuditMetadata(audit.events[0]?.metadata);
  });
});

describe('AuthService validateSession', () => {
  it('returns user and session for valid sessions', async () => {
    const { service, sessions, audit } = createService();
    await service.login({ email: 'owner@local.dev', password: 'correct-password' });

    const result = await service.validateSession(fixedSessionToken);

    expect(result.user.id).toBe('00000000-0000-4000-8000-000000000101');
    expect(result.session.lastUsedAt).toEqual(fixedNow);
    expect(sessions.touchedSessionIds).toEqual([result.session.id]);
    expect(audit.events.map((event) => event.eventType)).toEqual([
      'login_success',
      'session_validated',
    ]);
  });

  it('rejects expired sessions', async () => {
    const { service, sessions } = createService();
    await service.login({ email: 'owner@local.dev', password: 'correct-password' });

    const session = sessions.sessions[0];

    if (session !== undefined) {
      session.expiresAt = new Date('2026-06-26T11:59:59.000Z');
    }

    await expect(service.validateSession(fixedSessionToken)).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
  });

  it('rejects revoked sessions', async () => {
    const { service, sessions } = createService();
    await service.login({ email: 'owner@local.dev', password: 'correct-password' });

    const session = sessions.sessions[0];

    if (session !== undefined) {
      session.revokedAt = fixedNow;
    }

    await expect(service.validateSession(fixedSessionToken)).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
  });

  it('rejects disabled users during session validation', async () => {
    const user = createUser();
    const { service } = createService({ users: [user] });
    await service.login({ email: 'owner@local.dev', password: 'correct-password' });
    user.status = 'disabled';
    user.disabledAt = fixedNow;

    await expect(service.validateSession(fixedSessionToken)).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
  });

  it('rejects archived users during session validation', async () => {
    const archivedAt = new Date('2026-06-01T00:00:00.000Z');
    const user = createUser({ status: 'archived', archivedAt });
    const sessions = new FakeSessionRepository();
    sessions.sessions.push(createSession());
    const { service, audit } = createService({ users: [user], sessions });

    await expect(service.validateSession(fixedSessionToken)).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
    expect(sessions.sessions[0]?.revokedAt).toEqual(fixedNow);
    expect(audit.events[0]).toMatchObject({
      eventType: 'session_revoked',
      userId: user.id,
      reason: 'user_archived',
      metadata: { session_id: sessions.sessions[0]?.id },
    });
  });
});
