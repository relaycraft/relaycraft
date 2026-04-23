import { describe, expect, it, vi } from "vitest";
import { parseAIResponse } from "./parseAIResponse";

describe("parseAIResponse", () => {
  it("extracts rule from markdown json code block", () => {
    const input = `Here is result:\n\`\`\`json\n{"rule":{"name":"r1","type":"map_local"}}\n\`\`\``;
    const result = parseAIResponse(input, {
      parseYAML: vi.fn(),
    });

    expect(result.type).toBe("rule");
    if (result.type === "rule") {
      expect(result.ruleData).toMatchObject({ name: "r1", type: "map_local" });
    }
  });

  it("extracts plain message without requiring full json parse", () => {
    const input = `{"message":"hello\\nworld"}`;
    const result = parseAIResponse(input, {
      parseYAML: vi.fn(),
    });

    expect(result).toEqual({
      type: "message",
      message: "hello\nworld",
    });
  });

  it("recovers malformed json by cleanup", () => {
    const input = `{rule:{name:'r2',type:'map_remote',},}`;
    const result = parseAIResponse(input, {
      parseYAML: vi.fn(),
    });

    expect(result.type).toBe("rule");
    if (result.type === "rule") {
      expect(result.ruleData).toMatchObject({ name: "r2", type: "map_remote" });
    }
  });

  it("falls back to yaml parser when candidate contains yaml-style body", () => {
    const parseYAML = vi.fn().mockReturnValue({
      name: "yaml-rule",
      type: "rewrite_header",
    });
    const input = `{ name: yaml-rule, type: rewrite_header }`;
    const result = parseAIResponse(input, { parseYAML });

    expect(parseYAML).toHaveBeenCalledTimes(1);
    expect(result.type).toBe("rule");
    if (result.type === "rule") {
      expect(result.ruleData).toMatchObject({
        name: "yaml-rule",
        type: "rewrite_header",
      });
    }
  });

  it("returns parse error for invalid json-like response", () => {
    const input = `{"rule":{"name":"r3","type":}}`;
    const result = parseAIResponse(input, {
      parseYAML: vi.fn(),
    });

    expect(result.type).toBe("none");
    if (result.type === "none") {
      expect(result.parseError).toBeTruthy();
    }
  });
});
