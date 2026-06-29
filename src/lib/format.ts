import { PublicKey } from "@solana/web3.js";

export const SOL_DECIMALS = 1_000_000_000;

export function compactAddress(value: string | PublicKey | null | undefined): string {
  if (!value) return "n/a";
  const text = typeof value === "string" ? value : value.toBase58();
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value) || 0;
  if (typeof value === "object") {
    const maybe = value as { toNumber?: () => number; toString?: () => string };
    if (typeof maybe.toNumber === "function") return maybe.toNumber();
    if (typeof maybe.toString === "function") return Number(maybe.toString()) || 0;
  }
  return 0;
}

export function toBigInt(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.max(0, Math.floor(value)));
  if (typeof value === "string") return BigInt(value || "0");
  if (typeof value === "object") {
    const maybe = value as { toString?: () => string };
    if (typeof maybe.toString === "function") return BigInt(maybe.toString());
  }
  return 0n;
}

export function lamportsToSol(value: unknown): number {
  return toNumber(value) / SOL_DECIMALS;
}

export function formatSol(value: unknown): string {
  const sol = lamportsToSol(value);
  if (sol === 0) return "0 SOL";
  if (sol < 0.001) return "<0.001 SOL";
  return `${sol.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL`;
}

export function formatNumber(value: number | bigint | unknown): string {
  return toNumber(value).toLocaleString();
}

export function formatScore(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function formatDate(value: unknown): string {
  const seconds = toNumber(value);
  if (!seconds) return "n/a";
  return new Date(seconds * 1000).toLocaleString();
}

export function bytesToLabel(value: unknown, fallback = "Unnamed"): string {
  const bytes = Array.isArray(value)
    ? value
    : value instanceof Uint8Array
      ? [...value]
      : [];
  const text = bytes
    .filter((byte) => byte !== 0)
    .map((byte) => String.fromCharCode(byte))
    .join("")
    .trim();
  return text || fallback;
}

export function enumLabel(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const key = Object.keys(value as Record<string, unknown>)[0];
    if (key) return key.replace(/([A-Z])/g, " $1").trim();
  }
  return "unknown";
}

export function asBase58(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof PublicKey) return value.toBase58();
  const maybe = value as { toBase58?: () => string; toString?: () => string };
  if (typeof maybe.toBase58 === "function") return maybe.toBase58();
  if (typeof maybe.toString === "function") return maybe.toString();
  return "";
}
