"use strict";

// CPU hashing worker for HASH256.
// Each worker runs an independent tight loop, hashing keccak256(challenge || nonce)
// and checking against the difficulty target. Workers share nothing and are fed
// a disjoint nonce stride by the main thread.

const { parentPort, workerData } = require("worker_threads");
const { keccak256 } = require("js-sha3");

const {
  workerId,
  totalWorkers,
  challengeHex,
  difficultyHex, // 64-char hex (32 bytes), big-endian
  startNonce,    // string (BigInt serialized)
  reportEvery    // how many hashes between hashrate reports
} = workerData;

// ---------- pre-allocated buffers (no GC pressure in the hot loop) ----------

// Input layout (64 bytes total):
//   [0..31]   challenge (bytes32, immutable for this job)
//   [32..55]  zero (high 192 bits of uint256 nonce)
//   [56..63]  low 64 bits of nonce, big-endian (updated every iteration)
const input = Buffer.alloc(64);
const chBytes = Buffer.from(challengeHex.replace(/^0x/, ""), "hex");
if (chBytes.length !== 32) {
  throw new Error("challenge must be 32 bytes, got " + chBytes.length);
}
chBytes.copy(input, 0);

// Difficulty as a 32-byte big-endian buffer so we can do a raw Buffer.compare.
const difficultyBuf = Buffer.from(
  difficultyHex.replace(/^0x/, "").padStart(64, "0"),
  "hex"
);

// ---------- state ----------

let nonce = BigInt(startNonce) + BigInt(workerId);
const stride = BigInt(totalWorkers);
let stopped = false;

parentPort.on("message", (msg) => {
  if (msg && msg.type === "stop") stopped = true;
});

// ---------- hot loop ----------

let hashesSinceReport = 0;
let lastReport = Date.now();
const REPORT_EVERY = reportEvery > 0 ? reportEvery : 200000;

// Writing the low 64 bits only is enough as long as nonce fits in a uint64.
// 2^64 nonces per challenge is far beyond any realistic difficulty.
function writeNonce(buf, n) {
  // buf[56..63] = n big-endian
  buf.writeBigUInt64BE(n, 56);
}

// Reuse one keccak instance object? The native `keccak` module needs a fresh
// state per digest, so we allocate per iteration. It is still much faster
// than ethers' pure-JS keccak.
while (!stopped) {
  writeNonce(input, nonce);

  const hash = Buffer.from(keccak256.arrayBuffer(input));

  // hash < difficulty  <=>  Buffer.compare(hash, difficulty) < 0   (both 32-byte BE)
  if (Buffer.compare(hash, difficultyBuf) < 0) {
    parentPort.postMessage({
      type: "found",
      workerId,
      nonce: nonce.toString(),
      hash: "0x" + hash.toString("hex")
    });
    // Keep looping in case main thread wants us to continue; main will send stop.
    stopped = true;
    break;
  }

  nonce += stride;
  hashesSinceReport++;

  if (hashesSinceReport >= REPORT_EVERY) {
    const now = Date.now();
    parentPort.postMessage({
      type: "hashrate",
      workerId,
      hashes: hashesSinceReport,
      ms: now - lastReport
    });
    hashesSinceReport = 0;
    lastReport = now;
  }
}

parentPort.postMessage({ type: "stopped", workerId });
