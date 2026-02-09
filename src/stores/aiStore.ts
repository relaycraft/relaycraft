import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { buildAIContext } from "../lib/ai/contextBuilder";
import { Logger } from "../lib/logger";
import type { AIContext, AIMessage, AISettings, ChatCompletionChunk } from "../types/ai";

interface AIStore {
  settings: AISettings;
  context: AIContext | null;
  loading: boolean;
  testingConnection: boolean;
  connectionStatus: "idle" | "success" | "error";
  connectionMessage: string;
  history: AIMessage[];

  // Actions
  loadSettings: () => Promise<void>;
  refreshContext: () => void;
  saveSettings: (settings: AISettings) => Promise<void>;
  testConnection: () => Promise<void>;
  getProviderKey: (provider: string) => Promise<string>;
  chatCompletion: (messages: AIMessage[], temperature?: number) => Promise<string>;
  chatCompletionStream: (
    messages: AIMessage[],
    onChunk: (content: string) => void,
    temperature?: number,
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
      apiKey: "",
      customEndpoint: "",
      model: "gpt-4-turbo-preview",
      maxTokens: 4096,
      temperature: 0.3,
      enableCaching: true,
      maxHistoryMessages: 10,
    },
    context: null,
    history: [],
    loading: false,
    testingConnection: false,
    connectionStatus: "idle",
    connectionMessage: "",

    loadSettings: async () => {
      set({ loading: true });
      try {
        const settings = await invoke<AISettings>("load_ai_config");
        set({ settings });
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

    getProviderKey: async (provider: string) => {
      try {
        return await invoke<string>("get_api_key", { provider });
      } catch (error) {
        Logger.error(`Failed to get API key for provider ${provider}:`, error);
        return "";
      }
    },

    chatCompletion: async (messages, temperature) => {
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

        const response = await invoke<string>("ai_chat_completion", {
          messages: finalMessages,
          temperature: temperature ?? null, // Backend expects Option<f32>
        });
        return response;
      } catch (error) {
        console.error("AI completion failed:", error);
        throw error;
      }
    },

    chatCompletionStream: async (messages, onChunk, temperature) => {
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

      const on_chunk = new Channel<ChatCompletionChunk>();
      on_chunk.onmessage = (chunk) => {
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
        console.error("AI streaming failed:", error);
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
      Logger.info("Aborting AI chat (client-side only for now)");
    },
  };
});
