import { keccak256, sha256, getBytes, type BytesLike } from "ethers";
import type { OrderSettlementData } from "@ston-fi/omniston-sdk";

export function generateHtlcSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function generateHtlcHashlock(
  secret: Uint8Array,
  hashingFunction: OrderSettlementData["htlcHashingFunction"]
): Uint8Array {
  switch (hashingFunction) {
    case "HASHING_FUNCTION_KECCAK256":
      return getBytes(keccak256(secret as BytesLike));
    case "HASHING_FUNCTION_SHA256":
      return getBytes(sha256(secret as BytesLike));
    default:
      throw new Error(`Unsupported HTLC hashing function: ${hashingFunction ?? "unknown"}`);
  }
}
