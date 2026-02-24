import { toast } from "sonner";
import { DiffEditor, Editor } from "../components/common/Editor";
import { Markdown } from "../components/common/Markdown";
import i18n from "../i18n";
import { useNotificationStore } from "../stores/notificationStore";
import { usePluginPageStore } from "../stores/pluginPageStore";
import { usePluginSettingsStore } from "../stores/pluginSettingsStore";
import { usePluginSlotStore } from "../stores/pluginSlotStore";
import { useThemeStore } from "../stores/themeStore";
import { useUIStore } from "../stores/uiStore";
import type { PluginAPI } from "../types/plugin";
import { sanitizeNamespace } from "./pluginUtils";

declare global {
  interface Window {
    RelayCraft: {
      api: PluginAPI;
    };
  }
}

// Helper to create a scoped API for a specific plugin
export const createPluginApi = (
  pluginId: string,
  silent: boolean = false,
  i18nNamespace?: string,
): PluginAPI => {
  // Default to pluginId if no namespace provided.
  const ns = sanitizeNamespace(pluginId, i18nNamespace);

  // Scoped invoke helper to route through the security bridge
  const scopedInvoke = async <T>(command: string, args: any = {}): Promise<T> => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>("plugin_call", {
      payload: {
        plugin_id: pluginId,
        command,
        args,
      },
    });
  };

  return {
    ui: {
      t: (key, options) => {
        // Auto-namespace the key if it doesn't contain a colon
        return i18n.t(key, { ns: ns, ...options }) as string;
      },
      language: i18n.language,
      onLanguageChange: (callback) => {
        const handler = (lng: string) => callback(lng);
        i18n.on("languageChanged", handler);
        // Return unsubscribe function
        return () => i18n.off("languageChanged", handler);
      },
      registerPage: (page) => {
        // Auto-inject the i18n namespace if nameKey is provided
        const pageWithNamespace = page.nameKey
          ? { ...page, i18nNamespace: page.i18nNamespace || ns }
          : page;
        usePluginPageStore.getState().registerPage(pageWithNamespace, pluginId);
      },
      registerSlot: (slotId, options) => {
        usePluginSlotStore.getState().registerComponent(slotId, options.component, pluginId);
      },
      registerTheme: (theme) => {
        useThemeStore.getState().registerTheme(theme, pluginId);
      },
      setTheme: (themeId) => {
        useThemeStore.getState().setTheme(themeId);
      },
      registerLocale: (lang, resources) => {
        // Legacy manual registration
        i18n.addResourceBundle(lang, ns, resources, true, true); // Use plugin namespace
        const label = resources._label || lang.toUpperCase();
        useUIStore.getState().registerAvailableLanguage(lang, label, label, pluginId);
      },
      toast: (message, type = "info") => {
        const { dnd } = useNotificationStore.getState();

        // Show ephemeral toast only if NOT silent AND NOT DND
        if (!(silent || dnd)) {
          const toastType = type as "success" | "error" | "info" | "warning";
          if (toast[toastType]) {
            toast[toastType](message);
          } else {
            toast(message);
          }
        }

        // Determine priority based on type
        let priority: "critical" | "high" | "normal" | "low" = "normal";
        const toastType = type as "success" | "error" | "info" | "warning";

        if (toastType === "error") {
          priority = "high";
        } else if (toastType === "warning") {
          priority = "high";
        } else if (toastType === "success") {
          priority = "normal";
        } else {
          priority = "low";
        }

        // Add to history only if it's a warning or error
        // Success messages are ephemeral only (to avoid cluttering the notification center with "Active", "Saved" etc.)
        if (toastType === "warning" || toastType === "error") {
          useNotificationStore.getState().addNotification({
            title: `Plugin: ${pluginId}`,
            message: message,
            type: (type || "info") as "info" | "success" | "warning" | "error",
            category: "plugin",
            priority,
            source: `Plugin: ${pluginId}`,
            metadata: {
              pluginId,
            },
          });
        }
      },
      components: {
        Editor,
        DiffEditor,
        Markdown,
      },
    },
    ai: {
      chat: async (messages) => {
        return scopedInvoke<string>("ai_chat_completion", messages);
      },
    },
    stats: {
      getProcessStats: async () => {
        return scopedInvoke<any>("get_process_stats");
      },
    },
    // Legacy support - Now routed through the security bridge whitelisting
    invoke: async <T>(command: string, args?: any): Promise<T> => {
      return scopedInvoke<T>(command, args);
    },
    settings: {
      get: (key?: string) => {
        const settings = usePluginSettingsStore.getState().getSettings(pluginId);
        return key ? settings?.[key] : settings;
      },
    },
    log: {
      info: (message: string, context?: any) => {
        import("../lib/logger").then(({ Logger }) => {
          Logger.plugin(`[INFO] ${message} ${context ? JSON.stringify(context) : ""}`, pluginId);
        });
      },
      warn: (message: string, context?: any) => {
        import("../lib/logger").then(({ Logger }) => {
          Logger.plugin(`[WARN] ${message} ${context ? JSON.stringify(context) : ""}`, pluginId);
        });
      },
      error: (message: string, errorObj?: any) => {
        import("../lib/logger").then(({ Logger }) => {
          Logger.plugin(`[ERROR] ${message} ${errorObj ? JSON.stringify(errorObj) : ""}`, pluginId);
        });
      },
    },
  };
};
