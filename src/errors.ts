/** Stable error codes emitted by SDK validation and orchestration helpers. */
export type DuskEvmSdkErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_ENVELOPE"
  | "INVALID_OPERATION"
  | "TIMEOUT"
  | "TRANSACTION_FAILED"
  | "USER_REJECTED"
  | "UNSUPPORTED"
  | "CLIENT_ERROR";

/** Error type carrying a stable SDK error code and optional cause. */
export class DuskEvmSdkError extends Error {
  /** Machine-readable SDK error category. */
  readonly code: DuskEvmSdkErrorCode;
  /** Original failure, when one is available. */
  override readonly cause?: unknown;

  /** Create an SDK error with a stable code. */
  constructor(message: string, options: { code: DuskEvmSdkErrorCode; cause?: unknown }) {
    super(message);
    this.name = "DuskEvmSdkError";
    this.code = options.code;
    this.cause = options.cause;
  }
}

/** Create a {@link DuskEvmSdkError}. */
export function sdkError(
  code: DuskEvmSdkErrorCode,
  message: string,
  cause?: unknown
): DuskEvmSdkError {
  return new DuskEvmSdkError(message, { code, cause });
}

/** Normalize an unknown thrown value to an `Error` instance. */
export function normalizeError(error: unknown, fallback = "DuskEVM SDK operation failed"): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.trim()) return new Error(error);
  return new Error(fallback);
}
