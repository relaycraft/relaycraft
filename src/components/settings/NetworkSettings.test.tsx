import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../stores/settingsStore";
import { NetworkSettings } from "./NetworkSettings";

const {
  settingsState,
  proxyState,
  useSettingsStoreMock,
  useProxyStoreMock,
  resetUpstreamStatusMock,
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
  };

  const settingsState = {
    config: defaultConfig,
    loading: true,
    updateProxyPort: vi.fn(),
    updateSslInsecure: vi.fn(),
    updateUpstreamProxy: vi.fn(),
    testingUpstream: false,
    upstreamStatus: "idle" as const,
    testUpstreamConnectivity: vi.fn(),
    resetUpstreamStatus: vi.fn(),
  };

  const proxyState = {
    running: true,
    restartProxy: vi.fn().mockResolvedValue(undefined),
  };

  const useSettingsStoreMock = () => settingsState;
  const useProxyStoreMock = () => proxyState;

  return {
    settingsState,
    proxyState,
    useSettingsStoreMock,
    useProxyStoreMock,
    resetUpstreamStatusMock: settingsState.resetUpstreamStatus,
  };
});

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: useSettingsStoreMock,
}));

vi.mock("../../stores/proxyStore", () => ({
  useProxyStore: useProxyStoreMock,
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
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    button: ({ children, ...props }: React.HTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

describe("NetworkSettings pending restart state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.loading = true;
    settingsState.config = {
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
    };
    proxyState.running = true;
  });

  it("does not show pending restart after startup config is loaded", async () => {
    const { rerender } = render(<NetworkSettings />);

    settingsState.config = {
      ...settingsState.config,
      ssl_insecure: true,
      upstream_proxy: {
        ...settingsState.config.upstream_proxy,
        enabled: true,
        url: "http://127.0.0.1:7890",
      },
    };
    settingsState.loading = false;

    rerender(<NetworkSettings />);

    await waitFor(() => {
      expect(screen.queryByText("settings.network.pending_restart_title")).not.toBeInTheDocument();
    });
  });

  it("shows pending restart after user changes network config post-load", async () => {
    settingsState.loading = false;
    settingsState.config = {
      ...settingsState.config,
      proxy_port: 9090,
      ssl_insecure: false,
      upstream_proxy: {
        ...settingsState.config.upstream_proxy,
        enabled: false,
        url: "",
      },
    };

    const { rerender } = render(<NetworkSettings />);

    settingsState.config = {
      ...settingsState.config,
      proxy_port: 9191,
    };

    rerender(<NetworkSettings />);

    await waitFor(() => {
      expect(screen.getByText("settings.network.pending_restart_title")).toBeInTheDocument();
    });
  });

  it("resets upstream status on unmount", () => {
    const { unmount } = render(<NetworkSettings />);
    unmount();
    expect(resetUpstreamStatusMock).toHaveBeenCalled();
  });
});
