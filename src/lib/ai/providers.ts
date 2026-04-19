export interface AIProvider {
  id: string;
  description?: string;
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: "openrouter",
    description: "OpenRouter",
  },
  {
    id: "openai",
    description: "OpenAI",
  },
  {
    id: "deepseek",
    description: "DeepSeek",
  },
  {
    id: "siliconflow",
    description: "SiliconFlow",
  },
  {
    id: "groq",
    description: "Groq",
  },
  {
    id: "aliyun",
    description: "Alibaba",
  },
  {
    id: "moonshot",
    description: "Moonshot AI",
  },
  {
    id: "minimax",
    description: "MiniMax",
  },
  {
    id: "zhipu",
    description: "Zhipu AI",
  },
  {
    id: "custom",
    description: "Custom",
  },
];

export const getProviderById = (id: string): AIProvider | undefined => {
  return AI_PROVIDERS.find((p) => p.id === id);
};
