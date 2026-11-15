import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotPreview } from "../../../types/snapshot";
import { ConfigSnapshotSection } from "./ConfigSnapshotSection";

const {
  invokeMock,
  saveDialog,
  openDialog,
  notify,
  settingsState,
  loadConfig,
  pluginState,
  syncPluginsWithConfig,
  setAlwaysOnTop,
  applyVibrancy,
  aiLoadSettings,
} = vi.hoisted(() => {
  const settingsState = {
    config: {
      upstream_proxy: { enabled: false, url: "", bypass_domains: "" },
      always_on_top: false,
    } as any,
  };
  const pluginState = {} as any;
  return {
    invokeMock: vi.fn(),
    saveDialog: vi.fn(),
    openDialog: vi.fn(),
    notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    settingsState,
    loadConfig: vi.fn(async () => {}),
    pluginState,
    syncPluginsWithConfig: vi.fn(async () => {}),
    setAlwaysOnTop: vi.fn(async () => {}),
    applyVibrancy: vi.fn(),
    aiLoadSettings: vi.fn(async () => {}),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setAlwaysOnTop }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: saveDialog,
  open: openDialog,
}));

vi.mock("../../../stores/settingsStore", () => {
  const useSettingsStore: any = (selector: any) =>
    selector ? selector({ ...settingsState, loadConfig }) : settingsState;
  useSettingsStore.getState = () => ({ ...settingsState, loadConfig });
  return { useSettingsStore };
});

vi.mock("../../../stores/pluginStore", () => {
  const usePluginStore: any = (selector: any) =>
    selector ? selector({ ...pluginState, syncPluginsWithConfig }) : pluginState;
  usePluginStore.getState = () => ({ ...pluginState, syncPluginsWithConfig });
  return { usePluginStore };
});

vi.mock("../../../stores/themeStore", () => ({
  useThemeStore: { getState: () => ({ applyVibrancy }) },
}));

vi.mock("../../../stores/aiStore", () => {
  const useAIStore: any = (selector: any) =>
    selector ? selector({ loadSettings: aiLoadSettings }) : { loadSettings: aiLoadSettings };
  useAIStore.getState = () => ({ loadSettings: aiLoadSettings });
  return { useAIStore };
});

