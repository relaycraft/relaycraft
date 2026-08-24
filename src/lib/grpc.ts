import type { Flow, HarHeader, HarPostData } from "../types";
import { getHeaderValue } from "../types";

export const GRPC_STATUS_NAMES: Record<number, string> = {
  0: "OK",
  1: "CANCELLED",
  2: "UNKNOWN",
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND",
  6: "ALREADY_EXISTS",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  9: "FAILED_PRECONDITION",
  10: "ABORTED",
  11: "OUT_OF_RANGE",
  12: "UNIMPLEMENTED",
  13: "INTERNAL",
  14: "UNAVAILABLE",
  15: "DATA_LOSS",
  16: "UNAUTHENTICATED",
};

export function isGrpcMime(mime?: string | null): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase().split(";")[0].trim();
  return m === "application/grpc" || m.startsWith("application/grpc+");
}

export function isGrpcFlow(flow: Flow): boolean {
  const reqMime =
    flow.request.postData?.mimeType || getHeaderValue(flow.request.headers, "content-type");
  const resMime =
    flow.response.content?.mimeType || getHeaderValue(flow.response.headers, "content-type");
  if (isGrpcMime(reqMime) || isGrpcMime(resMime)) return true;
  const trailers = flow._rc?.trailers ?? [];
  return trailers.some((h) => h.name.toLowerCase() === "grpc-status");
}

export function parseGrpcPath(urlOrPath: string): { service: string; method: string } | null {
  try {
    const path = urlOrPath.includes("://") ? new URL(urlOrPath).pathname : urlOrPath;
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const service = parts[parts.length - 2];
    const method = parts[parts.length - 1];
    if (!(service && method)) return null;
    return { service, method };
  } catch {
    return null;
  }
}

/** Compact list title: method first, host second. Full package path stays in tooltip/detail. */
export function formatGrpcListTitle(urlOrPath: string, host?: string): string | null {
  const parsed = parseGrpcPath(urlOrPath);
  if (!parsed) return null;
  let hostname = (host || "").trim();
  if (!hostname && urlOrPath.includes("://")) {
    try {
      hostname = new URL(urlOrPath).host;
    } catch {
      hostname = "";
    }
  }
  return hostname ? `${parsed.method} · ${hostname}` : parsed.method;
}

export function getTrailerValue(
  trailers: HarHeader[] | undefined,
  name: string,
): string | undefined {
  if (!trailers?.length) return undefined;
  const lower = name.toLowerCase();
  return trailers.find((h) => h.name.toLowerCase() === lower)?.value;
}

export function getGrpcStatus(flow: Flow): { code: number; name: string; message: string } | null {
  const trailers = flow._rc?.trailers ?? [];
  const fromTrailers = getTrailerValue(trailers, "grpc-status");
  const fromHeaders = getHeaderValue(flow.response.headers, "grpc-status");
  const raw = fromTrailers ?? fromHeaders;
  if (raw == null || raw === "") return null;
  const code = Number.parseInt(raw, 10);
  if (Number.isNaN(code)) return null;
  return {
    code,
    name: GRPC_STATUS_NAMES[code] ?? `CODE_${code}`,
    message:
      getTrailerValue(trailers, "grpc-message") ||
      getHeaderValue(flow.response.headers, "grpc-message") ||
      "",
  };
}

export function bytesFromHarBody(text: string | undefined, encoding?: string): Uint8Array {
  if (!text) return new Uint8Array();
  if (encoding === "base64" || encoding === "base64url") {
    return base64ToBytes(text);
  }
  const trimmed = text.trim();
  if (looksLikeBase64(trimmed)) {
    try {
      const decoded = base64ToBytes(trimmed);
      if (looksLikeGrpcFrames(decoded)) return decoded;
    } catch {
      // fall through
    }
  }
  return new TextEncoder().encode(text);
}

export interface GrpcFrame {
  compressed: boolean;
  length: number;
  payload: Uint8Array;
  truncated: boolean;
}

export function parseGrpcFrames(data: Uint8Array): GrpcFrame[] {
  const frames: GrpcFrame[] = [];
  let offset = 0;
  while (offset < data.length) {
    if (offset + 5 > data.length) {
      frames.push({
        compressed: false,
        length: data.length - offset,
        payload: data.slice(offset),
        truncated: true,
      });
      break;
    }
    const compressed = data[offset] !== 0;
    const length = readUint32BE(data, offset + 1);
    offset += 5;
    if (offset + length > data.length) {
      frames.push({
        compressed,
        length,
        payload: data.slice(offset),
        truncated: true,
      });
      break;
    }
    frames.push({
      compressed,
      length,
      payload: data.slice(offset, offset + length),
      truncated: false,
    });
    offset += length;
  }
  return frames;
}

