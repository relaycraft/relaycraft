import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../stores/settingsStore";
import { AdvancedSettings } from "./AdvancedSettings";

const { settingsState, useSettingsStoreMock } = vi.hoisted(() => {
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
    updateVerboseLogging: vi.fn(),
    updateDisableGpuAcceleration: vi.fn(),
  };

  const useSettingsStoreMock = () => settingsState;

  return {
    settingsState,
    useSettingsStoreMock,
  };
});

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: useSettingsStoreMock,
}));

vi.mock("../../stores/uiStore", () => ({
  useUIStore: () => ({
    setLogViewerOpen: vi.fn(),
  }),
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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

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

describe("AdvancedSettings pending restart state", () => {
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
  });

  it("does not show verbose restart hint after startup config is loaded", async () => {
    const { rerender } = render(
      <AdvancedSettings
        systemInfo={{
          version: "1.0.0",
          platform: "darwin",
          arch: "arm64",
          engine: "x",
          build_date: "today",
        }}
      />,
    );

    settingsState.config = {
      ...settingsState.config,
      verbose_logging: true,
    };
    settingsState.loading = false;

    rerender(
      <AdvancedSettings
        systemInfo={{
          version: "1.0.0",
          platform: "darwin",
          arch: "arm64",
          engine: "x",
          build_date: "today",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("settings.about.verbose_restart_title")).not.toBeInTheDocument();
    });
  });

  it("shows verbose restart hint after user toggles verbose logging post-load", async () => {
    settingsState.loading = false;

    const { rerender } = render(
      <AdvancedSettings
        systemInfo={{
          version: "1.0.0",
          platform: "darwin",
          arch: "arm64",
          engine: "x",
          build_date: "today",
        }}
      />,
    );

    settingsState.config = {
      ...settingsState.config,
      verbose_logging: true,
    };

    rerender(
      <AdvancedSettings
        systemInfo={{
          version: "1.0.0",
          platform: "darwin",
          arch: "arm64",
          engine: "x",
          build_date: "today",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("settings.about.verbose_restart_title")).toBeInTheDocument();
    });
  });
});
