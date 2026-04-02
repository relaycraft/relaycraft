import { toast } from "sonner";
import { DiffEditor, Editor } from "../components/common/Editor";
import { Markdown } from "../components/common/Markdown";
import i18n from "../i18n";
import { useAIStore } from "../stores/aiStore";
import { useNotificationStore } from "../stores/notificationStore";
import { usePluginContextMenuStore } from "../stores/pluginContextMenuStore";
import { usePluginPageStore } from "../stores/pluginPageStore";
import { usePluginSettingsStore } from "../stores/pluginSettingsStore";
import { usePluginSlotStore } from "../stores/pluginSlotStore";
import { useThemeStore } from "../stores/themeStore";
import { useUIStore } from "../stores/uiStore";
import type { ContextMenuItemConfig, CreateMockConfig, PluginAPI } from "../types/plugin";
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

  const i18nApi = {
    t: (key: string, options: any) => {
      // Auto-namespace the key if it doesn't contain a colon
      return i18n.t(key, { ns: ns, ...options }) as string;
    },
    language: i18n.language,
    onLanguageChange: (callback: (lng: string) => void) => {
      const handler = (lng: string) => callback(lng);
      i18n.on("languageChanged", handler);
      // Return unsubscribe function
      return () => i18n.off("languageChanged", handler);
    },
    registerLocale: (lang: string, resources: Record<string, string>) => {
      // Legacy manual registration
      i18n.addResourceBundle(lang, ns, resources, true, true); // Use plugin namespace
      const label = resources._label || lang.toUpperCase();
      useUIStore.getState().registerAvailableLanguage(lang, label, label, pluginId);
    },
  };

  const themeApi = {
    register: (theme: any) => {
      useThemeStore.getState().registerTheme(theme, pluginId);
    },
    set: (themeId: string) => {
      useThemeStore.getState().setTheme(themeId);
    },
  };

  return {
    i18n: i18nApi,
    theme: themeApi,
    ui: {
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
      registerContextMenuItem: (config: ContextMenuItemConfig) => {
        return usePluginContextMenuStore.getState().register({
          pluginId,
          itemId: config.id,
          label: config.label,
          icon: config.icon,
          when: config.when,
          onClick: config.onClick,
        });
      },
    },
    ai: {
      chat: async (messages) => {
        return scopedInvoke<string>("ai_chat_completion", messages);
      },
      isEnabled: () => {
        return useAIStore.getState().settings.enabled;
      },
    },
    stats: {
      getProcessStats: async () => {
        return scopedInvoke<any>("get_process_stats");
      },
    },
    proxy: {
      getStatus: async () => {
        return scopedInvoke<any>("get_proxy_status");
      },
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
    http: {
      send: (request) => scopedInvoke("http_send", request),
    },
    storage: {
      get: (key) => scopedInvoke("storage_get", { key }),
      set: (key, value) => scopedInvoke("storage_set", { key, value }),
      delete: (key) => scopedInvoke("storage_delete", { key }),
      list: (prefix) => scopedInvoke("storage_list", { prefix: prefix ?? null }),
      clear: () => scopedInvoke("storage_clear", {}),
    },
    events: {
      on: (eventName, callback) => {
        let unlisten: (() => void) | null = null;
        let cancelled = false;

        import("@tauri-apps/api/event").then(({ listen }) => {
          if (cancelled) return;
          listen(eventName, (event) => callback(event.payload)).then((unlistenFn) => {
            if (cancelled) {
              // unlisten() was called before the promise resolved
              unlistenFn();
            } else {
              unlisten = unlistenFn;
            }
          });
        });

        return () => {
          cancelled = true;
          unlisten?.();
        };
      },
    },
    rules: {
      createMock: (config: CreateMockConfig) => scopedInvoke<string>("rules_create_mock", config),
      list: (filter?) => scopedInvoke("rules_list", filter ?? {}),
      get: (id) => scopedInvoke("rules_get", { id }),
    },
    traffic: {
      listFlows: (filter?) => scopedInvoke("traffic_list_flows", filter ?? {}),
      getFlow: (id, options?) => scopedInvoke("traffic_get_flow", { id, ...options }),
    },
    host: {
      getRuntime: () => scopedInvoke("host_get_runtime", {}),
    },
  };
};
