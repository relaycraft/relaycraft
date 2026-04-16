import { describe, expect, it } from "vitest";
import type { ToolCall } from "../../types/ai";
import { parseToolCallArgs } from "./toolArgs";

const makeToolCall = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: "call_1",
  type: "function",
  function: {
    name,
    arguments: JSON.stringify(args),
  },
});

describe("parseToolCallArgs", () => {
  it("parses valid generate_filter arguments", () => {
    const toolCall = makeToolCall("generate_filter", { filter: "status:500" });
    const parsed = parseToolCallArgs(toolCall, "generate_filter");

    expect(parsed).toEqual({ filter: "status:500" });
  });

  it("returns null when function name mismatches", () => {
    const toolCall = makeToolCall("generate_name", { name: "Foo" });
    const parsed = parseToolCallArgs(toolCall, "generate_filter");

    expect(parsed).toBeNull();
  });

  it("returns null when required fields are invalid", () => {
    const toolCall = makeToolCall("generate_script", { code: "   " });
    const parsed = parseToolCallArgs(toolCall, "generate_script");

    expect(parsed).toBeNull();
  });

  it("parses explain_rule message", () => {
    const toolCall = makeToolCall("explain_rule", { message: "无法生成规则，请补充条件" });
    const parsed = parseToolCallArgs(toolCall, "explain_rule");

    expect(parsed).toEqual({ message: "无法生成规则，请补充条件" });
  });
});
