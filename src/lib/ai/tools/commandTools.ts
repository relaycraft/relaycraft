import type { Tool } from "../../../types/ai";

export const COMMAND_DETECTION_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "detect_intent",
      description: "检测用户命令意图并提取参数",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: [
              "NAVIGATE",
              "CREATE_RULE",
              "CREATE_SCRIPT",
              "TOGGLE_PROXY",
              "OPEN_SETTINGS",
              "GENERATE_REQUEST",
              "CLEAR_TRAFFIC",
              "FILTER_TRAFFIC",
              "CHAT",
            ],
            description: "检测到的意图",
          },
          params: {
            type: "object",
            description: "意图参数",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "置信度 0.0-1.0",
          },
          explanation: {
            type: "string",
            description: "简短解释（当前语言）",
          },
        },
        required: ["intent", "confidence"],
      },
    },
  },
];
