import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import i18n from "../i18n";
import { Logger } from "../lib/logger";
import { loadPluginUI, unloadPluginUI } from "../plugins/pluginLoader";
import type { PluginInfo } from "../types/plugin";

// Market Types
export interface RegistryPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon?: string;
  homepage?: string;
  url?: string;
  downloadUrl: string;
  downloadCount?: number;
  thumbnailUrl?: string;
  tags?: string[];
  category?: string;
  locales?: any;
}

export interface RegistryIndex {
  version: string;
  plugins: RegistryPlugin[];
}

interface PluginStore {
  plugins: PluginInfo[];
  marketPlugins: RegistryPlugin[];
  themeMarketPlugins: RegistryPlugin[];
  loading: boolean;
  isFetchingMarket: boolean;
  installingPluginUrl: string | null;

  // Actions
  fetchPlugins: () => Promise<void>;
  togglePlugin: (id: string, enabled: boolean) => Promise<void>;

  // Market Actions
  fetchMarketPlugins: (type: "plugin" | "theme") => Promise<void>;
  fetchCachedMarketPlugins: (type: "plugin" | "theme") => Promise<void>;
  installPlugin: (url: string) => Promise<void>;
  installPluginLocal: (path: string) => Promise<void>;
  uninstallPlugin: (id: string) => Promise<void>;
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: [],
  marketPlugins: [],
  themeMarketPlugins: [],
  loading: false,
  isFetchingMarket: false,
  installingPluginUrl: null,

  fetchPlugins: async () => {
    set({ loading: true });
    try {
      const plugins = await invoke<PluginInfo[]>("get_plugins");
      set({ plugins, loading: false });
    } catch (error) {
      Logger.error("[PluginStore] Failed to fetch plugins:", error);
      set({ loading: false });

      // 添加错误通知
      const { useNotificationStore } = await import("./notificationStore");
      useNotificationStore.getState().addNotification({
        title: i18n.t("plugins.notifications.load_failed_title"),
        message: i18n.t("plugins.notifications.load_failed_msg", {
          error: String(error),
        }),
        type: "error",
        category: "plugin",
        priority: "high",
        source: "System",
      });
    }
  },

  togglePlugin: async (id, enabled) => {
    try {
      await invoke("toggle_plugin", { id, enabled });
      // Sync settings store
      const { useSettingsStore } = await import("./settingsStore");
      useSettingsStore.getState().loadConfig();

      set((state) => {
        const newPlugins = state.plugins.map((p) => (p.manifest.id === id ? { ...p, enabled } : p));

        const plugin = newPlugins.find((p) => p.manifest.id === id);
        if (plugin) {
          if (enabled) {
            loadPluginUI(plugin);
          } else {
            unloadPluginUI(id);
          }
        }

        return { plugins: newPlugins };
      });

      // 添加通知
      const { useNotificationStore } = await import("./notificationStore");
      const plugin = get().plugins.find((p) => p.manifest.id === id);
      const pluginName = plugin?.manifest.name || id;

      useNotificationStore.getState().addNotification({
        title: enabled
          ? i18n.t("plugins.notifications.enabled_title")
          : i18n.t("plugins.notifications.disabled_title"),
        message: enabled
          ? i18n.t("plugins.notifications.enabled_msg", { name: pluginName })
          : i18n.t("plugins.notifications.disabled_msg", { name: pluginName }),
        type: "success",
        category: "plugin",
        priority: "normal",
        source: `Plugin: ${pluginName}`,
        metadata: { pluginId: id },
      });
    } catch (error) {
      Logger.error("Failed to toggle plugin:", error);

      // 添加错误通知
      const { useNotificationStore } = await import("./notificationStore");
      useNotificationStore.getState().addNotification({
        title: i18n.t("plugins.notifications.toggle_failed_title"),
        message: i18n.t("plugins.notifications.toggle_failed_msg", {
          action: enabled
            ? i18n.t("common.enable", { defaultValue: "enable" })
            : i18n.t("common.disable", { defaultValue: "disable" }),
          id,
          error: String(error),
        }),
        type: "error",
        category: "plugin",
        priority: "high",
        source: "System",
      });

      throw error;
    }
  },

  fetchMarketPlugins: async (type: "plugin" | "theme") => {
    set({ isFetchingMarket: true });
    try {
      const index = await invoke<RegistryIndex>("plugin_market_fetch", {
        marketType: type,
      });
      if (type === "theme") {
        set({ themeMarketPlugins: index.plugins, isFetchingMarket: false });
      } else {
        set({ marketPlugins: index.plugins, isFetchingMarket: false });
      }
    } catch (error) {
      Logger.error(`Failed to fetch ${type} market plugins:`, error);
      set({ isFetchingMarket: false });
    }
  },

  fetchCachedMarketPlugins: async (type: "plugin" | "theme") => {
    try {
      const index = await invoke<RegistryIndex>("plugin_market_load_cache", {
        marketType: type,
      });
      if (type === "theme") {
        set({ themeMarketPlugins: index.plugins });
      } else {
        set({ marketPlugins: index.plugins });
      }
    } catch (error) {
      Logger.error(`Failed to load cached ${type} market plugins:`, error);
    }
  },

