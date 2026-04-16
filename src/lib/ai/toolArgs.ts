import { z } from "zod";
import type { ToolCall } from "../../types/ai";

const nonEmptyString = z.string().trim().min(1);

const generateFilterArgsSchema = z.object({
  filter: nonEmptyString,
});

const generateRegexArgsSchema = z.object({
  pattern: nonEmptyString,
});

const explainRegexArgsSchema = z.object({
  explanation: nonEmptyString,
});

const generateNameArgsSchema = z.object({
  name: nonEmptyString,
});

const generateScriptArgsSchema = z.object({
  code: nonEmptyString,
});

const generateRuleArgsSchema = z.object({
  name: nonEmptyString,
  rule_type: z.enum([
    "map_local",
    "map_remote",
    "rewrite_header",
    "rewrite_body",
    "throttle",
    "block_request",
  ]),
  match: z.looseObject({
    request: z.array(z.any()),
    response: z.array(z.any()).optional(),
  }),
  actions: z.array(z.any()),
  enabled: z.boolean().optional(),
  priority: z.number().optional(),
});

const explainRuleArgsSchema = z.object({
  message: nonEmptyString,
});

const TOOL_ARG_SCHEMAS = {
  generate_filter: generateFilterArgsSchema,
  generate_regex: generateRegexArgsSchema,
  explain_regex: explainRegexArgsSchema,
  generate_name: generateNameArgsSchema,
  generate_script: generateScriptArgsSchema,
  generate_rule: generateRuleArgsSchema,
  explain_rule: explainRuleArgsSchema,
} as const;

export type SupportedToolName = keyof typeof TOOL_ARG_SCHEMAS;
type ToolArgMap = {
  [K in SupportedToolName]: z.infer<(typeof TOOL_ARG_SCHEMAS)[K]>;
};

export const parseToolCallArgs = <T extends SupportedToolName>(
  toolCall: ToolCall | null | undefined,
  expectedName: T,
): ToolArgMap[T] | null => {
  if (!toolCall || toolCall.function.name !== expectedName) {
    return null;
  }

  const rawArguments = toolCall.function.arguments;
  if (!rawArguments?.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return null;
  }

  const result = TOOL_ARG_SCHEMAS[expectedName].safeParse(parsed);
  return result.success ? (result.data as ToolArgMap[T]) : null;
};
