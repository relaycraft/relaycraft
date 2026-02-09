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
		id: "aliyun",
		defaultEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		defaultModel: "qwen3-max",
		description: "Aliyun",
	},
	{
		id: "google",
		defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
		defaultModel: "gemini-3-flash",
		description: "Google",
	},
	{
		id: "anthropic",
		defaultEndpoint: "https://api.anthropic.com/v1",
		defaultModel: "claude-sonnet-4-5",
		description: "Anthropic",
	},
	{
		id: "moonshot",
		defaultEndpoint: "https://api.moonshot.cn/v1",
		defaultModel: "kimi-k2.5",
		description: "Moonshot AI",
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
