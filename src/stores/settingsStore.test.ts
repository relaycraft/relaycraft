import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, useSettingsStore } from "./settingsStore";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock i18n
vi.mock("../i18n", () => ({
  default: {
    changeLanguage: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock getCurrentWindow
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockConfig: AppConfig = {
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
  plugin_registry_url: "url",
  auto_check_update: false,
  confirm_exit: false,
  auto_start_proxy: false,
  display_density: "comfortable",
  enable_vibrancy: true,
  mcp_config: { enabled: false, port: 7090 },
};

describe("settingsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      config: { ...mockConfig },
      loading: false,
      testingUpstream: false,
      upstreamStatus: "idle",
      upstreamMessage: "",
    });
  });

  it("should load config successfully", async () => {
    const customConfig = { ...mockConfig, proxy_port: 8080, language: "zh" };
    (invoke as any).mockResolvedValueOnce(customConfig);

    await useSettingsStore.getState().loadConfig();

    expect(invoke).toHaveBeenCalledWith("load_config");
    expect(useSettingsStore.getState().config.proxy_port).toBe(8080);
    expect(useSettingsStore.getState().config.language).toBe("zh");
    expect(useSettingsStore.getState().loading).toBe(false);
  });

  it("should update and save config values", async () => {
    (invoke as any).mockResolvedValue(undefined);

    const store = useSettingsStore.getState();

    await store.updateProxyPort(8888);
    expect(useSettingsStore.getState().config.proxy_port).toBe(8888);
    expect(invoke).toHaveBeenCalledWith("save_config", {
      config: expect.objectContaining({ proxy_port: 8888 }),
    });

    await store.updateSslInsecure(true);
    expect(useSettingsStore.getState().config.ssl_insecure).toBe(true);
    expect(invoke).toHaveBeenCalledWith("save_config", {
      config: expect.objectContaining({ ssl_insecure: true }),
    });

    await store.updateLanguage("ja");
    expect(useSettingsStore.getState().config.language).toBe("ja");

    await store.updateDisplayDensity("compact");
    expect(useSettingsStore.getState().config.display_density).toBe("compact");
  });

  it("should test upstream connectivity successfully", async () => {
    (invoke as any).mockResolvedValueOnce("Connection successful");

    // Must have a URL to test
    useSettingsStore.setState({
      config: {
        ...mockConfig,
        upstream_proxy: { enabled: true, url: "http://proxy:8080", bypass_domains: "" },
      },
    });

    await useSettingsStore.getState().testUpstreamConnectivity();

    expect(invoke).toHaveBeenCalledWith("check_proxy_connectivity", {
      proxyUrl: "http://proxy:8080",
    });
    expect(useSettingsStore.getState().upstreamStatus).toBe("success");
    expect(useSettingsStore.getState().upstreamMessage).toBe("Connection successful");
    expect(useSettingsStore.getState().testingUpstream).toBe(false);
  });

  it("should handle test upstream connectivity error", async () => {
    (invoke as any).mockRejectedValueOnce(new Error("Timeout"));

    useSettingsStore.setState({
      config: {
        ...mockConfig,
        upstream_proxy: { enabled: true, url: "http://bad:8080", bypass_domains: "" },
      },
    });

    await useSettingsStore.getState().testUpstreamConnectivity();

    expect(useSettingsStore.getState().upstreamStatus).toBe("error");
    expect(useSettingsStore.getState().upstreamMessage).toBe("Timeout");
    expect(useSettingsStore.getState().testingUpstream).toBe(false);
  });

  it("should not test connectivity if url is empty", async () => {
    useSettingsStore.setState({
      config: { ...mockConfig, upstream_proxy: { enabled: false, url: "", bypass_domains: "" } },
    });

    await useSettingsStore.getState().testUpstreamConnectivity();

    expect(invoke).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().upstreamStatus).toBe("idle");
  });
});
