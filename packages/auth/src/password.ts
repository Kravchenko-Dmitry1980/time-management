import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { PasswordHashError } from './errors.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptParameters,
) => Promise<Buffer>;

const defaultScryptParameters = {
  N: 16_384,
  r: 8,
  p: 1,
  keyLength: 64,
  saltBytes: 16,
} as const;

interface ScryptParameters {
  N: number;
  r: number;
  p: number;
}

export interface HashPasswordOptions extends Partial<ScryptParameters> {
  keyLength?: number;
  saltBytes?: number;
  salt?: Buffer;
}

interface ParsedPasswordHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

export async function hashPassword(
  password: string,
  options: HashPasswordOptions = {},
): Promise<string> {
  const parameters = normalizeHashOptions(options);
  const salt = options.salt ?? randomBytes(parameters.saltBytes);

  if (salt.length === 0) {
    throw new PasswordHashError('Password hash salt must not be empty');
  }

  const derivedKey = await scryptAsync(password, salt, parameters.keyLength, {
    N: parameters.N,
    r: parameters.r,
    p: parameters.p,
  });

  return [
    'scrypt',
    'v=1',
    `N=${parameters.N}`,
    `r=${parameters.r}`,
    `p=${parameters.p}`,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(passwordHash);

  if (parsed === null) {
    return false;
  }

  const derivedKey = await scryptAsync(password, parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
  });

  if (derivedKey.length !== parsed.hash.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, parsed.hash);
}

function normalizeHashOptions(options: HashPasswordOptions) {
  const parameters = {
    N: options.N ?? defaultScryptParameters.N,
    r: options.r ?? defaultScryptParameters.r,
    p: options.p ?? defaultScryptParameters.p,
    keyLength: options.keyLength ?? defaultScryptParameters.keyLength,
    saltBytes: options.saltBytes ?? defaultScryptParameters.saltBytes,
  };

  if (!isValidScryptNumber(parameters.N) || !isPowerOfTwo(parameters.N)) {
    throw new PasswordHashError('scrypt N must be a positive power of two');
  }

  if (
    !isValidScryptNumber(parameters.r) ||
    !isValidScryptNumber(parameters.p) ||
    !isValidScryptNumber(parameters.keyLength) ||
    !isValidScryptNumber(parameters.saltBytes)
  ) {
    throw new PasswordHashError('scrypt parameters must be positive integers');
  }

  return parameters;
}

function parsePasswordHash(passwordHash: string): ParsedPasswordHash | null {
  const parts = passwordHash.split('$');

  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== 'v=1') {
    return null;
  }

  const N = parseTaggedInteger(parts[2], 'N');
  const r = parseTaggedInteger(parts[3], 'r');
  const p = parseTaggedInteger(parts[4], 'p');

  if (N === null || r === null || p === null || !isPowerOfTwo(N)) {
    return null;
  }

  const salt = decodeBase64Url(parts[5]);
  const hash = decodeBase64Url(parts[6]);

  if (salt === null || hash === null || salt.length === 0 || hash.length === 0) {
    return null;
  }

  return { N, r, p, salt, hash };
}

function parseTaggedInteger(value: string | undefined, tag: string): number | null {
  if (value === undefined || !value.startsWith(`${tag}=`)) {
    return null;
  }

  const numberValue = Number(value.slice(tag.length + 1));

  return isValidScryptNumber(numberValue) ? numberValue : null;
}

function decodeBase64Url(value: string | undefined): Buffer | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  try {
    return Buffer.from(value, 'base64url');
  } catch {
    return null;
  }
}

function isValidScryptNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isPowerOfTwo(value: number): boolean {
  return (value & (value - 1)) === 0;
}
