import { describe, expect, it, vi } from "vitest";

const aiSettings = {
  provider: "openai",
  model: "gpt-4o-mini",
};

vi.mock("../../stores/aiStore", () => ({
  useAIStore: {
    getState: () => ({
      settings: aiSettings,
    }),
  },
}));

vi.mock("../logger", () => ({
  Logger: {
    info: vi.fn(),
  },
}));

import { formatAIToolMetricsReport, trackAIToolPath } from "./metrics";

describe("ai metrics report", () => {
  it("includes top fallback reasons in local report", () => {
    aiSettings.provider = "openai";
    aiSettings.model = "gpt-4o-mini";
    trackAIToolPath({
      feature: "command_dispatch",
      outcome: "tool_error",
      detail: "schema_mismatch",
    });
    trackAIToolPath({
      feature: "command_dispatch",
      outcome: "fallback_json",
      detail: "schema_mismatch",
    });
    trackAIToolPath({
      feature: "command_dispatch",
      outcome: "fallback_json",
      detail: "json_parse_failed",
    });
    aiSettings.provider = "anthropic";
    aiSettings.model = "claude-3-5-sonnet";
    trackAIToolPath({
      feature: "assistant_regex_generate",
      outcome: "fallback_stream",
      detail: "tool_timeout",
    });

    const report = formatAIToolMetricsReport();
    expect(report).toContain("By provider/model/feature:");
    expect(report).toContain("Top fallback reasons (recent");
    expect(report).toContain("Top fallback reasons by provider/model:");
    expect(report).toContain("schema_mismatch: 2");
    expect(report).toContain("json_parse_failed: 1");
    expect(report).toContain("openai/gpt-4o-mini (recent 3):");
    expect(report).toContain("anthropic/claude-3-5-sonnet (recent 1):");
    expect(report).toContain("tool_timeout: 1");
  });
});
