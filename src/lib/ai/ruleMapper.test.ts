import { describe, expect, it, vi } from "vitest";
import { mapAIRuleToInternal } from "./ruleMapper";

// Isolate from the rule store chain; priority allocation is not under test
vi.mock("../../stores/ruleStore", () => ({
  getNextRulePriority: () => 99,
}));

describe("mapAIRuleToInternal (characterization)", () => {
  it("maps a strict V3 rule through unchanged in shape", () => {
    const result = mapAIRuleToInternal({
      name: "Block ads",
      type: "block_request",
      execution: { enabled: false, priority: 5, stopOnMatch: false },
      match: {
        request: [{ type: "url", matchType: "contains", value: "ads" }],
        response: [],
      },
      actions: [{ type: "block_request", statusCode: 403 } as any],
    });

    expect(result).toMatchObject({
      name: "Block ads",
      type: "block_request",
      execution: { enabled: false, priority: 5, stopOnMatch: false },
      match: { request: [{ type: "url", matchType: "contains", value: "ads" }] },
      metadata: { source: "ai_assistant" },
    });
    expect(result.actions).toHaveLength(1);
  });

  it("falls back to legacy flat execution fields and defaults", () => {
    const result = mapAIRuleToInternal({ enabled: false, priority: 7, stopOnMatch: false });

    expect(result.name).toBe("AI Suggested Rule");
    expect(result.type).toBe("block_request");
    expect(result.execution).toEqual({ enabled: false, priority: 7, stopOnMatch: false });
  });

  it("uses the store priority when none is provided", () => {
    const result = mapAIRuleToInternal({});
    expect(result.execution?.priority).toBe(99);
    expect(result.execution?.enabled).toBe(true);
    expect(result.execution?.stopOnMatch).toBe(true);
  });

  it("normalizes a bare match array and maps path/host atoms to url", () => {
    const result = mapAIRuleToInternal({
      match: [
        { type: "path", matchType: "regex", value: "^/api" },
        { type: "host", matchType: "exact", value: "example.com" },
      ] as any,
    });

    expect(result.match?.request).toEqual([
      { type: "url", matchType: "regex", value: "^/api" },
      { type: "url", matchType: "exact", value: "example.com" },
    ]);
  });

  it("normalizes legacy {request,response} match objects with alias fields", () => {
    const result = mapAIRuleToInternal({
      match: {
        request: [{ type: "url", match_type: "contains", pattern: "foo" }],
        response: [{ type: "header", mode: "exact", match: "bar", key: "x-a" }],
      } as any,
    });

    expect(result.match?.request[0]).toMatchObject({
      type: "url",
      matchType: "contains",
      value: "foo",
    });
    expect(result.match?.response[0]).toMatchObject({
      type: "header",
      matchType: "exact",
      value: "bar",
    });
  });

  it("converts a legacy flat {url, mode} match", () => {
    const result = mapAIRuleToInternal({ match: { url: "example.com", mode: "exact" } as any });

    expect(result.match?.request).toEqual([
      { type: "url", matchType: "exact", value: "example.com" },
    ]);
  });

  it("rewrites legacy V2 rewrite_body 'set' actions to the V3 shape", () => {
    const result = mapAIRuleToInternal({
      actions: [
        {
          type: "rewrite_body",
          rewriteType: "set",
          content: "{}",
          statusCode: 200,
          contentType: "application/json",
        } as any,
      ],
    });

    expect(result.actions?.[0]).toEqual({
      type: "rewrite_body",
      set: { content: "{}", statusCode: 200, contentType: "application/json" },
    });
  });

  it("rewrites legacy V2 rewrite_body 'replace' actions to the V3 shape", () => {
    const result = mapAIRuleToInternal({
      actions: [
        { type: "rewrite_body", rewriteType: "replace", pattern: "a", replacement: "b" } as any,
      ],
    });

    expect(result.actions?.[0]).toEqual({
      type: "rewrite_body",
      replace: { pattern: "a", replacement: "b" },
    });
  });

  it("leaves already-normalized rewrite_body actions untouched", () => {
    const result = mapAIRuleToInternal({
      actions: [
        {
          type: "rewrite_body",
          rewriteType: "set",
          set: { content: "x" },
          content: "stale",
        } as any,
      ],
    });

    expect(result.actions?.[0]).toMatchObject({ set: { content: "x" } });
  });

  it("supports the legacy single-action field", () => {
    const result = mapAIRuleToInternal({
      action: { type: "block_request", statusCode: 418 } as any,
    });

    expect(result.actions).toEqual([{ type: "block_request", statusCode: 418 }]);
  });

  it("handles a null rule defensively", () => {
    expect(mapAIRuleToInternal(null as any)).toMatchObject({ type: "block_request" });
  });
});
