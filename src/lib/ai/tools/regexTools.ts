import type { Tool } from "../../../types/ai";

export const REGEX_GENERATION_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "generate_regex",
      description: "Generate a regex pattern based on user requirement",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Raw regex pattern string without surrounding slashes",
          },
        },
        required: ["pattern"],
      },
    },
  },
];

export const REGEX_EXPLAIN_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "explain_regex",
      description: "Explain a regex pattern in concise markdown",
      parameters: {
        type: "object",
        properties: {
          explanation: {
            type: "string",
            description: "Markdown explanation content",
          },
        },
        required: ["explanation"],
      },
    },
  },
];