export function decodeProtobufHeuristic(data: Uint8Array, depth = 0): unknown {
  if (data.length === 0) return {};
  if (depth > 8) return bytesPreview(data);

  const result: Record<string, unknown> = {};
  let offset = 0;
  let fields = 0;

  while (offset < data.length) {
    const tagRead = readVarint(data, offset);
    if (!tagRead) return bytesPreview(data);
    const [tag, tagSize] = tagRead;
    offset += tagSize;
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (field <= 0 || wire > 5) return bytesPreview(data);

    let value: unknown;
    if (wire === 0) {
      const varint = readVarint(data, offset);
      if (!varint) return bytesPreview(data);
      value = varintToJson(varint[0]);
      offset += varint[1];
    } else if (wire === 1) {
      if (offset + 8 > data.length) return bytesPreview(data);
      value = { fixed64: bytesToHex(data.slice(offset, offset + 8)) };
      offset += 8;
    } else if (wire === 5) {
      if (offset + 4 > data.length) return bytesPreview(data);
      value = { fixed32: bytesToHex(data.slice(offset, offset + 4)) };
      offset += 4;
    } else if (wire === 2) {
      const lenRead = readVarint(data, offset);
      if (!lenRead) return bytesPreview(data);
      const len = Number(lenRead[0]);
      offset += lenRead[1];
      if (len < 0 || offset + len > data.length) return bytesPreview(data);
      const slice = data.slice(offset, offset + len);
      offset += len;
      value = decodeLengthDelimited(slice, depth);
    } else {
      return bytesPreview(data);
    }

    const key = String(field);
    if (key in result) {
      const existing = result[key];
      result[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      result[key] = value;
    }
    fields += 1;
    if (fields > 256) return bytesPreview(data);
  }

  return result;
}

export interface InspectedGrpcMessage {
  index: number;
  compressed: boolean;
  truncated: boolean;
  decoded: unknown;
}

export function inspectGrpcBody(
  text: string | undefined,
  encoding?: HarPostData["encoding"] | string,
): InspectedGrpcMessage[] {
  const bytes = bytesFromHarBody(text, encoding);
  if (bytes.length === 0) return [];
  return parseGrpcFrames(bytes).map((frame, index) => ({
    index,
    compressed: frame.compressed,
    truncated: frame.truncated,
    decoded: frame.compressed || frame.truncated ? null : decodeProtobufHeuristic(frame.payload),
  }));
}

function decodeLengthDelimited(slice: Uint8Array, depth: number): unknown {
  if (slice.length === 0) return "";
  if (looksLikeUtf8String(slice)) {
    return new TextDecoder("utf-8").decode(slice);
  }
  const nested = decodeProtobufHeuristic(slice, depth + 1);
  if (
    nested &&
    typeof nested === "object" &&
    !isBytesPreview(nested) &&
    Object.keys(nested).length > 0
  ) {
    return nested;
  }
  return bytesPreview(slice);
}

function looksLikeUtf8String(bytes: Uint8Array): boolean {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.length === 0) return false;
    for (const ch of text) {
      const c = ch.codePointAt(0) ?? 0;
      if (c === 9 || c === 10 || c === 13) continue;
      if (c < 32 || c === 127) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function looksLikeBase64(text: string): boolean {
  return text.length >= 8 && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}

function looksLikeGrpcFrames(data: Uint8Array): boolean {
  if (data.length < 5) return false;
  if (data[0] > 1) return false;
  const length = readUint32BE(data, 1);
  return length >= 0 && 5 + length <= data.length;
}

function readUint32BE(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  );
}

function readVarint(data: Uint8Array, offset: number): [bigint, number] | null {
  let result = 0n;
  let shift = 0n;
  let i = 0;
  while (offset + i < data.length && i < 10) {
    const byte = data[offset + i];
    result |= BigInt(byte & 0x7f) << shift;
    i += 1;
    if ((byte & 0x80) === 0) return [result, i];
    shift += 7n;
  }
  return null;
}

function varintToJson(value: bigint): number | string {
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return value.toString();
}

function base64ToBytes(text: string): Uint8Array {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(data: Uint8Array): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesPreview(data: Uint8Array): { $base64: string; $len: number } {
  let binary = "";
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return { $base64: btoa(binary), $len: data.length };
}

function isBytesPreview(value: unknown): boolean {
  return !!value && typeof value === "object" && "$base64" in (value as object);
}
