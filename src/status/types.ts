/** Generic lifecycle phases shared by bridge operations. */
export type OperationPhase =
  | "prepared"
  | "submitted"
  | "accepted"
  | "finalized"
  | "failed"
  | "timed_out";

/** Timestamped operation status with optional caller-defined metadata. */
export type BridgeOperationStatus<TMetadata = unknown> = {
  phase: OperationPhase;
  message?: string;
  metadata?: TMetadata;
  updatedAt: number;
};

/** Return whether a phase will not transition again. */
export function isTerminalOperationPhase(phase: OperationPhase): boolean {
  return phase === "finalized" || phase === "failed" || phase === "timed_out";
}
