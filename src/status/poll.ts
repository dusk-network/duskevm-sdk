import { sdkError } from "../errors.js";
import type { Abortable } from "../types.js";
import { isTerminalOperationPhase, type BridgeOperationStatus } from "./types.js";

export type PollOperationStatusOptions<TMetadata> = Abortable & {
  observe(): Promise<BridgeOperationStatus<TMetadata>>;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
};

export async function pollOperationStatus<TMetadata = unknown>(
  options: PollOperationStatusOptions<TMetadata>
): Promise<BridgeOperationStatus<TMetadata>> {
  const intervalMs = options.intervalMs ?? 1_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();
  let last: BridgeOperationStatus<TMetadata> | undefined;

  while (now() - startedAt <= timeoutMs) {
    throwIfAborted(options.signal);
    last = await options.observe();
    if (isTerminalOperationPhase(last.phase)) return last;
    await sleep(intervalMs, options.signal);
  }

  const timedOut: BridgeOperationStatus<TMetadata> = {
    phase: "timed_out",
    message: "Operation status polling timed out",
    updatedAt: now(),
  };
  if (last?.metadata !== undefined) timedOut.metadata = last.metadata;
  return timedOut;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(sdkError("TIMEOUT", "Operation aborted"));
      return;
    }

    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(sdkError("TIMEOUT", "Operation aborted"));
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw sdkError("TIMEOUT", "Operation aborted");
}
