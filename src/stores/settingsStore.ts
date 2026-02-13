import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";
import i18n from "../i18n";
import { Logger } from "../lib/logger";

export interface AppConfig {
  ssl_insecure: boolean;
  proxy_port: number;
  verbose_logging: boolean;
  language: string;
  enabled_plugins?: string[];
  upstream_proxy: {
    enabled: boolean;
    url: string;
    bypass_domains: string;
  };
  always_on_top: boolean;
  plugin_registry_url: string;
  auto_check_update: boolean;
  confirm_exit: boolean;
  auto_start_proxy: boolean;
  display_density: "compact" | "comfortable" | "relaxed";
  ai_config?: any;
}

export type ConnectionStatus = "idle" | "success" | "error";

interface SettingsStore {
  config: AppConfig;
  loading: boolean;
  testingUpstream: boolean;
  upstreamStatus: ConnectionStatus;
  upstreamMessage: string;
  loadConfig: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<void>;
  updateSslInsecure: (value: boolean) => Promise<void>;
  updateVerboseLogging: (value: boolean) => Promise<void>;
  updateProxyPort: (port: number) => Promise<void>;
  updateLanguage: (lang: string) => Promise<void>;
  updateUpstreamProxy: (proxy: {
    enabled: boolean;
    url: string;
    bypass_domains: string;
  }) => Promise<void>;
  updateAlwaysOnTop: (value: boolean) => Promise<void>;
  updateAutoCheckUpdate: (value: boolean) => Promise<void>;
  updateConfirmExit: (value: boolean) => Promise<void>;
  updateAutoStartProxy: (value: boolean) => Promise<void>;
  updateDisplayDensity: (value: "compact" | "comfortable" | "relaxed") => Promise<void>;
  testUpstreamConnectivity: () => Promise<void>;
  resetUpstreamStatus: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  config: {
    ssl_insecure: false,
    proxy_port: 9090,
    verbose_logging: false,
    language: "en",
    upstream_proxy: {
      enabled: false,
      url: "",
      bypass_domains: "localhost, 127.0.0.1",
    },
    always_on_top: false,
    plugin_registry_url:
      "https://raw.githubusercontent.com/relaycraft/relaycraft-plugins/main/plugins.json",
    // Privacy: Disable cloud connectivity by default as per user request
    auto_check_update: false,
    confirm_exit: false,
    auto_start_proxy: false,
    display_density: "comfortable",
  },
  loading: false,
  testingUpstream: false,
  upstreamStatus: "idle",
  upstreamMessage: "",

  loadConfig: async () => {
    set({ loading: true });
    try {
      const config = await invoke<AppConfig>("load_config");
      set({ config });
      // Apply language from config
      if (config.language) {
        i18n.changeLanguage(config.language);
      }
    } catch (error) {
      Logger.error("Failed to load config:", error);
    } finally {
      set({ loading: false });
    }
  },

  saveConfig: async (config: AppConfig) => {
    set({ loading: true });
    try {
      await invoke("save_config", { config });
      set({ config });
    } catch (error) {
      Logger.error("Failed to save config:", error);
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  updateSslInsecure: async (value: boolean) => {
    const { config, saveConfig } = get();
    await saveConfig({ ...config, ssl_insecure: value });
  },

  updateVerboseLogging: async (value: boolean) => {
    const { config, saveConfig } = get();
    await saveConfig({ ...config, verbose_logging: value });
  },

  updateProxyPort: async (port: number) => {
    const { config, saveConfig } = get();
    await saveConfig({ ...config, proxy_port: port });
  },

  updateLanguage: async (lang: string) => {
    // Update i18n instance first to ensure UI reflects change immediately
    await i18n.changeLanguage(lang);

    const { config, saveConfig } = get();
    await saveConfig({ ...config, language: lang });
  },

  updateUpstreamProxy: async (proxy) => {
    const { config, saveConfig } = get();
    await saveConfig({ ...config, upstream_proxy: proxy });
  },
  updateAlwaysOnTop: async (value: boolean) => {
    const { config, saveConfig } = get();
    await saveConfig({ ...config, always_on_top: value });
    try {
      await getCurrentWindow().setAlwaysOnTop(value);
    } catch (error) {
      console.error("Failed to set always on top:", error);
    }
  },

  updateAutoCheckUpdate: async (value: boolean) => {
    const { config, saveConfig } = get();
    await saveConfig({ ...config, auto_check_update: value });
  },

  updateConfirmExit: async (value: boolean) => {
    const { config, saveConfig } = get();
    await saveConfig({ ...config, confirm_exit: value });
  },

  updateAutoStartProxy: async (value: boolean) => {
    const { config, saveConfig } = get();
    await saveConfig({ ...config, auto_start_proxy: value });
  },

  updateDisplayDensity: async (value: "compact" | "comfortable" | "relaxed") => {
    const { config, saveConfig } = get();
    await saveConfig({ ...config, display_density: value });
  },

  testUpstreamConnectivity: async () => {
    const { config } = get();
    if (!config.upstream_proxy?.url) return;

    set({ testingUpstream: true, upstreamStatus: "idle" });
    try {
      const message = await invoke<string>("check_proxy_connectivity", {
        proxyUrl: config.upstream_proxy.url,
      });
      set({
        upstreamStatus: "success",
        upstreamMessage: message,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      Logger.error("Proxy connectivity check failed:", errorMsg);
      set({
        upstreamStatus: "error",
        upstreamMessage: errorMsg,
      });
    } finally {
      set({ testingUpstream: false });
    }
  },

  resetUpstreamStatus: () => {
    set({ upstreamStatus: "idle", upstreamMessage: "" });
  },
}));
