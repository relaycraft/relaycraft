import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationStore } from "../stores/notificationStore";
import { usePluginRuntimeStore } from "../stores/pluginRuntimeStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUIStore } from "../stores/uiStore";
import { initPlugins, loadPluginUI, unloadPluginUI } from "./pluginLoader";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock i18n instance used by the loader
vi.mock("../i18n", () => ({
  default: {
    t: (key: string) => key,
    language: "en",
    on: vi.fn(),
    changeLanguage: vi.fn().mockResolvedValue(undefined),
    addResourceBundle: vi.fn(),
  },
}));

// Scoped API factory — keep it a plain object so we can assert registration
vi.mock("./api", () => ({
  createPluginApi: vi.fn((pluginId: string) => ({
    pluginId,
    ui: { toast: vi.fn() },
  })),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import i18n from "../i18n";

const makePlugin = (overrides: Record<string, any> = {}) => {
  const { manifest: manifestOverrides, ...rest } = overrides;
  return {
    enabled: true,
    manifest: {
      id: "com.test.demo",
      name: "Demo Plugin",
      version: "1.0.0",
      capabilities: { ui: { entry: "ui.js" } },
      ...manifestOverrides,
    },
    ...rest,
  } as any;
};

/** Await the loader appending the script tag, then fire its load event. */
async function completeScriptLoad(pluginId: string, execError?: string) {
  await vi.waitFor(() => {
    expect(document.getElementById(`plugin-script-${pluginId}`)).not.toBeNull();
  });
  if (execError !== undefined) {
    (window as any).__PLUGIN_LAST_ERROR = { [pluginId]: execError };
  }
  const script = document.getElementById(`plugin-script-${pluginId}`)!;
  script.dispatchEvent(new Event("load"));
}

describe("pluginLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.head.innerHTML = "";
    delete (window as any).__PLUGIN_APIS;
    delete (window as any).__PLUGIN_LAST_ERROR;
    (window as any).__PLUGIN_APIS = {};
    usePluginRuntimeStore.getState().clearAll();
    useNotificationStore.setState({ notifications: [] } as any);
    useSettingsStore.setState({
      config: { ...useSettingsStore.getState().config, language: "en" },
    });

    // jsdom does not implement blob URLs
    (URL as any).createObjectURL = vi.fn(() => "blob:mock-plugin");
    (URL as any).revokeObjectURL = vi.fn();
  });

  it("loads a plugin UI script and marks it loaded", async () => {
    const plugin = makePlugin();
    (invoke as any).mockResolvedValueOnce("console.log('plugin body');");

    const promise = loadPluginUI(plugin);
    await completeScriptLoad(plugin.manifest.id);
    await promise;

    expect(invoke).toHaveBeenCalledWith("read_plugin_file", {
      pluginId: "com.test.demo",
      fileName: "ui.js",
    });
    expect((window as any).__PLUGIN_APIS["com.test.demo"]).toBeDefined();
    expect(usePluginRuntimeStore.getState().loadResults["com.test.demo"]?.status).toBe("loaded");
  });

  it("skips re-loading when the script tag already exists", async () => {
    const plugin = makePlugin();
    const existing = document.createElement("script");
    existing.id = "plugin-script-com.test.demo";
    document.head.appendChild(existing);

    await loadPluginUI(plugin);

    expect(invoke).not.toHaveBeenCalled();
    expect(usePluginRuntimeStore.getState().loadResults["com.test.demo"]).toBeUndefined();
  });

  it("marks error when the plugin script throws during execution", async () => {
    const plugin = makePlugin();
    (invoke as any).mockResolvedValueOnce("throw new Error('boom');");

    const promise = loadPluginUI(plugin);
    await completeScriptLoad(plugin.manifest.id, "boom");
    await promise;

    const result = usePluginRuntimeStore.getState().loadResults["com.test.demo"];
    expect(result?.status).toBe("error");
    expect(result?.error).toBe("boom");
  });

  it("marks error when the script element fails to load", async () => {
    const plugin = makePlugin();
    (invoke as any).mockResolvedValueOnce("console.log('x');");

    const promise = loadPluginUI(plugin);
    await vi.waitFor(() => {
      expect(document.getElementById("plugin-script-com.test.demo")).not.toBeNull();
    });
    document.getElementById("plugin-script-com.test.demo")!.dispatchEvent(new Event("error"));
    await promise;

    const result = usePluginRuntimeStore.getState().loadResults["com.test.demo"];
    expect(result?.status).toBe("error");
    expect(result?.error).toBe("plugins.detail.scriptLoadError");
  });

  it("marks error when reading the plugin file fails", async () => {
    const plugin = makePlugin();
    (invoke as any).mockRejectedValueOnce(new Error("disk gone"));

    await loadPluginUI(plugin);

    const result = usePluginRuntimeStore.getState().loadResults["com.test.demo"];
    expect(result?.status).toBe("error");
    expect(result?.error).toContain("disk gone");
  });

  it("loads i18n locales with a sanitized namespace for data-only plugins", async () => {
    const plugin = makePlugin({
      manifest: {
        capabilities: {
          i18n: {
            namespace: "com.foo.bar",
            locales: { en: "locales/en.json", es: "locales/es.json" },
          },
        },
      },
    });
    (invoke as any).mockResolvedValueOnce(JSON.stringify({ greeting: "hi" }));

    await loadPluginUI(plugin);

    // Only the current language ("en") bundle is fetched
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("read_plugin_file", {
      pluginId: "com.test.demo",
      fileName: "locales/en.json",
    });
    // Dots are replaced to avoid i18next key confusion
    expect(i18n.addResourceBundle).toHaveBeenCalledWith(
      "en",
      "com_foo_bar",
      { greeting: "hi" },
      true,
      true,
    );
    // All advertised languages are registered in the UI store immediately
    const langs = useUIStore.getState().availableLanguages;
    expect(langs.some((l) => l.value === "es" && l.pluginId === "com.test.demo")).toBe(true);
    // Data-only plugin: no runtime result recorded
    expect(usePluginRuntimeStore.getState().loadResults["com.test.demo"]).toBeUndefined();
  });

  it("unloads a plugin: removes script, runtime state and registered languages", async () => {
    const script = document.createElement("script");
    script.id = "plugin-script-com.test.demo";
    document.head.appendChild(script);
    usePluginRuntimeStore.getState().markLoaded("com.test.demo");
    useUIStore.getState().registerAvailableLanguage("es", "Español", "Español", "com.test.demo");

    unloadPluginUI("com.test.demo");

    expect(document.getElementById("plugin-script-com.test.demo")).toBeNull();
    expect(usePluginRuntimeStore.getState().loadResults["com.test.demo"]).toBeUndefined();
    expect(
      useUIStore.getState().availableLanguages.some((l) => l.pluginId === "com.test.demo"),
    ).toBe(false);
  });

  it("reverts the UI language to en when unloading the plugin that provided it", async () => {
    useUIStore.getState().registerAvailableLanguage("es", "Español", "Español", "com.test.demo");
    useSettingsStore.setState({
      config: { ...useSettingsStore.getState().config, language: "es" },
    });
    (invoke as any).mockResolvedValue(undefined); // save_config

    unloadPluginUI("com.test.demo");

    await vi.waitFor(() => {
      expect(useSettingsStore.getState().config.language).toBe("en");
    });
  });

  it("initPlugins skips incompatible and disabled plugins", async () => {
    const compatibleDataOnly = makePlugin({
      manifest: { id: "com.test.ok", capabilities: {} },
    });
    const disabled = makePlugin({
      enabled: false,
      manifest: { id: "com.test.off", capabilities: {} },
    });
    const incompatible = makePlugin({
      manifest: { id: "com.test.bad", capabilities: {} },
      compatibility: { compatible: false, reason: "requires host >= 9.9.9" },
    });
    (invoke as any).mockResolvedValueOnce([compatibleDataOnly, disabled, incompatible]);

    await initPlugins();

    const results = usePluginRuntimeStore.getState().loadResults;
    expect(results["com.test.bad"]?.status).toBe("error");
    expect(results["com.test.bad"]?.error).toContain("requires host >= 9.9.9");
    expect(results["com.test.off"]).toBeUndefined();

    const notes = useNotificationStore.getState().notifications;
    expect(notes.some((n: any) => n.metadata?.pluginId === "com.test.bad")).toBe(true);
  });
});
