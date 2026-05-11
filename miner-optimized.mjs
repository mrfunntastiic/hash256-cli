import { Worker } from "worker_threads";
import { ethers } from "ethers";
import { execSync } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = "0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc";
const GPU_ENABLED = process.env.GPU !== "0";

const ABI = [
  "function getChallenge(address miner) view returns (bytes32)",
  "function miningState() view returns (uint256 era,uint256 reward,uint256 difficulty,uint256 minted,uint256 remaining,uint256 epoch,uint256 epochBlocksLeft_)",
  "function mine(uint256 nonce)",
];

// ─── Hardware Detection ──────────────────────────────────
function detectCPU() {
  const cores = os.cpus().length;
  const model = os.cpus()[0]?.model || "unknown";
  return { cores, model };
}

function detectGPU() {
  try {
    const out = execSync("nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv,noheader 2>/dev/null", {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (out) {
      const gpus = out.split("\n").map((line) => {
        const [name, memory, computeCap] = line.split(",").map((s) => s.trim());
        return { name, memory, computeCap };
      });
      return gpus;
    }
  } catch {}

  // Check for AMD GPU via rocm-smi
  try {
    const out = execSync("rocm-smi --showproductname 2>/dev/null", {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (out && out.includes("Card")) {
      return [{ name: "AMD GPU (ROCm)", memory: "unknown", computeCap: "unknown" }];
    }
  } catch {}

  return [];
}

// ─── GPU Miner ───────────────────────────────────────────
let gpuProcess = null;

function startGPUWorker(challengeHex, difficultyHex) {
  const gpuScript = path.join(__dirname, "gpu-miner.mjs");
  const worker = new Worker(gpuScript, {
    workerData: { challengeHex, difficultyHex },
  });
  return worker;
}

// ─── CPU Workers ─────────────────────────────────────────
const cpu = detectCPU();
const gpu = detectGPU();
const WORKERS = Math.max(1, cpu.cores - 1); // Leave 1 core for main thread
const BATCH_SIZE = 500_000n;

let totalHashes = 0n;
let startTime = 0;
let activeWorkers = 0;
let found = false;

function spawnWorker(challengeHex, difficultyHex, startNonce) {
  const worker = new Worker(path.join(__dirname, "worker.mjs"), {
    workerData: {
      challengeHex,
      difficultyHex,
      startNonce: startNonce.toString(),
      batchSize: BATCH_SIZE.toString(),
    },
  });

  activeWorkers++;

  worker.on("message", (msg) => {
    if (msg.found) {
      found = true;
      console.log("");
      console.log(`FOUND nonce: ${msg.nonce}`);
      console.log(`Hash: 0x${msg.hash}`);
      resolveMine(BigInt(msg.nonce));
    } else {
      totalHashes += BigInt(msg.checked);
    }
  });

  worker.on("exit", () => {
    activeWorkers--;
  });

  worker.on("error", (err) => {
    console.error("Worker error:", err.message);
    activeWorkers--;
  });

  return worker;
}

// ─── Mining Logic ────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

let lastNonce = 0n;

function randomStartNonce() {
  return BigInt(Math.floor(Math.random() * 2 ** 32));
}

async function resolveMine(nonce) {
  try {
    const tx = await contract.mine(nonce);
    console.log("TX sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("Success block:", receipt.blockNumber);
  } catch (err) {
    console.error("TX failed:", err.shortMessage || err.message);
  }
}

function printStats() {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = Number(totalHashes) / elapsed;
  const unit = rate > 1_000_000 ? `${(rate / 1_000_000).toFixed(1)}M` : `${(rate / 1_000).toFixed(0)}K`;
  const gpuInfo = gpu.length > 0 ? ` | GPU: ${gpu[0].name}` : "";
  process.stdout.write(
    `\r[CPU ${cpu.cores}c] Workers: ${activeWorkers} | ${totalHashes.toLocaleString()} hashes | ${unit} h/s | ${(elapsed).toFixed(0)}s${gpuInfo}   `
  );
}

async function main() {
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error("Isi RPC_URL dan PRIVATE_KEY di file .env");
    process.exit(1);
  }

  console.log("=== HASH256 Optimized Miner ===");
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log("");
  console.log("── Hardware ──");
  console.log(`CPU: ${cpu.model} (${cpu.cores} cores)`);
  if (gpu.length > 0) {
    gpu.forEach((g, i) => console.log(`GPU ${i}: ${g.name} (${g.memory})`));
  } else {
    console.log("GPU: not detected");
  }
  console.log(`Workers: ${WORKERS} CPU${gpu.length > 0 ? " + GPU" : ""}`);
  console.log("");

  while (true) {
    const state = await contract.miningState();
    const difficulty = BigInt(state.difficulty.toString());
    const challenge = await contract.getChallenge(wallet.address);

    console.log("── New Round ──");
    console.log("Era:", state.era.toString());
    console.log("Reward:", ethers.formatUnits(state.reward, 18), "HASH");
    console.log("Difficulty:", difficulty.toString());
    console.log("Epoch:", state.epoch.toString());
    console.log("Challenge:", challenge);
    console.log("");

    const challengeHex = challenge;
    const difficultyHex = "0x" + difficulty.toString(16).padStart(64, "0");

    found = false;
    totalHashes = 0n;
    startTime = Date.now();

    // Start GPU worker if available
    let gpuWorker = null;
    if (gpu.length > 0 && GPU_ENABLED) {
      gpuWorker = startGPUWorker(challengeHex, difficultyHex);
      gpuWorker.on("message", (msg) => {
        if (msg.found && !found) {
          found = true;
          console.log("");
          console.log(`[GPU] FOUND nonce: ${msg.nonce}`);
          console.log(`Hash: 0x${msg.hash}`);
          resolveMine(BigInt(msg.nonce));
        }
      });
      gpuWorker.on("error", (err) => console.error("GPU worker error:", err.message));
    }

    // Spawn CPU workers
    let nextNonce = randomStartNonce();
    const workers = [];

    for (let i = 0; i < WORKERS; i++) {
      const w = spawnWorker(challengeHex, difficultyHex, nextNonce);
      workers.push(w);
      nextNonce += BATCH_SIZE;
    }

    // Stats timer
    const statsInterval = setInterval(printStats, 2000);

    // Refill workers as they finish
    const refill = setInterval(() => {
      if (found) {
        clearInterval(refill);
        return;
      }
      while (activeWorkers < WORKERS) {
        const w = spawnWorker(challengeHex, difficultyHex, nextNonce);
        workers.push(w);
        nextNonce += BATCH_SIZE;
      }
    }, 100);

    // Wait for found or all workers done
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (found) {
          clearInterval(check);
          clearInterval(refill);
          clearInterval(statsInterval);
          // Terminate all workers
          workers.forEach((w) => w.terminate().catch(() => {}));
          if (gpuWorker) gpuWorker.terminate().catch(() => {});
          resolve();
        }
      }, 200);
    });

    printStats();
    console.log("");
    console.log("Waiting 3s before next round...");
    await new Promise((r) => setTimeout(r, 3000));
  }
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
