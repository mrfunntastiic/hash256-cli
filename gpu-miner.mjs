import { parentPort, workerData } from "worker_threads";
import { execSync, spawn } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { keccak_256 } from "@noble/hashes/sha3.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { challengeHex, difficultyHex } = workerData;

// ─── GPU Detection ───────────────────────────────────────
function hasNvidiaGPU() {
  try {
    execSync("nvidia-smi", { timeout: 3000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasROCmGPU() {
  try {
    execSync("rocm-smi", { timeout: 3000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ─── CPU Fallback (fast, same as worker.mjs) ─────────────
const buf = new Uint8Array(64);
const challenge = Uint8Array.from(
  challengeHex.slice(2).match(/.{2}/g),
  (s) => parseInt(s, 16)
);
buf.set(challenge, 0);

const diffBytes = Uint8Array.from(
  difficultyHex.slice(2).padStart(64, "0").match(/.{2}/g),
  (s) => parseInt(s, 16)
);

function writeNonceBE(nonce) {
  let n = nonce;
  for (let i = 63; i >= 32; i--) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
}

function lessThan(a, b) {
  for (let i = 0; i < 32; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

function cpuMine(startNonce, count) {
  let nonce = startNonce;
  const end = nonce + count;
  while (nonce < end) {
    writeNonceBE(nonce);
    const hash = keccak_256(buf);
    if (lessThan(hash, diffBytes)) {
      return { found: true, nonce: nonce.toString(), hash: Buffer.from(hash).toString("hex") };
    }
    nonce++;
  }
  return { found: false, checked: count.toString() };
}

// ─── GPU Mining via Python + CuPy (NVIDIA) ───────────────
async function gpuMineNvidia() {
  const gpuScript = path.join(__dirname, "gpu-keccak.py");

  // Check if Python GPU script exists
  try {
    const { accessSync } = await import("fs");
    accessSync(gpuScript);
  } catch {
    // No GPU script, fallback to CPU
    return null;
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [gpuScript, challengeHex, difficultyHex], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && stdout.includes("FOUND")) {
        try {
          const result = JSON.parse(stdout.trim().split("\n").pop());
          resolve(result);
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    proc.on("error", () => resolve(null));

    // Timeout after 60 seconds
    setTimeout(() => {
      proc.kill();
      resolve(null);
    }, 60000);
  });
}

// ─── Main GPU Worker Loop ────────────────────────────────
async function main() {
  const hasGPU = hasNvidiaGPU() || hasROCmGPU();

  if (!hasGPU) {
    // No GPU, run as fast CPU worker
    let nonce = BigInt(Math.floor(Math.random() * 2 ** 32));
    const BATCH = 500_000n;

    while (true) {
      const result = cpuMine(nonce, BATCH);
      if (result.found) {
        parentPort.postMessage(result);
        process.exit(0);
      }
      nonce += BATCH;
      parentPort.postMessage({ found: false, checked: BATCH.toString() });
    }
  }

  // Try GPU mining
  console.log("[GPU Worker] GPU detected, attempting GPU acceleration...");

  const gpuResult = await gpuMineNvidia();
  if (gpuResult && gpuResult.found) {
    parentPort.postMessage(gpuResult);
    process.exit(0);
  }

  // GPU mining not available or didn't find, fallback to CPU
  console.log("[GPU Worker] GPU kernel not available, falling back to CPU");

  let nonce = BigInt(Math.floor(Math.random() * 2 ** 32));
  const BATCH = 500_000n;

  while (true) {
    const result = cpuMine(nonce, BATCH);
    if (result.found) {
      parentPort.postMessage(result);
      process.exit(0);
    }
    nonce += BATCH;
    parentPort.postMessage({ found: false, checked: BATCH.toString() });
  }
}

main().catch((err) => {
  console.error("GPU Worker fatal:", err.message);
  process.exit(1);
});
