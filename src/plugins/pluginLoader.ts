import { invoke } from "@tauri-apps/api/core";
// UI Components for Plugins
import { Button } from "../components/common/Button";
import { Input } from "../components/common/Input";
import { Select } from "../components/common/Select";
import { Skeleton } from "../components/common/Skeleton";
import { Switch } from "../components/common/Switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/common/Tabs";
import { Textarea } from "../components/common/Textarea";
import i18n from "../i18n";
import { Logger } from "../lib/logger";
import { usePluginPageStore } from "../stores/pluginPageStore";
import { usePluginSlotStore } from "../stores/pluginSlotStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useThemeStore } from "../stores/themeStore";
import { useUIStore } from "../stores/uiStore";
import type { PluginInfo } from "../types/plugin";
import { createPluginApi } from "./api";

const SharedComponents = {
  Button,
  Input,
  Switch,
  Select,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Textarea,
};

// Internal registry for scoped APIs
(window as any).__PLUGIN_APIS = (window as any).__PLUGIN_APIS || {};
(window as any).__PLUGIN_COMPONENTS = SharedComponents;

/**
 * Dynamically loads a plugin's UI assets
 */
export async function loadPluginUI(plugin: PluginInfo, silent: boolean = false) {
  const uiEntry = plugin.manifest.capabilities?.ui?.entry || plugin.manifest.entry?.ui;

  if (uiEntry) {
    const scriptId = `plugin-script-${plugin.manifest.id}`;
    if (document.getElementById(scriptId)) {
      Logger.debug(`UI for plugin ${plugin.manifest.id} already loaded`);
      return;
    }
  }

  Logger.debug(`Loading UI for plugin: ${plugin.manifest.id}`);

  try {
    if (plugin.manifest.capabilities?.i18n?.locales) {
      // Priority: 1. YAML namespace 2. Sanitized Plugin ID (com.foo -> com_foo)
      const rawNs = plugin.manifest.capabilities.i18n.namespace || plugin.manifest.id;
      const ns = rawNs === "translation" ? "translation" : rawNs.replace(/\./g, "_");

      await loadPluginLocales(plugin.manifest.id, plugin.manifest.capabilities.i18n.locales, ns);
      ensureLanguageListener();
    }

    if (!uiEntry) {
      // Valid case for data-only plugins
      return;
    }

    const content = await invoke<string>("read_plugin_file", {
      pluginId: plugin.manifest.id,
      fileName: uiEntry,
    });

    // Scoped API Creation
    const rawNs = plugin.manifest.capabilities?.i18n?.namespace || plugin.manifest.id;
    const ns = rawNs === "translation" ? "translation" : rawNs.replace(/\./g, "_");
    const scopedApi = createPluginApi(plugin.manifest.id, silent, ns);

    // Expose to internal registry for retrieval during script execution
    (window as any).__PLUGIN_APIS[plugin.manifest.id] = scopedApi;

    // Create a script tag and execute the content
    const script = document.createElement("script");
    script.id = `plugin-script-${plugin.manifest.id}`;

    // Wrap content in a Proxy/Closure to inject RelayCraft functionality
    script.textContent = `
            (function() {
                const pluginId = "${plugin.manifest.id}";
                const scopedApi = globalThis.__PLUGIN_APIS[pluginId];
                const components = globalThis.__PLUGIN_COMPONENTS;
                const React = globalThis.React;

                const RelayCraft = {
                    api: scopedApi,
                    components: components
                };

                // Legacy compatibility
                globalThis.RelayCraft = RelayCraft;
                globalThis.ProxyPilot = RelayCraft; 

                console.log('[PluginLoader] Initialized API for ' + pluginId);

                try {
                    ${content}
                } catch(e) {
                    console.error("[PluginLoader] Plugin execution error:", e);
                    scopedApi.ui.toast("Plugin Error: " + (e.message || String(e)), "error");
                }
            })();
        `;
    document.head.appendChild(script);

    Logger.debug(`Successfully loaded UI for plugin: ${plugin.manifest.id}`);
  } catch (error) {
    Logger.error(`Failed to load UI for plugin ${plugin.manifest.id}:`, error);
  }
}

