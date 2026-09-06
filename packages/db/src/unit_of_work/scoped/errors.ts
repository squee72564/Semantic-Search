export class PersistenceUnavailableError extends Error {
  constructor(
    public readonly phase: "acquire" | "read" | "transaction",
    options?: ErrorOptions,
  ) {
    super(`Database ${phase} did not complete`, options);
    this.name = "PersistenceUnavailableError";
  }
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    "code" in error &&
    [
      "57014",
      "55P03",
      "53300",
      "57P01",
      "CONNECT_TIMEOUT",
      "CONNECTION_CLOSED",
      "CONNECTION_DESTROYED",
      "CONNECTION_ENDED",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EPIPE",
      "ENOTFOUND",
      "EAI_AGAIN",
    ].includes(String(error.code))
  )
    return true;
  return error.cause !== undefined && error.cause !== error && isDatabaseUnavailable(error.cause);
}