vi.mock("../../../lib/notify", () => ({ notify }));
vi.mock("../../../lib/logger", () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("../../common/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock("../../common/Button", () => ({
  Button: ({ children, isLoading: _isLoading, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

const basePreview: SnapshotPreview = {
  name: "Work machine setup",
  description: null,
  requires_host: ">=1.0.0",
  host_version: "1.6.2",
  host_compatible: true,
  settings: [{ key: "language", current: "zh", incoming: "en" }],
  unchanged_settings: 2,
  invalid_settings: [],
  machine_bound: [{ key: "proxy_port", current: 9090, incoming: 8866, changed: true }],
  invalid_machine_bound: [],
  plugins_restore: [{ id: "p.enable", version: "1.0.0", enabled: true }],
  plugins_missing: [{ id: "p.missing", version: "9.9.9", enabled: true }],
  plugins_already_matching: [],
  plugins_not_restored: [],
  ignored_secrets: ["settings.ai.apiKey"],
  ignored_unknown: ["settings.future_field"],
  proxy_credentials: false,
};

describe("ConfigSnapshotSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.config.upstream_proxy = {
      enabled: false,
      url: "",
      bypass_domains: "",
    };
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "export_config_snapshot":
          return Promise.resolve({
            path: "/tmp/snap.json",
            settings_count: 12,
            plugin_count: 2,
            includes_proxy_credentials: false,
          });
        case "preview_config_snapshot":
          return Promise.resolve(basePreview);
        case "apply_config_snapshot":
          return Promise.resolve({
            applied_settings: 1,
            unchanged_settings: 2,
            skipped_settings: 0,
            applied_machine_bound: 1,
            plugins_enabled: 1,
            missing_plugins: 1,
            partial: false,
            error: null,
            restart_required: false,
          });
        default:
          return Promise.resolve(null);
      }
    });
  });

  it("renders the card with export and import actions", () => {
    render(<ConfigSnapshotSection />);
    expect(screen.getByText("privacy.snapshot.title")).toBeInTheDocument();
    expect(screen.getByText("privacy.snapshot.export")).toBeInTheDocument();
    expect(screen.getByText("privacy.snapshot.import")).toBeInTheDocument();
    expect(
      screen.queryByText("privacy.snapshot.proxy_credentials_warning"),
    ).not.toBeInTheDocument();
  });

  it("warns before export when the upstream proxy URL embeds credentials", () => {
    settingsState.config.upstream_proxy = {
      enabled: true,
      url: "http://user:pass@proxy.internal:8080",
      bypass_domains: "",
    };
    render(<ConfigSnapshotSection />);
    expect(screen.getByText("privacy.snapshot.proxy_credentials_warning")).toBeInTheDocument();
  });

  it("exports via the save dialog and invokes export_config_snapshot", async () => {
    saveDialog.mockResolvedValue("/tmp/snap.json");
    render(<ConfigSnapshotSection />);

    fireEvent.click(screen.getByText("privacy.snapshot.export"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("export_config_snapshot", {
        path: "/tmp/snap.json",
      });
    });
    expect(notify.success).toHaveBeenCalled();
  });

  it("previews then applies an import with checked machine-bound keys", async () => {
    openDialog.mockResolvedValue("/tmp/in.json");
    render(<ConfigSnapshotSection />);

    fireEvent.click(screen.getByText("privacy.snapshot.import"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("preview_config_snapshot", {
        path: "/tmp/in.json",
      });
    });

    // Preview modal: settings diff, machine-bound row, plugin buckets,
    // ignored-secret notice.
    await waitFor(() => {
      expect(screen.getByText("language")).toBeInTheDocument();
      expect(screen.getByText("proxy_port")).toBeInTheDocument();
      expect(screen.getByText("p.enable")).toBeInTheDocument();
      expect(screen.getByText("p.missing")).toBeInTheDocument();
    });
    expect(screen.getByText(/privacy.snapshot.secrets_ignored/)).toBeInTheDocument();

    // Machine-bound checkbox defaults off; check it, then apply.
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByText("privacy.snapshot.apply"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("apply_config_snapshot", {
        path: "/tmp/in.json",
        applyMachineBound: ["proxy_port"],
      });
    });
    await waitFor(() => {
      expect(notify.success).toHaveBeenCalled();
    });
    expect(loadConfig).toHaveBeenCalled();
    expect(aiLoadSettings).toHaveBeenCalled();
    expect(syncPluginsWithConfig).toHaveBeenCalled();
  });

  it("applies without machine-bound keys when none are checked", async () => {
    openDialog.mockResolvedValue("/tmp/in.json");
    render(<ConfigSnapshotSection />);

    fireEvent.click(screen.getByText("privacy.snapshot.import"));
    await waitFor(() => {
      expect(screen.getByText("proxy_port")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("privacy.snapshot.apply"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("apply_config_snapshot", {
        path: "/tmp/in.json",
        applyMachineBound: [],
      });
    });
  });

  it("blocks apply when requires.host is unmet", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "preview_config_snapshot"
        ? Promise.resolve({
            ...basePreview,
            host_compatible: false,
            requires_host: ">=99.0.0",
          })
        : Promise.resolve(null),
    );
    openDialog.mockResolvedValue("/tmp/in.json");
    render(<ConfigSnapshotSection />);

    fireEvent.click(screen.getByText("privacy.snapshot.import"));

    await waitFor(() => {
      expect(screen.getByText(/privacy.snapshot.blocked_version/)).toBeInTheDocument();
    });
    expect(screen.getByText("privacy.snapshot.apply")).toBeDisabled();
  });

  it("does not call preview when the file dialog is cancelled", async () => {
    openDialog.mockResolvedValue(null);
    render(<ConfigSnapshotSection />);

    fireEvent.click(screen.getByText("privacy.snapshot.import"));

    await waitFor(() => {
      expect(openDialog).toHaveBeenCalled();
    });
    expect(invokeMock).not.toHaveBeenCalledWith("preview_config_snapshot", expect.anything());
  });
});
