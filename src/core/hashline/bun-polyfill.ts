/**
 * Bun.hash polyfill for Node.js environments.
 *
 * @oh-my-pi/hashline uses Bun.hash.xxHash32 for content hashing in
 * computeFileHash(). This is called by InMemorySnapshotStore.record()
 * to generate 4-hex snapshot tags.
 *
 * In Node.js (our production runtime via ts-node/esm), the Bun global
 * does not exist. This module installs a compatible xxHash32 polyfill
 * so hashline works without Bun.
 *
 * IMPORTANT: This module MUST be imported before any @oh-my-pi/hashline
 * module that triggers Bun.hash access. It is imported first in
 * src/core/hashline/index.ts to guarantee ordering.
 */

const _globalThis = globalThis as Record<string, unknown>;

if (typeof _globalThis.Bun === "undefined") {
  _globalThis.Bun = {
    hash: { xxHash32: xxHash32 },
  };
}

// ── xxHash32 constants ────────────────────────────────

const PRIME32_1 = 0x9E3779B1;
const PRIME32_2 = 0x85EBCA77;
const PRIME32_3 = 0xC2B2AE3D;
const PRIME32_4 = 0x27D4EB2F;
const PRIME32_5 = 0x165667B1;

// ── xxHash32 implementation ────────────────────────────

/**
 * xxHash32 — fast 32-bit non-cryptographic hash by Yann Collet.
 * Compatible with Bun.hash.xxHash32(input, seed) for string and ArrayBuffer inputs.
 *
 * Reference: https://github.com/Cyan4973/xxHash/blob/dev/xxhash.c
 */
export function xxHash32(input: string | ArrayBuffer, seed: number): number {
  const data = typeof input === "string" ? Buffer.from(input, "utf-8") : Buffer.from(input);
  const len = data.length;
  const limit = len - 16;
  let h32: number;
  let pos: number;

  if (len >= 16) {
    let v1 = (seed + PRIME32_1 + PRIME32_2) | 0;
    let v2 = (seed + PRIME32_2) | 0;
    let v3 = seed | 0;
    let v4 = (seed - PRIME32_1) | 0;

    pos = 0;
    for (; pos <= limit; pos += 16) {
      v1 = round32(v1, data, pos);
      v2 = round32(v2, data, pos + 4);
      v3 = round32(v3, data, pos + 8);
      v4 = round32(v4, data, pos + 12);
    }

    h32 = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) | 0;
  } else {
    h32 = (seed + PRIME32_5) | 0;
    pos = 0;
  }

  h32 = (h32 + len) | 0;

  // Process remaining 4-byte groups
  for (; pos + 4 <= len; pos += 4) {
    h32 = (h32 + Math.imul(readU32LE(data, pos), PRIME32_3)) | 0;
    h32 = Math.imul(rotl(h32, 17), PRIME32_4) | 0;
  }

  // Process remaining bytes one at a time
  for (; pos < len; pos++) {
    h32 = (h32 + Math.imul(data[pos], PRIME32_5)) | 0;
    h32 = Math.imul(rotl(h32, 11), PRIME32_1) | 0;
  }

  // Avalanche
  h32 = (h32 ^ (h32 >>> 15)) | 0;
  h32 = Math.imul(h32, PRIME32_2) | 0;
  h32 = (h32 ^ (h32 >>> 13)) | 0;
  h32 = Math.imul(h32, PRIME32_3) | 0;
  h32 = (h32 ^ (h32 >>> 16)) | 0;

  return h32 >>> 0;
}

function round32(acc: number, buf: Buffer, offset: number): number {
  acc = (acc + Math.imul(readU32LE(buf, offset), PRIME32_2)) | 0;
  acc = rotl(acc, 13);
  return Math.imul(acc, PRIME32_1) | 0;
}

function rotl(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) | 0;
}

function readU32LE(buf: Buffer, offset: number): number {
  return (
    buf[offset] |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    (buf[offset + 3] << 24)
  ) >>> 0;
}