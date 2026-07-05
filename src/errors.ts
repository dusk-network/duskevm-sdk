export type DuskEvmSdkErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_ENVELOPE"
  | "INVALID_OPERATION"
  | "TIMEOUT"
  | "TRANSACTION_FAILED"
  | "USER_REJECTED"
  | "UNSUPPORTED"
  | "CLIENT_ERROR";

export class DuskEvmSdkError extends Error {
  readonly code: DuskEvmSdkErrorCode;
  override readonly cause?: unknown;

  constructor(message: string, options: { code: DuskEvmSdkErrorCode; cause?: unknown }) {
    super(message);
    this.name = "DuskEvmSdkError";
    this.code = options.code;
    this.cause = options.cause;
  }
}

export function sdkError(
  code: DuskEvmSdkErrorCode,
  message: string,
  cause?: unknown
): DuskEvmSdkError {
  return new DuskEvmSdkError(message, { code, cause });
}

export function normalizeError(error: unknown, fallback = "DuskEVM SDK operation failed"): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.trim()) return new Error(error);
  return new Error(fallback);
}
