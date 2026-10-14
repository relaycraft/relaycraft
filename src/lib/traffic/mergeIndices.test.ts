import { describe, expect, it } from "vitest";
import type { FlowIndex } from "../../types";
import { mergeFlowIndices } from "./mergeIndices";

function row(id: string, msgTs: number, patch: Partial<FlowIndex> = {}): FlowIndex {
  return {
    id,
    msg_ts: msgTs,
    method: "GET",
    url: `https://example.com/${id}`,
    host: "example.com",
    path: `/${id}`,
    status: 200,
    httpVersion: "HTTP/1.1",
    contentType: "application/json",
    startedDateTime: "2026-01-01T00:00:00.000Z",
    time: 1,
    size: 10,
    hasError: false,
    hasRequestBody: false,
    hasResponseBody: true,
    isWebsocket: false,
    websocketFrameCount: 0,
    isIntercepted: false,
    hits: [],
    ...patch,
  };
}

describe("mergeFlowIndices", () => {
  it("appends newer rows without cloning the existing prefix", () => {
    const first = row("a", 1);
    const second = row("b", 2);
    const merged = mergeFlowIndices([first, second], [row("c", 3)], 50);

    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(merged[0]).toBe(first);
    expect(merged[1]).toBe(second);
  });

  it("returns the same array when a poll repeats rows that did not change", () => {
    const existing = [row("a", 1), row("b", 2)];
    expect(mergeFlowIndices(existing, [row("b", 2)], 50)).toBe(existing);
  });

  it("replaces an updated row in place when its timestamp stays put", () => {
    const first = row("a", 1);
    const second = row("b", 2, { status: 0 });
    const merged = mergeFlowIndices([first, second], [row("b", 2, { status: 200 })], 50);

    expect(merged[0]).toBe(first);
    expect(merged[1].status).toBe(200);
    expect(merged).toHaveLength(2);
  });

  it("reorders a row whose timestamp moved", () => {
    const merged = mergeFlowIndices([row("a", 1), row("b", 5)], [row("a", 9, { status: 204 })], 50);

    expect(merged.map((item) => item.id)).toEqual(["b", "a"]);
    expect(merged[1].status).toBe(204);
  });

  it("inserts an out-of-order row by timestamp", () => {
    const merged = mergeFlowIndices([row("a", 1), row("c", 3)], [row("b", 2)], 50);
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the newest window when the cap is exceeded", () => {
    const existing = [row("a", 1), row("b", 2)];
    const merged = mergeFlowIndices(existing, [row("c", 3), row("d", 4)], 3);
    expect(merged.map((item) => item.id)).toEqual(["b", "c", "d"]);
  });
});
