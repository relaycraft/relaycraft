import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../stores/settingsStore";
import { PrivacySettings } from "./PrivacySettings";

const {
  invokeMock,
  settingsState,
  proxyState,
  aiState,
  pluginState,
  settingsStoreMock,
  proxyStoreMock,
  aiStoreMock,
  pluginStoreMock,
  uiStoreMock,
} = vi.hoisted(() => {
  const defaultConfig: AppConfig = {
    ssl_insecure: false,
    proxy_port: 9090,
    verbose_logging: false,
    language: "en",
    upstream_proxy: {
      enabled: false,
      url: "",
      bypass_domains: "localhost,127.0.0.1",
    },
    always_on_top: false,
    plugin_registry_url: "",
    auto_check_update: false,
    confirm_exit: false,
    auto_start_proxy: false,
    display_density: "comfortable",
    enable_vibrancy: false,
    disable_gpu_acceleration: false,
    mcp_config: {
      enabled: false,
      port: 7090,
    },
    share: {
      enabled: false,
      port: 9080,
      upstream_url: "",
      listen_lan: false,
    },
  };

  const settingsState = { config: defaultConfig };
  const proxyState = { running: false, port: 9090 };
  const aiState = {
    settings: {
      enabled: false,
      provider: "openai",
      profileId: "openai-default",
      customEndpoint: "",
      model: "gpt-test",
    },
    profiles: [
      {
        id: "openai-default",
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
      },
    ],
  };
  const pluginState = { plugins: [] as any[] };
  const uiState = { setSettingsTab: vi.fn(), showConfirm: vi.fn() };

  const settingsStoreMock = (selector?: (state: any) => any) =>
    selector ? selector(settingsState) : settingsState;
  const proxyStoreMock = (selector?: (state: any) => any) =>
    selector ? selector(proxyState) : proxyState;
  const aiStoreMock = (selector?: (state: any) => any) => (selector ? selector(aiState) : aiState);
  const pluginStoreMock = (selector?: (state: any) => any) =>
    selector ? selector(pluginState) : pluginState;
  const uiStoreMock = (selector?: (state: any) => any) => (selector ? selector(uiState) : uiState);

  return {
    invokeMock: vi.fn(),
    settingsState,
    proxyState,
    aiState,
    pluginState,
    uiState,
    settingsStoreMock,
    proxyStoreMock,
    aiStoreMock,
    pluginStoreMock,
    uiStoreMock,
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: settingsStoreMock,
}));

vi.mock("../../stores/proxyStore", () => ({
  useProxyStore: proxyStoreMock,
}));

vi.mock("../../stores/aiStore", () => ({
  useAIStore: aiStoreMock,
}));

vi.mock("../../stores/pluginStore", () => ({
  usePluginStore: pluginStoreMock,
}));

vi.mock("../../stores/uiStore", () => ({
  useUIStore: uiStoreMock,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      transition: _transition,
      ...props
    }: any) => <div {...props}>{children}</div>,
    button: ({ children, whileTap: _whileTap, transition: _transition, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
  },
}));

function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const today = localDateString(new Date());

const mockSummary = {
  daily: [
    {
      date: today,
      caller: "app",
      model: "gpt-4o",
      requests: 2,
      errors: 0,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedRequests: 1,
    },
    {
      date: today,
      caller: "plugin:p1",
      model: "gpt-4o",
      requests: 1,
      errors: 0,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      estimatedRequests: 0,
    },
  ],
  recent: [
    {
      id: "r1",
      timestampMs: Date.now(),
      caller: "app",
      provider: "openai",
      model: "gpt-4o",
      endpointHost: "api.openai.com",
      stream: false,
      tools: false,
      toolNames: [],
      status: "success",
      durationMs: 123,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimated: true,
      error: null,
      messageCount: 1,
      totalChars: 11,
    },
    {
      id: "r2",
      timestampMs: Date.now(),
      caller: "connection_test",
      provider: "openai",
      model: "gpt-4o-mini",
      endpointHost: "api.openai.com",
      stream: true,
      tools: false,
      toolNames: [],
      status: "error",
      durationMs: 50,
      promptTokens: 10,
      completionTokens: 0,
      totalTokens: 10,
      estimated: true,
      error: "boom",
      messageCount: 1,
      totalChars: 5,
    },
  ],
};

