# HASH256 CLI Miner

CLI miner untuk HASH256 dari `https://hash256.org/mine`.

Script ini mengambil challenge dari smart contract, mencari nonce yang memenuhi difficulty, lalu submit transaksi `mine(nonce)` ke Ethereum mainnet.

Versi ini:
- **Multi-core** — pakai `worker_threads`, satu worker per logical CPU core. Tiap worker dapat stride nonce yang berbeda (worker `i` coba nonce `i, i+N, i+2N, ...`) jadi tidak ada bentrok.
- **Keccak cepat** — pakai `js-sha3` langsung di hot-loop, lebih cepat dibanding `ethers.solidityPackedKeccak256` yang mem-parse ABI tiap iterasi.
- **Alokasi nol** di loop hash — buffer 64-byte dialokasikan sekali, cuma 8 byte terakhir (low-64-bit nonce) ditulis ulang tiap iterasi. Tidak ada GC pressure.
- **Perbandingan difficulty lewat `Buffer.compare`** — tidak perlu konversi `BigInt` tiap hash.
- **RAM** — workload ini CPU-bound, bukan RAM-bound. Tapi kalau kamu mau heap lebih besar (misal node RPC caching, log buffer, dll) pakai script `npm run start:max` yang sudah set `--max-old-space-size=8192`.
- **GPU (opsional)** — ada hook `USE_GPU=1` yang akan coba load `./gpu-backend.js` custom. File itu tidak disediakan karena keccak256 GPU yang benar butuh kernel CUDA/OpenCL native; kalau tidak ada backend-nya, otomatis fallback ke CPU.

## Peringatan

- Mining ini memakai Ethereum mainnet.
- Wallet harus punya ETH untuk gas.
- Jangan pakai private key wallet utama. Lebih aman pakai wallet baru khusus mining.
- Jangan commit file `.env`.
- Verifikasi sendiri alamat kontrak sebelum mengirim transaksi: `https://etherscan.io/address/0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc`.

## Kebutuhan

- Ubuntu/VPS
- Node.js 18 atau lebih baru
- npm
- Wallet Ethereum
- Private key wallet
- ETH untuk gas
- RPC Ethereum mainnet

## Install Node.js dan npm

Kalau memakai user biasa Ubuntu:

```bash
cd ~

sudo apt update
sudo apt install -y curl ca-certificates gnupg

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

node -v
npm -v
```

Kalau login sebagai root:

```bash
cd ~

apt update
apt install -y curl ca-certificates gnupg

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

node -v
npm -v
```

## Setup Project

```bash
git clone https://github.com/mrfunntastiic/hash256-cli
cd hash256-cli

npm install
cp .env.example .env
nano .env
```

Isi `.env`:

```env
RPC_URL=https://ethereum-rpc.publicnode.com
PRIVATE_KEY=0xPRIVATE_KEY_WALLET_KAMU

# opsional:
# THREADS=8             # default: semua logical core
# REPORT_EVERY=500000   # hashes per laporan hashrate
# USE_GPU=1             # butuh ./gpu-backend.js custom (CUDA/OpenCL native addon)
```

Simpan di nano:

```text
CTRL + X
Y
Enter
```

## Cek State Kontrak

```bash
npm run check
```

Output akan menampilkan `genesisState` dan `miningState`.

## Jalankan Miner

Default (semua core, heap default):

```bash
npm start
```

Pakai heap besar (8 GB) — berguna kalau RAM besar dan kamu pakai RPC/logging yang rakus memori:

```bash
npm run start:max
```

Batasi jumlah thread (misal sisakan 2 core buat OS):

```bash
THREADS=6 npm start
```

Benchmark hashrate murni (tanpa kirim TX):

```bash
npm run bench           # pakai semua core, 5 detik
THREADS=1 node bench.js 5
```

Contoh output miner:

```text
Wallet:     0x....
Contract:   0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc
Threads:    16 (logical cores: 16)
Total RAM:  32.0 GB
Backend:    CPU (worker_threads + js-sha3)

Era:        ...
Reward:     ... HASH
Difficulty: ...
Epoch:      ...
Challenge:  0x...
[16 threads] 12.34 MH/s   total=987654321

FOUND nonce: ... (in 42.1s by worker 7)
Hash:        0x...
TX sent:     0x...
Success block: ...
```

## GPU (opsional, advanced)

`USE_GPU=1` hanya aktif kalau kamu menyediakan `./gpu-backend.js` sendiri yang meng-export:

```js
// gpu-backend.js
exports.mineGpu = async function ({ challengeHex, difficultyHex }) {
  // jalankan keccak256(challenge || nonce) di GPU lewat native addon / node-cuda / node-opencl
  // kembalikan { nonce: "<string>", hash: "0x..." } saat ketemu
};
```

Kenapa tidak di-bundle? Keccak256 yang benar di GPU butuh kernel CUDA/OpenCL, dan kalau implementasinya salah kamu akan submit nonce invalid → transaksi revert → gas terbuang. Kalau kamu tidak punya backend-nya, biarkan `USE_GPU` kosong; miner CPU di atas sudah cukup kencang.

## Error Umum

### `npm: command not found`

Node.js/npm belum terinstall.

```bash
sudo apt update
sudo apt install -y nodejs npm
```

Atau pakai NodeSource seperti instruksi install di atas.

### Permission denied saat `apt update`

Kamu bukan root.

```bash
sudo apt update
sudo apt install -y nodejs npm
```

### `Isi RPC_URL dan PRIVATE_KEY di file .env dulu`

File `.env` belum dibuat atau isinya belum benar.

```bash
cat .env
```

Harus ada:

```env
RPC_URL=...
PRIVATE_KEY=...
```

### `insufficient funds`

Wallet tidak punya ETH untuk gas. Isi ETH dulu ke wallet tersebut.

### `execution reverted`

Kemungkinan mining belum aktif, nonce tidak valid, atau state kontrak berubah. Jalankan ulang miner atau cek state kontrak.

### `InsufficientWork`

Nonce yang ditemukan tidak memenuhi difficulty saat transaksi diproses. Jalankan ulang miner.

### `GenesisNotComplete`

Mining belum dibuka oleh kontrak. Tunggu sampai genesis selesai.
