import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { buildAIContext } from "../lib/ai/contextBuilder";
import { getProviderById } from "../lib/ai/providers";
import { Logger } from "../lib/logger";
import type {
  AICapabilityProbeResult,
  AIContext,
  AIMessage,
  AIProviderProfile,
  AISettings,
  AIToolMessage,
  ChatCompletionChunk,
  Tool,
  ToolChoice,
  ToolCompletionResult,
} from "../types/ai";

export function sanitizeLoadedSettings(settings: AISettings): AISettings {
  if (getProviderById(settings.provider)) {
    return settings;
  }
  Logger.warn(
    `Unknown provider loaded from config: ${settings.provider}. Preserving provider/model/endpoint for conservative migration.`,
  );
  return settings;
}

interface AIStore {
  settings: AISettings;
  context: AIContext | null;
  loading: boolean;
  testingConnection: boolean;
  connectionStatus: "idle" | "success" | "error";
  connectionMessage: string;
  profiles: AIProviderProfile[];
  capabilityProbe: AICapabilityProbeResult | null;
  history: AIMessage[];

  // Actions
  loadSettings: () => Promise<void>;
  refreshContext: () => void;
  saveSettings: (settings: AISettings) => Promise<void>;
  testConnection: () => Promise<void>;
  loadProfiles: () => Promise<void>;
  probeCapabilities: () => Promise<AICapabilityProbeResult>;
  getProviderKey: (provider: string) => Promise<string>;
  chatCompletion: (
    messages: AIMessage[],
    temperature?: number,
    signal?: AbortSignal,
  ) => Promise<string>;
  chatCompletionStream: (
    messages: AIMessage[],
    onChunk: (content: string) => void,
    temperature?: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  chatCompletionWithTools: (
    messages: AIToolMessage[],
    tools: Tool[],
    toolChoice?: ToolChoice,
    temperature?: number,
    signal?: AbortSignal,
  ) => Promise<ToolCompletionResult>;
  chatCompletionStreamWithTools: (
    messages: AIToolMessage[],
    tools: Tool[],
    onChunk: (chunk: ChatCompletionChunk) => void,
    toolChoice?: ToolChoice,
    temperature?: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  resetConnectionStatus: () => void;
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  clearHistory: () => void;
  abortChat: () => void;
}

export const useAIStore = create<AIStore>((set, get) => {
  return {
    settings: {
      enabled: false,
      provider: "openai",
      profileId: "openai-default",
      adapterMode: "openai_compatible",
      apiKey: "",
      customEndpoint: "",
      model: "gpt-5-mini",
      maxTokens: 4096,
      temperature: 0.3,
      enableCaching: true,
      maxHistoryMessages: 10,
    },
    context: null,
    history: [],
    profiles: [],
    capabilityProbe: null,
    loading: false,
    testingConnection: false,
    connectionStatus: "idle",
    connectionMessage: "",

    loadSettings: async () => {
      set({ loading: true });
      try {
        const settings = await invoke<AISettings>("load_ai_config");
        set({ settings: sanitizeLoadedSettings(settings) });
        get().refreshContext();
      } catch (error) {
        Logger.error("Failed to load AI settings:", error);
      } finally {
        set({ loading: false });
      }
    },

    refreshContext: async () => {
      try {
        const context = await buildAIContext();
        set({ context });
      } catch (e) {
        Logger.error("Failed to build AI context", e);
      }
    },

    saveSettings: async (settings) => {
      set({ loading: true });
      try {
        await invoke("save_ai_config", { config: settings });
        set({ settings });
      } catch (error) {
        Logger.error("Failed to save AI settings:", error);
        throw error;
      } finally {
        set({ loading: false });
      }
    },

    testConnection: async () => {
      set({ testingConnection: true, connectionStatus: "idle" });
      try {
        const message = await invoke<string>("test_ai_connection");
        set({
          connectionStatus: "success",
          connectionMessage: message,
        });
      } catch (error) {
        set({
          connectionStatus: "error",
          connectionMessage: error instanceof Error ? error.message : "Connection failed",
        });
      } finally {
        set({ testingConnection: false });
      }
    },

    loadProfiles: async () => {
      try {
        const profiles = await invoke<AIProviderProfile[]>("list_ai_profiles");
        set({ profiles });
      } catch (error) {
        Logger.error("Failed to load AI profiles:", error);
      }
    },

    probeCapabilities: async () => {
      set({ testingConnection: true });
      try {
        const result = await invoke<AICapabilityProbeResult>("probe_ai_capabilities");
        set({
          capabilityProbe: result,
          connectionStatus: result.chat.ok ? "success" : "error",
          connectionMessage: result.chat.message,
        });
        return result;
      } finally {
        set({ testingConnection: false });
      }
    },

    getProviderKey: async (provider: string) => {
      try {
        return await invoke<string>("get_api_key", { provider });
      } catch (error) {
        Logger.error(`Failed to get API key for provider ${provider}:`, error);
        return "";
      }
    },

    chatCompletion: async (messages, temperature, signal) => {
      const formattedMessages = messages.map((m) => [m.role, m.content]);

      try {
        const context = get().context;
        const finalMessages = [...formattedMessages];

        if (context) {
          const contextPrompt = `\n\n[System Context]:\n${JSON.stringify(context, null, 2)}`;
          if (finalMessages.length > 0 && finalMessages[0][0] === "system") {
            finalMessages[0][1] += contextPrompt;
          } else {
            finalMessages.unshift(["system", `Current System Context: ${contextPrompt}`]);
          }
        }

        if (signal?.aborted) throw new Error("Aborted");

        const response = await invoke<string>("ai_chat_completion", {
          messages: finalMessages,
          temperature: temperature ?? null, // Backend expects Option<f32>
        });

        if (signal?.aborted) throw new Error("Aborted");
        return response;
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.message === "Aborted")) {
          Logger.info("AI completion aborted");
          throw new Error("Aborted");
        }
        console.error("AI completion failed:", error);
        throw error;
      }
    },

    chatCompletionStream: async (messages, onChunk, temperature, signal) => {
      const formattedMessages = messages.map((m) => [m.role, m.content]);
      const context = get().context;
      const finalMessages = [...formattedMessages];

      if (context) {
        const contextPrompt = `\n\n[System Context]:\n${JSON.stringify(context, null, 2)}`;
        if (finalMessages.length > 0 && finalMessages[0][0] === "system") {
          finalMessages[0][1] += contextPrompt;
        } else {
          finalMessages.unshift(["system", `Current System Context: ${contextPrompt}`]);
        }
      }

      if (signal?.aborted) return;

      const on_chunk = new Channel<ChatCompletionChunk>();
      on_chunk.onmessage = (chunk) => {
        if (signal?.aborted) return;
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          onChunk(content);
        }
      };

      try {
        await invoke("ai_chat_completion_stream", {
          messages: finalMessages,
          temperature: temperature ?? null,
          onChunk: on_chunk,
        });
      } catch (error) {
        if (signal?.aborted) {
          Logger.info("AI stream aborted");
          return;
        }
        console.error("AI streaming failed:", error);
        throw error;
      }
    },

    chatCompletionWithTools: async (messages, tools, toolChoice, temperature, signal) => {
      const context = get().context;
      const finalMessages = messages.map((m) => ({ ...m }));

      if (context) {
        const contextPrompt = `\n\n[System Context]:\n${JSON.stringify(context, null, 2)}`;
        if (finalMessages.length > 0 && finalMessages[0].role === "system") {
          finalMessages[0].content = `${finalMessages[0].content || ""}${contextPrompt}`;
        } else {
          finalMessages.unshift({
            role: "system",
            content: `Current System Context: ${contextPrompt}`,
          });
        }
      }

      if (signal?.aborted) throw new Error("Aborted");

      try {
        const response = await invoke<ToolCompletionResult>("ai_chat_completion_with_tools", {
          messages: finalMessages,
          tools,
          toolChoice: toolChoice ?? null,
          temperature: temperature ?? null,
        });

        if (signal?.aborted) throw new Error("Aborted");
        return response;
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.message === "Aborted")) {
          Logger.info("AI tool completion aborted");
          throw new Error("Aborted");
        }
        console.error("AI tool completion failed:", error);
        throw error;
      }
    },

    chatCompletionStreamWithTools: async (
      messages,
      tools,
      onChunk,
      toolChoice,
      temperature,
      signal,
    ) => {
      const context = get().context;
      const finalMessages = messages.map((m) => ({ ...m }));

      if (context) {
        const contextPrompt = `\n\n[System Context]:\n${JSON.stringify(context, null, 2)}`;
        if (finalMessages.length > 0 && finalMessages[0].role === "system") {
          finalMessages[0].content = `${finalMessages[0].content || ""}${contextPrompt}`;
        } else {
          finalMessages.unshift({
            role: "system",
            content: `Current System Context: ${contextPrompt}`,
          });
        }
      }

      if (signal?.aborted) return;

      const on_chunk = new Channel<ChatCompletionChunk>();
      on_chunk.onmessage = (chunk) => {
        if (signal?.aborted) return;
        onChunk(chunk);
      };

      try {
        await invoke("ai_chat_completion_stream_with_tools", {
          messages: finalMessages,
          tools,
          toolChoice: toolChoice ?? null,
          temperature: temperature ?? null,
          onChunk: on_chunk,
        });
      } catch (error) {
        if (signal?.aborted) {
          Logger.info("AI tool stream aborted");
          return;
        }
        console.error("AI tool streaming failed:", error);
        throw error;
      }
    },

    resetConnectionStatus: () => {
      set({ connectionStatus: "idle", connectionMessage: "" });
    },

    addMessage: (role, content) => {
      const { history, settings } = get();
      const newHistory = [...history, { role, content }];
      const limit = settings.maxHistoryMessages * 2;
      set({ history: newHistory.slice(-limit) });
    },

    clearHistory: () => {
      set({ history: [] });
    },

    abortChat: () => {
      // Note: Backend doesn't support cancellation yet,
      // but we can clear state or implement AbortController if we update invoke
      Logger.debug("Aborting AI chat (client-side only for now)");
    },
  };
});