async function loadPluginLocales(
  pluginId: string,
  locales: Record<string, string>,
  targetNamespace: string,
  specificLang?: string,
) {
  // Determine languages to load: specific OR current + en (fallback)
  const currentLang = i18n.language;
  // Always load 'en' as fallback, plus current language
  const languagesToLoad = specificLang ? [specificLang] : Array.from(new Set([currentLang, "en"]));

  Logger.debug(
    `[PluginLoader] Loading locales for ${pluginId} (NS: ${targetNamespace}). Targets: ${languagesToLoad.join(",")}`,
  );

  for (const langCode of Object.keys(locales)) {
    // 1. First, register all available languages in UI Store immediately so they appear in dropdowns
    const labelMap: Record<string, string> = {
      es: "Español (Spanish)",
      fr: "Français (French)",
      de: "Deutsch (German)",
      ja: "日本語 (Japanese)",
      ko: "한국어 (Korean)",
      pt: "Português (Portuguese)",
      ru: "Русский (Russian)",
      it: "Italiano (Italian)",
      "zh-TW": "繁體中文 (Traditional Chinese)",
    };

    const triggerLabelMap: Record<string, string> = {
      es: "Español",
      fr: "Français",
      de: "Deutsch",
      ja: "日本語",
      ko: "한국어",
      pt: "Português",
      ru: "Русский",
      it: "Italiano",
      "zh-TW": "繁體中文",
    };

    useUIStore
      .getState()
      .registerAvailableLanguage(
        langCode,
        labelMap[langCode] || langCode.toUpperCase(),
        triggerLabelMap[langCode] || langCode.toUpperCase(),
        pluginId,
      );

    // 2. Only load bundles for target languages (current or fallback)
    if (!languagesToLoad.includes(langCode)) continue;

    const filePath = locales[langCode];

    try {
      const content = await invoke<string>("read_plugin_file", {
        pluginId,
        fileName: filePath,
      });
      const resource = JSON.parse(content);

      // Sanitize Namespace: replace dots with underscores to avoid i18next key confusion
      // AND ensure we use the custom namespace if provided, otherwise derived from ID
      // BUT wait, loadPluginLocales takes 'targetNamespace'.

      Logger.debug(`[PluginLoader] Registering lang ${langCode} for NS: ${targetNamespace}`);

      i18n.addResourceBundle(langCode, targetNamespace, resource, true, true);
    } catch (e: any) {
      Logger.error(`[PluginLoader] Failed to load locale ${langCode} for ${pluginId}:`, e);
      // Only toast error if it's the CURRENT language failing
      if (langCode === currentLang) {
        const { toast } = await import("sonner");
        toast.error(`Lang Load Failed (${langCode}): ${e.message || String(e)}`);
      }
    }
  }
}

// Global listener for language changes
let isListening = false;
function ensureLanguageListener() {
  if (isListening) return;
  isListening = true;

  i18n.on("languageChanged", async (lng) => {
    const plugins = await invoke<PluginInfo[]>("get_plugins");
    const enabledPlugins = plugins.filter((p) => p.enabled);

    for (const plugin of enabledPlugins) {
      if (plugin.manifest.capabilities?.i18n?.locales) {
        const ns = plugin.manifest.capabilities.i18n.namespace || plugin.manifest.id;
        // Load specifically this new language
        await loadPluginLocales(
          plugin.manifest.id,
          plugin.manifest.capabilities.i18n.locales,
          ns,
          lng,
        );
      }
    }
  });
}

/**
 * Unloads a plugin's UI assets
 */
export function unloadPluginUI(pluginId: string) {
  Logger.debug(`Unloading UI for plugin: ${pluginId}`);

  const script = document.getElementById(`plugin-script-${pluginId}`);
  if (script) {
    script.remove();
  }

  usePluginSlotStore.getState().unregisterPluginComponents(pluginId);
  usePluginPageStore.getState().unregisterPluginPages(pluginId);
  const currentLang = useSettingsStore.getState().config.language;
  const pluginLangs = useUIStore
    .getState()
    .availableLanguages.filter((l) => l.pluginId === pluginId);

  if (pluginLangs.some((l) => l.value === currentLang)) {
    Logger.debug(`[PluginLoader] Reverting language from ${currentLang} to default (en)`);
    useSettingsStore.getState().updateLanguage("en");
  }

  useUIStore.getState().unregisterPluginLanguages(pluginId);
  useThemeStore.getState().unregisterPluginThemes(pluginId);
}

/**
 * Initializes all enabled plugins
 */
export async function initPlugins() {
  try {
    const plugins = await invoke<PluginInfo[]>("get_plugins");
    const enabledPlugins = plugins.filter((p) => p.enabled);

    for (const plugin of enabledPlugins) {
      await loadPluginUI(plugin, true); // Silent on startup
    }
  } catch (error: any) {
    Logger.error("Failed to initialize plugins:", error);
  }
}
