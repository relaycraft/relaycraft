import { describe, expect, it } from "vitest";
import type { Flow } from "../types";
import {
  decodeProtobufHeuristic,
  formatGrpcListTitle,
  getGrpcStatus,
  inspectGrpcBody,
  isGrpcMime,
  parseGrpcFrames,
  parseGrpcPath,
} from "./grpc";

function grpcFrame(payload: Uint8Array, compressed = false): Uint8Array {
  const header = new Uint8Array(5 + payload.length);
  header[0] = compressed ? 1 : 0;
  header[1] = (payload.length >>> 24) & 0xff;
  header[2] = (payload.length >>> 16) & 0xff;
  header[3] = (payload.length >>> 8) & 0xff;
  header[4] = payload.length & 0xff;
  header.set(payload, 5);
  return header;
}

function bytesToBase64(data: Uint8Array): string {
  let binary = "";
  for (const b of data) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe("grpc helpers", () => {
  it("detects native gRPC MIME and ignores grpc-web", () => {
    expect(isGrpcMime("application/grpc")).toBe(true);
    expect(isGrpcMime("application/grpc+proto; charset=utf-8")).toBe(true);
    expect(isGrpcMime("application/grpc-web")).toBe(false);
    expect(isGrpcMime("application/json")).toBe(false);
  });

  it("parses /package.Service/Method from URL", () => {
    expect(
      parseGrpcPath("https://speech.googleapis.com/google.cloud.speech.v1.Speech/Recognize"),
    ).toEqual({
      service: "google.cloud.speech.v1.Speech",
      method: "Recognize",
    });
  });

  it("formats list title as method · host", () => {
    expect(
      formatGrpcListTitle("https://speech.googleapis.com/google.cloud.speech.v1.Speech/Recognize"),
    ).toBe("Recognize · speech.googleapis.com");
    expect(formatGrpcListTitle("/grpc.demo.Greeter/SayHello", "www.cloudflare.com")).toBe(
      "SayHello · www.cloudflare.com",
    );
  });

  it("reads grpc-status from trailers", () => {
    const flow = {
      request: { headers: [] },
      response: { headers: [], content: {} },
      _rc: {
        trailers: [
          { name: "grpc-status", value: "7" },
          { name: "grpc-message", value: "denied" },
        ],
      },
    } as unknown as Flow;
    expect(getGrpcStatus(flow)).toEqual({
      code: 7,
      name: "PERMISSION_DENIED",
      message: "denied",
    });
  });

  it("splits length-prefixed frames and heuristically decodes protobuf strings", () => {
    const payload = new Uint8Array([
      0x0a,
      0x0a,
      ...Array.from(new TextEncoder().encode("relaycraft")),
    ]);
    const frames = parseGrpcFrames(grpcFrame(payload));
    expect(frames).toHaveLength(1);
    expect(frames[0].compressed).toBe(false);
    expect(decodeProtobufHeuristic(payload)).toEqual({ "1": "relaycraft" });
  });

  it("decodes base64 HAR bodies that omit encoding", () => {
    const framed = grpcFrame(new Uint8Array([0x0a, 0x00]));
    const messages = inspectGrpcBody(bytesToBase64(framed));
    expect(messages).toHaveLength(1);
    expect(messages[0].decoded).toEqual({ "1": "" });
  });

  it("keeps compressed frames undecoded", () => {
    const messages = inspectGrpcBody(
      bytesToBase64(grpcFrame(new Uint8Array([1, 2, 3]), true)),
      "base64",
    );
    expect(messages[0].compressed).toBe(true);
    expect(messages[0].decoded).toBeNull();
  });
});
