import type { Tool } from "../../../types/ai";

export const SCRIPT_GENERATION_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "generate_script",
      description: "生成 mitmproxy Python 脚本",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "完整的 Python 代码，必须包含 Addon 类和 addons 列表",
          },
        },
        required: ["code"],
      },
    },
  },
];
