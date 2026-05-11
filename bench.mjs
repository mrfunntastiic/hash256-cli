import { keccak_256 } from "@noble/hashes/sha3.js";
import { ethers } from "ethers";
import { Worker } from "worker_threads";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const challenge = "0x" + "ab".repeat(32);
const nonce = 12345n;
const ITERATIONS = 100_000;

console.log("=== HASH256 Miner Benchmark ===");
console.log(`CPU: ${os.cpus()[0].model} (${os.cpus().length} cores)`);
console.log(`Iterations: ${ITERATIONS.toLocaleString()}`);
console.log("");

// ─── Benchmark 1: Original ethers.solidityPackedKeccak256 ─
console.log("── Method 1: ethers.solidityPackedKeccak256 (original) ─");
{
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const hash = ethers.solidityPackedKeccak256(
      ["bytes32", "uint256"],
      [challenge, nonce + BigInt(i)]
    );
    const hashNum = BigInt(hash);
  }
  const elapsed = performance.now() - start;
  const rate = Math.round(ITERATIONS / (elapsed / 1000));
  console.log(`  Time: ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  Rate: ${rate.toLocaleString()} h/s`);
}

// ─── Benchmark 2: @noble/hashes keccak256 + buffer ───────
console.log("");
console.log("── Method 2: @noble/hashes keccak256 + buffer (optimized) ─");
{
  const buf = new Uint8Array(64);
  const challengeBytes = Uint8Array.from(
    challenge.slice(2).match(/.{2}/g),
    (s) => parseInt(s, 16)
  );
  buf.set(challengeBytes, 0);

  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    let n = nonce + BigInt(i);
    for (let j = 63; j >= 32; j--) {
      buf[j] = Number(n & 0xffn);
      n >>= 8n;
    }
    const hash = keccak_256(buf);
  }
  const elapsed = performance.now() - start;
  const rate = Math.round(ITERATIONS / (elapsed / 1000));
  console.log(`  Time: ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  Rate: ${rate.toLocaleString()} h/s`);
}

// ─── Benchmark 3: Multi-threaded ─────────────────────────
console.log("");
console.log(`── Method 3: Multi-threaded (${os.cpus().length - 1} workers) ─`);
{
  const WORKERS = Math.max(1, os.cpus().length - 1);
  const BATCH = Math.floor(ITERATIONS / WORKERS);
  const difficultyHex = "0x" + "ff".repeat(32); // Easy difficulty for benchmark

  const start = performance.now();
  let done = 0;
  let totalChecked = 0;

  await new Promise((resolve) => {
    for (let i = 0; i < WORKERS; i++) {
      const worker = new Worker(path.join(__dirname, "worker.mjs"), {
        workerData: {
          challengeHex: challenge,
          difficultyHex: difficultyHex,
          startNonce: (nonce + BigInt(i * BATCH)).toString(),
          batchSize: BATCH.toString(),
        },
      });

      worker.on("message", (msg) => {
        totalChecked += Number(msg.checked || 0);
      });

      worker.on("exit", () => {
        done++;
        if (done === WORKERS) resolve();
      });
    }
  });

  const elapsed = performance.now() - start;
  const rate = Math.round(totalChecked / (elapsed / 1000));
  console.log(`  Time: ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  Rate: ${rate.toLocaleString()} h/s`);
}

// ─── Summary ─────────────────────────────────────────────
console.log("");
console.log("── Summary ─");
console.log("Optimized miner uses @noble/hashes + buffer packing + worker threads");
console.log("Expected speedup: 5-10x over original ethers-based miner");
console.log("GPU acceleration: auto-detected when NVIDIA GPU + CuPy available");