const mockDetail = {
  ...mockSummary.recent[0],
  messages: [{ role: "user", content: "hello world", originalChars: 11, truncated: false }],
};

function mockInvoke() {
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "get_ai_usage_summary":
        return Promise.resolve(mockSummary);
      case "get_ai_key_status":
        return Promise.resolve({ provider: "openai", hasKey: true, masked: "sk-…abcd" });
      case "get_ai_request_detail":
        return Promise.resolve(mockDetail);
      case "get_mcp_status":
        return Promise.resolve({ running: false, port: 7090 });
      case "get_plugin_call_stats":
        return Promise.resolve([]);
      default:
        return Promise.resolve(null);
    }
  });
}

describe("PrivacySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke();
    settingsState.config = {
      ...settingsState.config,
      ssl_insecure: false,
      share: { enabled: false, port: 9080, upstream_url: "", listen_lan: false },
      mcp_config: { enabled: false, port: 7090 },
    };
    proxyState.running = false;
    proxyState.port = 9090;
    aiState.settings = {
      enabled: false,
      provider: "openai",
      profileId: "openai-default",
      customEndpoint: "",
      model: "gpt-test",
    };
    pluginState.plugins = [];
  });

  it("shows two attention tiles when ssl_insecure and LAN share are enabled", async () => {
    settingsState.config = {
      ...settingsState.config,
      ssl_insecure: true,
      share: {
        enabled: true,
        port: 9080,
        upstream_url: "https://example.com",
        listen_lan: true,
      },
    };

    const { container } = render(<PrivacySettings />);

    await waitFor(() => {
      expect(screen.getAllByText("privacy.status.warn")).toHaveLength(2);
    });
    // LAN share also counts as reachable from other devices.
    expect(screen.getByText("privacy.hero.summary")).toBeInTheDocument();
    // Attention state switches the hero to the amber ShieldAlert treatment.
    expect(container.querySelector("svg.text-amber-500")).toBeInTheDocument();
  });

  it("renders the all-clear hero when nothing is exposed", async () => {
    render(<PrivacySettings />);

    await waitFor(() => {
      expect(screen.getByText("privacy.hero.all_clear")).toBeInTheDocument();
    });
    expect(screen.queryByText("privacy.status.warn")).not.toBeInTheDocument();
  });

  it("renders AI usage chart and recent requests from get_ai_usage_summary", async () => {
    render(<PrivacySettings />);

    // Seven daily bars render once usage data arrives.
    await waitFor(() => {
      expect(document.querySelectorAll('[title="privacy.ai.chart_day"]')).toHaveLength(7);
    });

    // Recent list shows caller-resolved labels, models and estimated tokens.
    await waitFor(() => {
      expect(screen.getAllByText("privacy.ai.caller.app").length).toBeGreaterThan(0);
      expect(screen.getAllByText("privacy.ai.caller.test").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0);
    expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
    expect(screen.getByText("~150")).toBeInTheDocument();
    expect(screen.getByText("privacy.ai.estimated_note")).toBeInTheDocument();
  });

  it("loads request detail lazily when expanding a recent row", async () => {
    render(<PrivacySettings />);

    await waitFor(() => {
      expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("gpt-4o-mini"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_ai_request_detail", { id: "r2" });
    });
    await waitFor(() => {
      expect(screen.getByText("hello world")).toBeInTheDocument();
    });
    expect(screen.queryByText("privacy.ai.msg_truncated")).not.toBeInTheDocument();
  });
});
