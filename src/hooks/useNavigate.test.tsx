import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRuleStore } from "../stores/ruleStore";
import { useUIStore } from "../stores/uiStore";
import { useNavigate } from "./useNavigate";

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("useNavigate hook", () => {
  beforeEach(() => {
    // Reset stores
    useUIStore.setState({
      activeTab: "traffic",
      showConfirm: vi.fn(),
      setActiveTab: vi.fn(),
    });
    useRuleStore.setState({
      isEditorDirty: false,
      clearActiveRule: vi.fn(),
    });
    vi.clearAllMocks();
  });

  it("should navigate to a different tab directly when not on rules tab", () => {
    const setActiveTabMock = vi.fn();
    useUIStore.setState({ activeTab: "traffic", setActiveTab: setActiveTabMock });

    const { result } = renderHook(() => useNavigate());

    result.current.navigate("settings");

    expect(setActiveTabMock).toHaveBeenCalledWith("settings");
  });

  it("should do nothing if navigating to the same tab", () => {
    const setActiveTabMock = vi.fn();
    useUIStore.setState({ activeTab: "traffic", setActiveTab: setActiveTabMock });

    const { result } = renderHook(() => useNavigate());

    result.current.navigate("traffic");

    expect(setActiveTabMock).not.toHaveBeenCalled();
  });

  it("should clear active rule and navigate if leaving rules tab without dirty state", () => {
    const setActiveTabMock = vi.fn();
    const clearActiveRuleMock = vi.fn();

    useUIStore.setState({ activeTab: "rules", setActiveTab: setActiveTabMock });
    useRuleStore.setState({ isEditorDirty: false, clearActiveRule: clearActiveRuleMock });

    const { result } = renderHook(() => useNavigate());

    result.current.navigate("settings");

    expect(clearActiveRuleMock).toHaveBeenCalled();
    expect(setActiveTabMock).toHaveBeenCalledWith("settings");
  });

  it("should show confirmation dialog if leaving rules tab with dirty state", () => {
    const setActiveTabMock = vi.fn();
    const clearActiveRuleMock = vi.fn();
    const showConfirmMock = vi.fn((options) => {
      // simulate confirming the dialog
      options.onConfirm();
    });

    useUIStore.setState({
      activeTab: "rules",
      setActiveTab: setActiveTabMock,
      showConfirm: showConfirmMock,
    });
    useRuleStore.setState({
      isEditorDirty: true,
      clearActiveRule: clearActiveRuleMock,
    });

    const { result } = renderHook(() => useNavigate());

    result.current.navigate("settings");

    expect(showConfirmMock).toHaveBeenCalled();
    // After confirmation (simulated above), it should clear and navigate
    expect(clearActiveRuleMock).toHaveBeenCalled();
    expect(setActiveTabMock).toHaveBeenCalledWith("settings");
  });
});
