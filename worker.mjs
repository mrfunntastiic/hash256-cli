import { parentPort, workerData } from "worker_threads";
import { keccak_256 } from "@noble/hashes/sha3.js";

const { challengeHex, difficultyHex, startNonce, batchSize } = workerData;

// Pre-allocate buffer: 32 bytes challenge + 32 bytes nonce = 64 bytes
const buf = new Uint8Array(64);
const challenge = Uint8Array.from(
  challengeHex.slice(2).match(/.{2}/g),
  (s) => parseInt(s, 16)
);
buf.set(challenge, 0);

// Difficulty as 32-byte big-endian for direct comparison
const diffBytes = Uint8Array.from(
  difficultyHex.slice(2).padStart(64, "0").match(/.{2}/g),
  (s) => parseInt(s, 16)
);

// Write nonce big-endian into buf[32..63]
function writeNonceBE(nonce) {
  let n = nonce;
  for (let i = 63; i >= 32; i--) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
}

// Compare two Uint8Arrays lexicographically (big-endian number comparison)
function lessThan(a, b) {
  for (let i = 0; i < 32; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

let nonce = BigInt(startNonce);
const end = nonce + BigInt(batchSize);
let checked = 0n;

while (nonce < end) {
  writeNonceBE(nonce);
  const hash = keccak_256(buf);

  if (lessThan(hash, diffBytes)) {
    parentPort.postMessage({
      found: true,
      nonce: nonce.toString(),
      hash: Buffer.from(hash).toString("hex"),
    });
    process.exit(0);
  }

  nonce++;
  checked++;
}

parentPort.postMessage({ found: false, checked: checked.toString() });
