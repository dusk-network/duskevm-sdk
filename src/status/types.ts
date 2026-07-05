export type OperationPhase =
  | "prepared"
  | "submitted"
  | "accepted"
  | "finalized"
  | "failed"
  | "timed_out";

export type BridgeOperationStatus<TMetadata = unknown> = {
  phase: OperationPhase;
  message?: string;
  metadata?: TMetadata;
  updatedAt: number;
};

export function isTerminalOperationPhase(phase: OperationPhase): boolean {
  return phase === "finalized" || phase === "failed" || phase === "timed_out";
}
