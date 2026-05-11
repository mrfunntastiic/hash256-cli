"use strict";

// Quick throughput benchmark. Uses an *impossible* difficulty (0) so workers
// never find and we can measure pure hashrate for N seconds.

const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");

const BENCH_SECONDS = parseInt(process.argv[2] || "4", 10);
const threads = parseInt(process.env.THREADS || "", 10) || os.cpus().length;

const challengeHex = "0x" + "cd".repeat(32);
const difficultyHex = "00".repeat(32); // hash < 0 is impossible

const workers = [];
let totalHashes = 0;

for (let i = 0; i < threads; i++) {
  const w = new Worker(path.join(__dirname, "worker.js"), {
    workerData: {
      workerId: i,
      totalWorkers: threads,
      challengeHex,
      difficultyHex,
      startNonce: "0",
      reportEvery: 200000
    }
  });
  w.on("message", (msg) => {
    if (msg.type === "hashrate") totalHashes += msg.hashes;
  });
  workers.push(w);
}

const t0 = Date.now();
setTimeout(() => {
  const dt = (Date.now() - t0) / 1000;
  for (const w of workers) {
    try { w.postMessage({ type: "stop" }); } catch (_) {}
    try { w.terminate(); } catch (_) {}
  }
  const hps = totalHashes / dt;
  const fmt = hps >= 1e6 ? (hps / 1e6).toFixed(2) + " MH/s"
            : hps >= 1e3 ? (hps / 1e3).toFixed(2) + " kH/s"
            : hps.toFixed(0) + " H/s";
  console.log("threads:", threads, " total hashes:", totalHashes, " time:", dt.toFixed(2) + "s");
  console.log("rate:   ", fmt);
  process.exit(0);
}, BENCH_SECONDS * 1000);