  installPlugin: async (url: string) => {
    try {
      set({ installingPluginUrl: url });
      Logger.debug(`[PluginStore] Installing plugin from ${url}...`);
      const id = await invoke<string>("plugin_market_install", { url });
      Logger.debug(`[PluginStore] Installation successful (ID: ${id})`);

      // Small delay to ensure FS operation is complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      Logger.debug("[PluginStore] Refreshing local plugins...");
      // Refresh local plugins first
      await get().fetchPlugins();

      // Also refresh themes, as we don't know if the installed item was a theme or plugin
      const { useThemeStore } = await import("./themeStore");
      await useThemeStore.getState().fetchThemes();

      // Auto-enable plugin (this will now find the plugin in the list and update UI state)
      Logger.debug(`[PluginStore] Auto-enabling plugin ${id}...`);
      await get().togglePlugin(id, true);

      // Force re-render of market view by ensuring state update propagation
      set((state) => ({
        installingPluginUrl: null,
        // Ensure filtered/derived states re-calc
        plugins: [...state.plugins],
      }));
    } catch (error) {
      Logger.error("[PluginStore] Failed to install plugin:", error);
      set({ installingPluginUrl: null });

      // Show user-friendly error notification
      const { toast } = await import("sonner");
      const { t } = await import("i18next");

      const errorMessage = String(error);

      // Extract meaningful error message
      let displayMessage = t("plugins.errors.install_failed");
      if (errorMessage.includes("Failed to start download")) {
        displayMessage = t("plugins.errors.download_failed");
      } else if (errorMessage.includes("timeout")) {
        displayMessage = t("plugins.errors.timeout");
      } else if (errorMessage.includes("404")) {
        displayMessage = t("plugins.errors.not_found");
      } else {
        displayMessage = t("plugins.errors.generic", { error: errorMessage });
      }

      toast.error(displayMessage, {
        duration: 5000,
        description: t("plugins.errors.help_text"),
      });

      throw error;
    }
  },

  installPluginLocal: async (path: string) => {
    try {
      set({ loading: true });
      Logger.debug(`[PluginStore] Installing local plugin from ${path}...`);
      const id = await invoke<string>("plugin_install_local_zip", { path });
      Logger.debug(`[PluginStore] Local installation successful (ID: ${id})`);

      await new Promise((resolve) => setTimeout(resolve, 500));
      await get().fetchPlugins();

      const { useThemeStore } = await import("./themeStore");
      await useThemeStore.getState().fetchThemes();

      await get().togglePlugin(id, true);

      set({ loading: false });

      // Show success message
      const { useUIStore } = await import("./uiStore");
      useUIStore.getState().showConfirm({
        title: i18n.t("plugins.notifications.install_success_title"),
        message: i18n.t("plugins.notifications.install_success_msg", { id }),
        variant: "success",
        confirmLabel: i18n.t("common.ok", { defaultValue: "OK" }),
        onConfirm: () => {},
      });
    } catch (error) {
      Logger.error("[PluginStore] Failed to install local plugin:", error);
      set({ loading: false });

      // Show user-friendly error message
      const { useUIStore } = await import("./uiStore");
      const errorMessage = String(error);

      let title = i18n.t("plugins.errors.install_failed");
      let message = errorMessage;

      // Parse common error types for better UX
      if (errorMessage.includes("Invalid plugin.json")) {
        title = i18n.t("plugins.errors.invalid_format_title");
        message = i18n.t("plugins.errors.invalid_format_msg", {
          error: errorMessage,
        });
      } else if (errorMessage.includes("trailing characters")) {
        title = i18n.t("plugins.errors.invalid_format_title");
        message = i18n.t("plugins.errors.invalid_pkg_msg");
      } else if (errorMessage.includes("not found") || errorMessage.includes("No such file")) {
        title = i18n.t("plugins.errors.file_not_found_title");
        message = i18n.t("plugins.errors.file_not_found_msg");
      } else if (errorMessage.includes("permission")) {
        title = i18n.t("plugins.errors.permission_denied_title");
        message = i18n.t("plugins.errors.permission_denied_msg");
      } else if (errorMessage.includes("already exists")) {
        title = i18n.t("plugins.errors.already_exists_title");
        message = i18n.t("plugins.errors.already_exists_msg");
      }

      useUIStore.getState().showConfirm({
        title,
        message,
        variant: "danger",
        confirmLabel: i18n.t("common.ok", { defaultValue: "OK" }),
        onConfirm: () => {},
      });

      throw error;
    }
  },

  uninstallPlugin: async (id: string) => {
    try {
      Logger.debug(`[PluginStore] Uninstalling plugin ${id}...`);
      // First unload if running
      const plugin = get().plugins.find((p) => p.manifest.id === id);
      const pluginName = plugin?.manifest.name || id;

      if (plugin?.enabled) {
        await get().togglePlugin(id, false);
      }

      await invoke("uninstall_plugin", { id });
      await get().fetchPlugins();

      // 添加成功通知
      const { useNotificationStore } = await import("./notificationStore");
      useNotificationStore.getState().addNotification({
        title: i18n.t("plugins.notifications.uninstall_success_title"),
        message: i18n.t("plugins.notifications.uninstall_success_msg", {
          name: pluginName,
        }),
        type: "success",
        category: "plugin",
        priority: "normal",
        source: `Plugin: ${pluginName}`,
      });
    } catch (error) {
      Logger.error("[PluginStore] Failed to uninstall plugin:", error);

      // Show user-friendly error message
      const { useUIStore } = await import("./uiStore");
      const errorMessage = String(error);

      useUIStore.getState().showConfirm({
        title: i18n.t("plugins.notifications.uninstall_failed_title"),
        message: i18n.t("plugins.notifications.uninstall_failed_msg", {
          id,
          error: errorMessage,
        }),
        variant: "danger",
        confirmLabel: i18n.t("common.ok", { defaultValue: "OK" }),
        onConfirm: () => {},
      });

      throw error;
    }
  },
}));
