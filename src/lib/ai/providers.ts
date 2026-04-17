export interface AIProvider {
  id: string;
  defaultEndpoint: string | null;
  defaultModel: string;
  description?: string;
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: "openrouter",
    defaultEndpoint: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-3-flash-preview",
    description: "OpenRouter",
  },
  {
    id: "openai",
    defaultEndpoint: "https://api.openai.com/v1",
    defaultModel: "gpt-5-mini",
    description: "OpenAI",
  },
  {
    id: "deepseek",
    defaultEndpoint: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    description: "DeepSeek",
  },
  {
    id: "siliconflow",
    defaultEndpoint: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-7B-Instruct",
    description: "SiliconFlow",
  },
  {
    id: "groq",
    defaultEndpoint: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    description: "Groq",
  },
  {
    id: "aliyun",
    defaultEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.6-plus",
    description: "Alibaba",
  },
  {
    id: "moonshot",
    defaultEndpoint: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
    description: "Moonshot AI",
  },
  {
    id: "minimax",
    defaultEndpoint: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M2.7",
    description: "MiniMax",
  },
  {
    id: "zhipu",
    defaultEndpoint: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5.1",
    description: "Zhipu AI",
  },
  {
    id: "custom",
    defaultEndpoint: null,
    defaultModel: "",
    description: "Custom",
  },
];

export const getProviderById = (id: string): AIProvider | undefined => {
  return AI_PROVIDERS.find((p) => p.id === id);
};
