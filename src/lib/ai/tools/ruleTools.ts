import type { Tool } from "../../../types/ai";

export const RULE_GENERATION_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "generate_rule",
      description: "根据用户需求生成代理规则",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "规则名称",
          },
          rule_type: {
            type: "string",
            enum: [
              "map_local",
              "map_remote",
              "rewrite_header",
              "rewrite_body",
              "throttle",
              "block_request",
            ],
            description: "规则类型",
          },
          match: {
            type: "object",
            description: "匹配条件",
            properties: {
              request: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["url", "host", "path", "method", "header", "query", "port", "ip"],
                    },
                    matchType: {
                      type: "string",
                      enum: ["exact", "contains", "regex", "wildcard", "exists", "not_exists"],
                    },
                    key: { type: "string" },
                    value: { type: "string" },
                    invert: { type: "boolean" },
                  },
                },
              },
              response: { type: "array" },
            },
            required: ["request"],
          },
          actions: {
            type: "array",
            description: "规则动作",
          },
          enabled: { type: "boolean" },
          priority: { type: "number" },
        },
        required: ["name", "rule_type", "match", "actions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_rule",
      description: "当无法生成规则时，用于解释原因",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
      },
    },
  },
];
