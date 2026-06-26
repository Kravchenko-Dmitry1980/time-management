export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type AuthUserStatus = 'active' | 'invited' | 'disabled' | 'archived';

export type AuthAuditEventType =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'session_validated'
  | 'session_revoked';

export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  name: string;
  status: AuthUserStatus;
  disabledAt: Date | null;
  archivedAt: Date | null;
}

export interface SafeAuthUser {
  id: string;
  email: string;
  name: string;
  status: AuthUserRecord['status'];
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface LoginSuccess {
  user: SafeAuthUser;
  session: AuthSessionRecord;
  sessionToken: string;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WriteAuthAuditEventInput {
  id: string;
  userId: string | null;
  emailNormalized: string | null;
  eventType: AuthAuditEventType;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: JsonValue | null;
  retentionUntil: Date | null;
  createdAt: Date;
}

export interface AuthUserRepository {
  findByEmail(emailNormalized: string): Promise<AuthUserRecord | null>;
  findById(userId: string): Promise<AuthUserRecord | null>;
}

export interface AuthSessionRepository {
  createSession(input: CreateSessionInput): Promise<AuthSessionRecord>;
  findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthSessionRecord | null>;
  revokeByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
  touch(sessionId: string, lastUsedAt: Date): Promise<void>;
}

export interface AuthAuditWriter {
  writeAuthAuditEvent(input: WriteAuthAuditEventInput): Promise<void>;
}

export interface AuthServiceDependencies {
  userRepository: AuthUserRepository;
  sessionRepository: AuthSessionRepository;
  auditWriter: AuthAuditWriter;
  passwordVerifier?: (password: string, passwordHash: string) => Promise<boolean>;
  sessionTokenGenerator?: () => string;
  sessionTokenHasher?: (sessionToken: string) => string;
  idGenerator?: () => string;
  now?: () => Date;
  sessionTtlMs?: number;
}
