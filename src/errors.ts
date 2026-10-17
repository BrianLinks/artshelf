/** An expected, business-level failure. The HTTP layer maps `code` to a status. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
