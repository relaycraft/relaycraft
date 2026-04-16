import i18n from "../../i18n";

export type AIErrorKind =
  | "aborted"
  | "network_failure"
  | "model_failure"
  | "param_validation_failure"
  | "tool_execution_failure"
  | "unknown";

export interface AIErrorInfo {
  kind: AIErrorKind;
  detail: string;
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || "unknown_error";
  }
  if (typeof error === "string") {
    return error;
  }
  return "unknown_error";
};

export const classifyAIError = (error: unknown): AIErrorInfo => {
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();

  if (lower.includes("aborted")) {
    return { kind: "aborted", detail: message };
  }

  // Highest priority: explicit backend validation tags.
  if (
    lower.includes("param_validation_failure:") ||
    lower.includes("json_parse_failed") ||
    lower.includes("missing_field") ||
    lower.includes("empty_string") ||
    lower.includes("schema_mismatch")
  ) {
    return { kind: "param_validation_failure", detail: message };
  }

  if (
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("econn") ||
    lower.includes("dns") ||
    lower.includes("socket")
  ) {
    return { kind: "network_failure", detail: message };
  }

  // Provider/model side failures take precedence over generic "tool failed" wording.
  if (
    lower.includes("rate limit") ||
    lower.includes("model") ||
    lower.includes("provider") ||
    lower.includes("api key") ||
    lower.includes("unauthorized") ||
    lower.includes("quota") ||
    lower.includes("billing")
  ) {
    return { kind: "model_failure", detail: message };
  }

  if (
    lower.includes("zod") ||
    lower.includes("validation") ||
    lower.includes("schema") ||
    lower.includes("json parse") ||
    lower.includes("unexpected token")
  ) {
    return { kind: "param_validation_failure", detail: message };
  }

  if (
    lower.includes("tool") ||
    lower.includes("function call") ||
    lower.includes("function-calling")
  ) {
    return { kind: "tool_execution_failure", detail: message };
  }

  return { kind: "unknown", detail: message };
};

export const toUserActionableMessage = (info: AIErrorInfo): string => {
  switch (info.kind) {
    case "aborted":
      return i18n.t("ai.errors.aborted");
    case "network_failure":
      return i18n.t("ai.errors.network_failure");
    case "param_validation_failure":
    case "tool_execution_failure":
      return i18n.t("ai.errors.execution_failure");
    case "model_failure":
    case "unknown":
      return i18n.t("ai.errors.generic_failure");
    default:
      return i18n.t("ai.errors.generic_failure");
  }
};

export const composeActionableMessage = (prefix: string, error?: unknown): string => {
  if (!error) return prefix;
  const info = classifyAIError(error);
  return `${prefix} ${toUserActionableMessage(info)}`;
};
