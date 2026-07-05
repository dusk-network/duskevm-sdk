import { describe, expect, it } from "vitest";
import {
  normalizeL1Receipt,
  normalizeL1TransactionHash,
  parseCommandArgv,
  runCommandArgv,
  runJsonCommandArgv,
} from "./local-smoke-command.mjs";

describe("local smoke command helper", () => {
  it("parses explicit JSON argv", () => {
    expect(
      parseCommandArgv(
        { SDK_SMOKE_L1_SUBMIT_ARGV: '["node","./submit.mjs"]' },
        "SDK_SMOKE_L1_SUBMIT_ARGV"
      )
    ).toEqual(["node", "./submit.mjs"]);
  });

  it("rejects opaque shell command strings", () => {
    expect(() =>
      parseCommandArgv(
        { SDK_SMOKE_L1_SUBMIT_ARGV: "node ./submit.mjs" },
        "SDK_SMOKE_L1_SUBMIT_ARGV"
      )
    ).toThrow(/JSON array/);
  });

  it("rejects empty argv parts", () => {
    expect(() =>
      parseCommandArgv(
        { SDK_SMOKE_L1_SUBMIT_ARGV: '["node",""]' },
        "SDK_SMOKE_L1_SUBMIT_ARGV"
      )
    ).toThrow(/non-empty strings/);
    expect(() =>
      parseCommandArgv(
        { SDK_SMOKE_L1_SUBMIT_ARGV: '["node","   "]' },
        "SDK_SMOKE_L1_SUBMIT_ARGV"
      )
    ).toThrow(/non-empty strings/);
  });

  it("passes shell metacharacters as inert argv data", async () => {
    const payload = "literal;touch /tmp/duskevm-sdk-command-injection";
    const raw = await runJsonCommandArgv(
      [
        "node",
        "-e",
        "let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({input,argv:process.argv.slice(1)})))",
        payload,
      ],
      { ok: true }
    );

    expect(raw).toEqual({
      input: '{"ok":true}',
      argv: [payload],
    });
  });

  it("normalizes wait-command receipt fields", () => {
    const raw = {
      txHash: " tx-2 ",
      height: "123",
      finalized: true,
      success: true,
    };

    expect(normalizeL1Receipt(raw)).toEqual({
      transactionHash: "tx-2",
      blockHeight: 123n,
      finalized: true,
      success: true,
      raw,
    });
  });

  it("rejects invalid wait-command receipt hashes", () => {
    expect(() => normalizeL1Receipt({ transactionHash: "" })).toThrow(/invalid/);
    expect(() => normalizeL1Receipt({ transactionHash: "log line\ntx-1", success: true })).toThrow(
      /invalid/
    );
    expect(() => normalizeL1Receipt({ success: true })).toThrow(/invalid/);
    expect(() => normalizeL1Receipt({ transactionHash: "tx-1" })).toThrow(/success flag/);
    expect(() => normalizeL1Receipt("tx-1")).toThrow(/invalid/);
    expect(() => normalizeL1Receipt(123)).toThrow(/invalid/);
  });

  it("normalizes submit-command transaction hashes", () => {
    expect(normalizeL1TransactionHash(" tx-1 ")).toBe("tx-1");
    expect(normalizeL1TransactionHash({ hash: "tx-2" })).toBe("tx-2");
    expect(() => normalizeL1TransactionHash("log line\ntx-1")).toThrow(/single transactionHash/);
    expect(() => normalizeL1TransactionHash({ transactionHash: "tx 1" })).toThrow(
      /single transactionHash/
    );
  });

  it("reports command termination signals", async () => {
    await expect(
      runCommandArgv(["node", "-e", "process.kill(process.pid, 'SIGTERM')"], "")
    ).rejects.toThrow(/signal SIGTERM.*"node" "-e"/s);
  });

  it("reports full argv for non-zero command exits", async () => {
    await expect(
      runCommandArgv(["node", "-e", "console.error('bad'); process.exit(7)"], "")
    ).rejects.toThrow(/command failed \(7\): "node" "-e"/);
  });

  it("rejects invalid argv passed directly to the command runner", async () => {
    await expect(runCommandArgv([], "")).rejects.toThrow(/array of non-empty strings/);
    await expect(runCommandArgv([""], "")).rejects.toThrow(/array of non-empty strings/);
    await expect(runCommandArgv(["   "], "")).rejects.toThrow(/array of non-empty strings/);
  });
});
