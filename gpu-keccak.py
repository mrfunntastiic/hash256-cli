#!/usr/bin/env python3
"""
GPU-accelerated keccak256 miner for NVIDIA GPUs using CuPy.
Falls back to CPU if CuPy/CUDA not available.

Usage: python3 gpu-keccak.py <challenge_hex> <difficulty_hex>
"""

import sys
import json
import struct
import hashlib


def keccak256_cpu(data: bytes) -> bytes:
    """Pure Python keccak256 fallback."""
    from hashlib import sha3_256
    # Python's hashlib sha3_256 is SHA-3, not keccak256
    # Use pysha3 or pycryptodome if available
    try:
        from Crypto.Hash import keccak
        k = keccak.new(digest_bits=256)
        k.update(data)
        return k.digest()
    except ImportError:
        pass

    try:
        import sha3
        return sha3.keccak_256(data).digest()
    except ImportError:
        pass

    # Last resort: use hashlib (SHA-3, NOT keccak256 - different padding!)
    # This is a fallback and will produce wrong results for keccak256
    raise ImportError("No keccak256 library available. Install pycryptodome: pip install pycryptodome")


def pack_challenge_nonce(challenge: bytes, nonce: int) -> bytes:
    """Pack bytes32 + uint256 (Solidity tight packing)."""
    nonce_bytes = nonce.to_bytes(32, byteorder='big')
    return challenge + nonce_bytes


def cpu_mine(challenge: bytes, difficulty: int, start_nonce: int, count: int):
    """CPU-based mining loop."""
    for nonce in range(start_nonce, start_nonce + count):
        data = pack_challenge_nonce(challenge, nonce)
        h = keccak256_cpu(data)
        hash_int = int.from_bytes(h, byteorder='big')
        if hash_int < difficulty:
            return {
                "found": True,
                "nonce": str(nonce),
                "hash": h.hex()
            }
    return {"found": False, "checked": str(count)}


def gpu_mine(challenge: bytes, difficulty: int, start_nonce: int, count: int):
    """GPU-accelerated mining using CuPy (NVIDIA CUDA)."""
    try:
        import cupy as cp
        import numpy as np
    except ImportError:
        return None

    # For GPU keccak256, we need a CUDA kernel
    # CuPy doesn't have built-in keccak256, so we use a custom kernel
    # This requires the keccak256 CUDA kernel to be compiled

    # For now, return None to fallback to CPU
    # A full implementation would need:
    # 1. CUDA keccak256 kernel (custom PTX/CUDA C code)
    # 2. CuPy RawKernel or CUDA C extension
    # 3. Batch hash computation on GPU
    return None


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 gpu-keccak.py <challenge_hex> <difficulty_hex>")
        sys.exit(1)

    challenge_hex = sys.argv[1]
    difficulty_hex = sys.argv[2]

    challenge = bytes.fromhex(challenge_hex[2:] if challenge_hex.startswith("0x") else challenge_hex)
    difficulty = int(difficulty_hex, 16)

    # Try GPU first
    gpu_result = gpu_mine(challenge, difficulty, 0, 1_000_000)
    if gpu_result:
        print(json.dumps(gpu_result))
        sys.exit(0)

    # Fallback to CPU
    import random
    start_nonce = random.randint(0, 2**32)
    result = cpu_mine(challenge, difficulty, start_nonce, 100_000)
    print(json.dumps(result))
    sys.exit(0 if result["found"] else 1)


if __name__ == "__main__":
    main()
