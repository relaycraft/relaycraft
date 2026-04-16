import type { Tool } from "../../../types/ai";

export const NAMING_GENERATION_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "generate_name",
      description: "Generate a concise and professional RelayCraft rule/script name",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Generated name string, concise and descriptive",
          },
        },
        required: ["name"],
      },
    },
  },
];
