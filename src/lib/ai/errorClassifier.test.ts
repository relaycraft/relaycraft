import { describe, expect, it } from "vitest";
import i18n from "../../i18n";
import {
  classifyAIError,
  composeActionableMessage,
  toUserActionableMessage,
} from "./errorClassifier";

describe("classifyAIError", () => {
  it("classifies network errors", () => {
    const info = classifyAIError(new Error("network timeout"));
    expect(info.kind).toBe("network_failure");
  });

  it("classifies validation errors", () => {
    const info = classifyAIError(new Error("schema validation failed"));
    expect(info.kind).toBe("param_validation_failure");
  });

  it("prioritizes explicit backend validation tags", () => {
    const info = classifyAIError(
      new Error(
        "param_validation_failure:schema_mismatch: invalid tool args for generate_rule: missing field `name`",
      ),
    );
    expect(info.kind).toBe("param_validation_failure");
  });

  it("classifies tool errors", () => {
    const info = classifyAIError(new Error("function-calling tool failed"));
    expect(info.kind).toBe("tool_execution_failure");
  });

  it("prioritizes model failures before generic tool wording", () => {
    const info = classifyAIError(new Error("provider rate limit while calling tool"));
    expect(info.kind).toBe("model_failure");
  });

  it("returns model actionable message", () => {
    const info = classifyAIError(new Error("api key unauthorized"));
    expect(toUserActionableMessage(info)).toBe(i18n.t("ai.errors.generic_failure"));
  });

  it("merges validation and tool failures to same user-facing wording", () => {
    const validation = classifyAIError(new Error("schema validation failed"));
    const tool = classifyAIError(new Error("function-calling tool failed"));
    expect(toUserActionableMessage(validation)).toBe(toUserActionableMessage(tool));
  });

  it("composes parse hint with classified suggestion", () => {
    const message = composeActionableMessage("parse failed", new Error("unexpected token"));
    expect(message).toContain("parse failed");
    expect(message).toContain(i18n.t("ai.errors.execution_failure"));
  });

  it("merges model and unknown failures to same user-facing wording", () => {
    const model = classifyAIError(new Error("provider rate limit"));
    const unknown = classifyAIError(new Error("something odd happened"));
    expect(toUserActionableMessage(model)).toBe(toUserActionableMessage(unknown));
  });
});
