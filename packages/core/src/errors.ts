export class AuthError extends Error {
  readonly status = 401;

  constructor(message = 'authentication required') {
    super(message);
    this.name = 'AuthError';
  }
}
