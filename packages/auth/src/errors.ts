export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor(message = 'Invalid email or password') {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}

export class InvalidSessionError extends AuthError {
  constructor(message = 'Invalid session') {
    super(message);
    this.name = 'InvalidSessionError';
  }
}

export class PasswordHashError extends AuthError {
  constructor(message = 'Invalid password hash') {
    super(message);
    this.name = 'PasswordHashError';
  }
}
