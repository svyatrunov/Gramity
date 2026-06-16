import { getSecureRandomBytes, sha256 } from "@ton/crypto";
import { Address, Cell, contractAddress, loadStateInit } from "@ton/ton";
import { sign } from "tweetnacl";
import { TON_API_URL } from "../config.js";
import { tryParsePublicKey } from "./walletsData.js";

const TON_PROOF_PREFIX = "ton-proof-item-v2/";
const TON_CONNECT_PREFIX = "ton-connect";
const PROOF_MAX_AGE_SEC = 300;

export interface TonProofDomain {
  lengthBytes: number;
  value: string;
}

export interface TonProofBody {
  timestamp: number;
  domain: TonProofDomain;
  signature: string;
  payload: string;
  state_init?: string;
}

export interface TonProofVerifyInput {
  address: string;
  public_key: string;
  proof: TonProofBody;
  expectedPayload: string;
  expectedDomain: string;
}

export async function generateTonProofPayload(): Promise<string> {
  const bytes = await getSecureRandomBytes(32);
  return Buffer.from(bytes).toString("hex");
}

async function fetchWalletPublicKey(address: string): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `${TON_API_URL}/accounts/${encodeURIComponent(address)}/publickey`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { public_key?: string };
    if (!data.public_key) return null;
    return Buffer.from(data.public_key, "hex");
  } catch {
    return null;
  }
}

export async function verifyTonProof(input: TonProofVerifyInput): Promise<boolean> {
  try {
    if (input.proof.payload !== input.expectedPayload) return false;

    const now = Math.floor(Date.now() / 1000);
    if (now - input.proof.timestamp > PROOF_MAX_AGE_SEC) return false;

    if (input.proof.domain.value !== input.expectedDomain) return false;

    const stateInitB64 = input.proof.state_init;
    if (!stateInitB64) return false;

    const stateInit = loadStateInit(Cell.fromBase64(stateInitB64).beginParse());

    let publicKey =
      tryParsePublicKey(stateInit) ?? (await fetchWalletPublicKey(input.address));
    if (!publicKey) return false;

    const wantedPublicKey = Buffer.from(input.public_key, "hex");
    if (!publicKey.equals(wantedPublicKey)) return false;

    const wantedAddress = Address.parse(input.address);
    const address = contractAddress(wantedAddress.workChain, stateInit);
    if (!address.equals(wantedAddress)) return false;

    const wc = Buffer.alloc(4);
    wc.writeUInt32BE(address.workChain, 0);

    const ts = Buffer.alloc(8);
    ts.writeBigUInt64LE(BigInt(input.proof.timestamp), 0);

    const dl = Buffer.alloc(4);
    dl.writeUInt32LE(input.proof.domain.lengthBytes, 0);

    const msg = Buffer.concat([
      Buffer.from(TON_PROOF_PREFIX),
      wc,
      address.hash,
      dl,
      Buffer.from(input.proof.domain.value),
      ts,
      Buffer.from(input.proof.payload),
    ]);

    const msgHash = Buffer.from(await sha256(msg));
    const fullMsg = Buffer.concat([
      Buffer.from([0xff, 0xff]),
      Buffer.from(TON_CONNECT_PREFIX),
      msgHash,
    ]);
    const result = Buffer.from(await sha256(fullMsg));
    const signature = Buffer.from(input.proof.signature, "base64");

    return sign.detached.verify(result, signature, publicKey);
  } catch {
    return false;
  }
}
