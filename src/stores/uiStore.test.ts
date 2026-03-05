import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "./uiStore";

describe("uiStore", () => {
  beforeEach(() => {
    // Reset store before each test
    useUIStore.setState({
      activeTab: "traffic",
      settingsTab: "general",
      availableLanguages: [
        { value: "en", label: "English", triggerLabel: "English" },
        { value: "zh", label: "简体中文", triggerLabel: "简体中文" },
      ],
      alertDialog: {
        isOpen: false,
        title: "",
        message: "",
        confirmLabel: "",
        cancelLabel: "",
        variant: "info",
        onConfirm: () => {},
        onCancel: () => {},
      },
      importModalOpen: false,
      saveSessionModalOpen: false,
      draftScriptPrompt: null,
      draftRulePrompt: null,
      draftTrafficFilter: null,
      draftScriptCode: null,
      marketOpen: false,
      marketType: "plugin",
      logViewerOpen: false,
    });
  });

  it("should handle active and settings tabs", () => {
    const store = useUIStore.getState();
    expect(store.activeTab).toBe("traffic");

    store.setActiveTab("rules");
    let state = useUIStore.getState();
    expect(state.activeTab).toBe("rules");

    store.setSettingsTab("appearance");
    state = useUIStore.getState();
    expect(state.settingsTab).toBe("appearance");
  });

  it("should handle language registration", () => {
    const store = useUIStore.getState();
    expect(store.availableLanguages.length).toBe(2);

    store.registerAvailableLanguage("ja", "日本語", "日本語", "ja-plugin-id");
    let state = useUIStore.getState();
    expect(state.availableLanguages.length).toBe(3);

    // Registering an existing language shouldn't duplicate
    state.registerAvailableLanguage("ja", "日本語2");
    state = useUIStore.getState();
    expect(state.availableLanguages.length).toBe(3);

    state.unregisterPluginLanguages("ja-plugin-id");
    state = useUIStore.getState();
    expect(state.availableLanguages.length).toBe(2);
  });

  it("should handle alert dialog", () => {
    const store = useUIStore.getState();
    const mockConfirm = vi.fn();
    const mockCancel = vi.fn();

    store.showConfirm({
      title: "Test Confirm",
      message: "Are you sure?",
      variant: "danger",
      onConfirm: mockConfirm,
      onCancel: mockCancel,
    });

    let state = useUIStore.getState();
    expect(state.alertDialog.isOpen).toBe(true);
    expect(state.alertDialog.title).toBe("Test Confirm");
    expect(state.alertDialog.message).toBe("Are you sure?");
    expect(state.alertDialog.variant).toBe("danger");

    // Test confirm click
    state.alertDialog.onConfirm();
    expect(mockConfirm).toHaveBeenCalled();
    state = useUIStore.getState();
    // Assuming closeConfirm sets isOpen to false
    expect(state.alertDialog.isOpen).toBe(false);

    // Re-open
    state.showConfirm({
      title: "Test 2",
      message: "Blah",
      onConfirm: mockConfirm,
      onCancel: mockCancel,
    });
    state = useUIStore.getState();
    expect(state.alertDialog.isOpen).toBe(true);

    // Test cancel click
    state.alertDialog.onCancel();
    expect(mockCancel).toHaveBeenCalled();
    state = useUIStore.getState();
    expect(state.alertDialog.isOpen).toBe(false);
  });

  it("should handle open/close modals and markets", () => {
    const store = useUIStore.getState();

    store.setImportModalOpen(true);
    expect(useUIStore.getState().importModalOpen).toBe(true);

    store.setSaveSessionModalOpen(true);
    expect(useUIStore.getState().saveSessionModalOpen).toBe(true);

    store.setMarketOpen(true, "theme");
    expect(useUIStore.getState().marketOpen).toBe(true);
    expect(useUIStore.getState().marketType).toBe("theme");

    store.setLogViewerOpen(true);
    expect(useUIStore.getState().logViewerOpen).toBe(true);
  });

  it("should handle draft texts", () => {
    const store = useUIStore.getState();

    store.setDraftScriptPrompt("make a cool script");
    expect(useUIStore.getState().draftScriptPrompt).toBe("make a cool script");

    store.setDraftRulePrompt("block all");
    expect(useUIStore.getState().draftRulePrompt).toBe("block all");

    store.setDraftTrafficFilter("method:GET");
    expect(useUIStore.getState().draftTrafficFilter).toBe("method:GET");

    store.setDraftScriptCode("console.log('test')");
    expect(useUIStore.getState().draftScriptCode).toBe("console.log('test')");
  });
});
