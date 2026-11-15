import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AISettings } from "../../types/ai";
import { AISettingsPanel } from "./AISettingsPanel";

const {
  invokeMock,
  aiState,
  aiStoreMock,
  uiStoreMock,
  getKeyStatusMock,
  deleteKeyMock,
  saveSettingsMock,
  showConfirmMock,
} = vi.hoisted(() => {
  const baseSettings: AISettings = {
    enabled: true,
    provider: "openai",
    profileId: "openai-default",
    adapterMode: "openai_compatible",
    apiKey: "",
    customEndpoint: "",
    model: "gpt-test",
    maxTokens: 4096,
    temperature: 0.7,
    enableCaching: true,
    maxHistoryMessages: 10,
  };

  const aiState = {
    settings: { ...baseSettings },
    loading: false,
    testingConnection: false,
    connectionStatus: "idle" as const,
    connectionMessage: "",
    profiles: [] as any[],
    capabilityProbe: null,
    loadSettings: vi.fn(async () => {}),
    loadProfiles: vi.fn(async () => {}),
    saveSettings: vi.fn(async (settings: AISettings) => {
      // Mirror the real store: the plaintext key is never retained.
      aiState.settings = { ...settings, apiKey: "" };
    }),
    probeCapabilities: vi.fn(async () => null),
    getKeyStatus: vi.fn(async (provider?: string) => ({
      provider: provider ?? "openai",
      hasKey: true,
      masked: "sk-…abcd",
    })),
    deleteKey: vi.fn(async () => {}),
    resetConnectionStatus: vi.fn(),
  };

  const uiState = { showConfirm: vi.fn() };

  const aiStoreMock = Object.assign(
    (selector?: (state: any) => any) => (selector ? selector(aiState) : aiState),
    { getState: () => aiState },
  );
  const uiStoreMock = (selector?: (state: any) => any) => (selector ? selector(uiState) : uiState);

  return {
    invokeMock: vi.fn(),
    aiState,
    uiState,
    aiStoreMock,
    uiStoreMock,
    getKeyStatusMock: aiState.getKeyStatus,
    deleteKeyMock: aiState.deleteKey,
    saveSettingsMock: aiState.saveSettings,
    showConfirmMock: uiState.showConfirm,
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../../stores/aiStore", () => ({
  useAIStore: aiStoreMock,
}));

vi.mock("../../stores/uiStore", () => ({
  useUIStore: uiStoreMock,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key,
    }),
  };
});

function keyInput(): HTMLInputElement {
  // Only the API-key input carries one of the placeholder_* / api_key_saved_*
  // placeholder strings; model/endpoint placeholders don't contain "placeholder".
  return document.querySelector('input[placeholder*="placeholder"]') as HTMLInputElement;
}

describe("AISettingsPanel API key handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiState.settings = {
      enabled: true,
      provider: "openai",
      profileId: "openai-default",
      adapterMode: "openai_compatible",
      apiKey: "",
      customEndpoint: "",
      model: "gpt-test",
      maxTokens: 4096,
      temperature: 0.7,
      enableCaching: true,
      maxHistoryMessages: 10,
    };
    getKeyStatusMock.mockImplementation(async (provider?: string) => ({
      provider: provider ?? "openai",
      hasKey: true,
      masked: "sk-…abcd",
    }));
  });

  it("keeps the key input empty and shows masked status plus a remove button", async () => {
    render(<AISettingsPanel />);

    await waitFor(() => {
      expect(getKeyStatusMock).toHaveBeenCalledWith("openai");
    });

    const input = keyInput();
    expect(input).toBeTruthy();
    expect(input.value).toBe("");
    expect(input.placeholder).toContain("sk-…abcd");
    expect(screen.getByRole("button", { name: "ai.api_key_remove" })).toBeInTheDocument();
    // Key operations go through the store only; the panel must not invoke
    // any Tauri command directly (the backend no longer exposes key reads).
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("enables test connection with a saved key and empty input", async () => {
    render(<AISettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText("ai.connection.test")).toBeInTheDocument();
    });
    expect(screen.getByText("ai.connection.test").closest("button")).not.toBeDisabled();
  });

  it("asks for confirmation and deletes the key for the selected provider", async () => {
    render(<AISettingsPanel />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ai.api_key_remove" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "ai.api_key_remove" }));

    await waitFor(() => {
      expect(showConfirmMock).toHaveBeenCalledTimes(1);
    });
    const confirmOptions = showConfirmMock.mock.calls[0][0];
    expect(confirmOptions.variant).toBe("warning");

    confirmOptions.onConfirm(false);

    await waitFor(() => {
      expect(deleteKeyMock).toHaveBeenCalledWith("openai");
    });
  });

  it("requests key status for the newly selected provider", async () => {
    render(<AISettingsPanel />);

    await waitFor(() => {
      expect(getKeyStatusMock).toHaveBeenCalledWith("openai");
    });

    // Open the provider select (first select on the form) and pick deepseek.
    fireEvent.click(screen.getByText("ai.providers.openai"));
    fireEvent.click(await screen.findByText("ai.providers.deepseek"));

    await waitFor(() => {
      expect(getKeyStatusMock).toHaveBeenCalledWith("deepseek");
    });
    // Switching providers clears any typed key.
    expect(keyInput().value).toBe("");
  });

  it("sends the typed key on save and clears the input afterwards", async () => {
    render(<AISettingsPanel />);

    await waitFor(() => {
      expect(keyInput()).toBeTruthy();
    });

    fireEvent.change(keyInput(), { target: { value: "sk-new-key" } });

    const saveButton = await screen.findByText("ai.connection.save");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "sk-new-key" }),
      );
    });
    await waitFor(() => {
      expect(keyInput().value).toBe("");
    });
  });
});
