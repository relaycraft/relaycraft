import type { Tool } from "../../../types/ai";

export const FILTER_GENERATION_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "generate_filter",
      description: "Generate a RelayCraft traffic filter query string",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            description:
              "Valid RelayCraft filter query using keyword prefixes like status:, method:, domain:, duration:, size:",
          },
        },
        required: ["filter"],
      },
    },
  },
];
