/**
 * Stack-agnostic business error thrown from services/domain.
 * Mapped to an HTTP response by DomainExceptionFilter. `code` is a stable
 * machine string the web client switches on (e.g. NATIONAL_ID_ALREADY_REGISTERED).
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
