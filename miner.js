"use strict";

require("dotenv").config();

const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");
const { ethers } = require("ethers");

// ------------------------------ config ------------------------------

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = "0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc";

// Number of CPU worker threads. Defaults to all logical cores.
// Override with THREADS=8 in .env to cap it.
const THREADS = (() => {
  const envT = parseInt(process.env.THREADS || "", 10);
  if (Number.isFinite(envT) && envT > 0) return envT;
  return os.cpus().length;
})();

// How often each worker reports its hashrate back to main (in hashes).
const REPORT_EVERY = parseInt(process.env.REPORT_EVERY || "500000", 10);

// Optional GPU backend. Off by default because a reliable GPU keccak256
// implementation requires a native addon (CUDA/OpenCL). When USE_GPU=1 we
// try to load ./gpu-backend.js; if it isn't present we fall back to CPU.
const USE_GPU = process.env.USE_GPU === "1";

const ABI = [
  "function getChallenge(address miner) view returns (bytes32)",
  "function miningState() view returns (uint256 era,uint256 reward,uint256 difficulty,uint256 minted,uint256 remaining,uint256 epoch,uint256 epochBlocksLeft_)",
  "function mine(uint256 nonce)"
];

// ------------------------------ helpers ------------------------------

function requireEnv() {
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error("Isi RPC_URL dan PRIVATE_KEY di file .env dulu.");
    console.error("Contoh: cp .env.example .env lalu edit PRIVATE_KEY.");
    process.exit(1);
  }
  if (!PRIVATE_KEY.startsWith("0x")) {
    console.error("PRIVATE_KEY harus diawali 0x.");
    process.exit(1);
  }
}

function randomStartNonce() {
  // 64-bit random start so different runs don't overlap.
  const hi = BigInt(Math.floor(Math.random() * 0xffffffff));
  const lo = BigInt(Math.floor(Math.random() * 0xffffffff));
  return (hi << 32n) | lo;
}

function difficultyToHex(difficulty) {
  // Pad to 32 bytes big-endian.
  let hex = BigInt(difficulty).toString(16);
  if (hex.length > 64) {
    throw new Error("difficulty does not fit in 32 bytes");
  }
  return hex.padStart(64, "0");
}

function formatHashrate(hps) {
  if (hps >= 1e9) return (hps / 1e9).toFixed(2) + " GH/s";
  if (hps >= 1e6) return (hps / 1e6).toFixed(2) + " MH/s";
  if (hps >= 1e3) return (hps / 1e3).toFixed(2) + " kH/s";
  return hps.toFixed(0) + " H/s";
}

// ------------------------------ mining round ------------------------------

function mineWithWorkers({ challengeHex, difficultyHex, threads }) {
  return new Promise((resolve, reject) => {
    const startNonce = randomStartNonce().toString();
    const workers = [];
    let settled = false;

    // Aggregate hashrate stats.
    let totalHashes = 0;
    let firstSampleAt = Date.now();
    let lastPrint = Date.now();

    function stopAll() {
      for (const w of workers) {
        try { w.postMessage({ type: "stop" }); } catch (_) {}
      }
      // Give workers a moment to exit cleanly, then terminate.
      setTimeout(() => {
        for (const w of workers) {
          try { w.terminate(); } catch (_) {}
        }
      }, 50);
    }

    for (let i = 0; i < threads; i++) {
      const worker = new Worker(path.join(__dirname, "worker.js"), {
        workerData: {
          workerId: i,
          totalWorkers: threads,
          challengeHex,
          difficultyHex,
          startNonce,
          reportEvery: REPORT_EVERY
        }
      });

      worker.on("message", (msg) => {
        if (settled) return;

        if (msg.type === "hashrate") {
          totalHashes += msg.hashes;
          const now = Date.now();
          if (now - lastPrint >= 2000) {
            const elapsed = (now - firstSampleAt) / 1000;
            const hps = totalHashes / Math.max(elapsed, 0.001);
            process.stdout.write(
              `\r[${threads} threads] ${formatHashrate(hps)}   total=${totalHashes}   `
            );
            lastPrint = now;
          }
        } else if (msg.type === "found") {
          settled = true;
          process.stdout.write("\n");
          stopAll();
          resolve({ nonce: msg.nonce, hash: msg.hash, workerId: msg.workerId });
        }
      });

      worker.on("error", (err) => {
        if (settled) return;
        settled = true;
        stopAll();
        reject(err);
      });

      worker.on("exit", (code) => {
        if (settled) return;
        if (code !== 0) {
          settled = true;
          stopAll();
          reject(new Error("worker " + i + " exited with code " + code));
        }
      });

      workers.push(worker);
    }
  });
}

// Optional GPU backend shim. If present, it must export:
//   async function mineGpu({ challengeHex, difficultyHex }) -> { nonce, hash }
function tryLoadGpuBackend() {
  if (!USE_GPU) return null;
  try {
    const mod = require("./gpu-backend");
    if (typeof mod.mineGpu === "function") {
      console.log("GPU backend loaded.");
      return mod;
    }
    console.warn("gpu-backend.js found but does not export mineGpu(). Falling back to CPU.");
    return null;
  } catch (err) {
    console.warn(
      "USE_GPU=1 tapi gpu-backend.js tidak tersedia (" +
        (err.code || err.message) +
        "). Fallback ke CPU."
    );
    return null;
  }
}

// ------------------------------ main ------------------------------

async function main() {
  requireEnv();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  const gpu = tryLoadGpuBackend();

  console.log("Wallet:    ", wallet.address);
  console.log("Contract:  ", CONTRACT_ADDRESS);
  console.log("Threads:   ", THREADS, "(logical cores:", os.cpus().length + ")");
  console.log("Total RAM: ", (os.totalmem() / 1024 / 1024 / 1024).toFixed(1) + " GB");
  console.log("Backend:   ", gpu ? "GPU" : "CPU (worker_threads + native keccak)");

  while (true) {
    const state = await contract.miningState();
    const difficulty = BigInt(state.difficulty.toString());
    const challenge = await contract.getChallenge(wallet.address);

    console.log("");
    console.log("Era:       ", state.era.toString());
    console.log("Reward:    ", ethers.formatUnits(state.reward, 18), "HASH");
    console.log("Difficulty:", difficulty.toString());
    console.log("Epoch:     ", state.epoch.toString());
    console.log("Challenge: ", challenge);

    const difficultyHex = difficultyToHex(difficulty);

    const t0 = Date.now();
    let result;
    try {
      if (gpu) {
        result = await gpu.mineGpu({
          challengeHex: challenge,
          difficultyHex
        });
      } else {
        result = await mineWithWorkers({
          challengeHex: challenge,
          difficultyHex,
          threads: THREADS
        });
      }
    } catch (err) {
      console.error("Mining error:", err.message || err);
      // brief pause, then retry with a fresh state
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const dt = (Date.now() - t0) / 1000;

    console.log("");
    console.log("FOUND nonce:", result.nonce, "(in", dt.toFixed(1) + "s", "by worker", result.workerId ?? "-", ")");
    console.log("Hash:       ", result.hash);

    try {
      const tx = await contract.mine(BigInt(result.nonce));
      console.log("TX sent:    ", tx.hash);
      const receipt = await tx.wait();
      console.log("Success block:", receipt.blockNumber);
    } catch (err) {
      console.error("TX failed:", err.shortMessage || err.message);
    }
  }
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
