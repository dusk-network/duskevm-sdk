import { spawn } from "node:child_process";

export function parseCommandArgv(env, name, options = {}) {
  const raw = env[name];
  if (!raw) {
    if (options.optional) return undefined;
    throw new Error(`${name} is required`);
  }

  let argv;
  try {
    argv = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be a JSON array of non-empty strings`);
  }

  if (!isCommandArgv(argv)) {
    throw new Error(`${name} must be a JSON array of non-empty strings`);
  }

  return argv;
}

export async function runJsonCommandArgv(argv, input, options = {}) {
  const stdout = await runCommandArgv(
    argv,
    JSON.stringify(input, options.jsonReplacer)
  );
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout.trim();
  }
}

export function normalizeL1Receipt(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("L1 wait command returned an invalid receipt");
  }

  const hash = raw.transactionHash ?? raw.txHash ?? raw.hash;
  const transactionHash = normalizeTransactionHashString(hash);
  if (!transactionHash) {
    throw new Error("L1 wait command returned an invalid transaction hash");
  }
  if (typeof raw.success !== "boolean") {
    throw new Error("L1 wait command returned an invalid success flag");
  }

  const receipt = { transactionHash, raw };
  const blockHeight = normalizeOptionalBigint(raw.blockHeight ?? raw.height);
  if (blockHeight !== undefined) receipt.blockHeight = blockHeight;
  if (typeof raw.finalized === "boolean") receipt.finalized = raw.finalized;
  receipt.success = raw.success;
  return receipt;
}

export function normalizeL1TransactionHash(raw) {
  if (typeof raw === "string") {
    const hash = normalizeTransactionHashString(raw);
    if (hash) return hash;
  }
  if (raw && typeof raw === "object") {
    const hash = normalizeTransactionHashString(raw.transactionHash ?? raw.txHash ?? raw.hash);
    if (hash) return hash;
  }
  throw new Error("L1 submit command did not return a single transactionHash/hash/txHash");
}

export function runCommandArgv(argv, stdin) {
  if (!isCommandArgv(argv)) {
    return Promise.reject(new Error("command argv must be an array of non-empty strings"));
  }
  return new Promise((resolve, reject) => {
    const [file, ...args] = argv;
    const command = formatCommand(argv);
    const child = spawn(file, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      if (signal) {
        reject(new Error(`command failed (signal ${signal}): ${command}\n${stderr}`));
        return;
      }
      reject(new Error(`command failed (${code}): ${command}\n${stderr}`));
    });
    child.stdin.end(stdin);
  });
}

function isCommandArgv(argv) {
  return (
    Array.isArray(argv) &&
    argv.length > 0 &&
    argv.every((part) => typeof part === "string" && part.trim().length > 0)
  );
}

function normalizeOptionalBigint(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function normalizeTransactionHashString(value) {
  if (typeof value !== "string") return undefined;
  const hash = value.trim();
  if (hash.length === 0 || /\s/.test(hash)) return undefined;
  return hash;
}

function formatCommand(argv) {
  return argv.map((part) => JSON.stringify(part)).join(" ");
}
