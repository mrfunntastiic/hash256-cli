# SUDAH ADA VERSI BARU OPTIMALISASI BISA KE https://github.com/mrfunntastiic/hash256-mine




# HASH256 CLI Miner with CPU

Kalo mau pake GPU bisa ke sini https://github.com/mrfunntastiic/hash256-cli-with-gpu

CLI miner untuk HASH256 dari `https://hash256.org/mine`.

Script ini mengambil challenge dari smart contract, mencari nonce yang memenuhi difficulty, lalu submit transaksi `mine(nonce)` ke Ethereum mainnet.

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

```bash
npm start
```

Contoh output:

```text
Wallet: 0x....
Contract: 0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc

Era: ...
Reward: ... HASH
Difficulty: ...
Epoch: ...
Challenge: 0x...
........
FOUND nonce: ...
Hash: 0x...
TX sent: 0x...
Success block: ...
```

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
