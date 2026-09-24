import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportRuleModal } from "./ImportRuleModal";

const { importBundle, importRulesZip, setImportModalOpen, openDialog, readTextFile, notify } =
  vi.hoisted(() => ({
    importBundle: vi.fn((_json: string): { success: boolean; count?: number; error?: string } => ({
      success: true,
      count: 1,
    })),
    importRulesZip: vi.fn(async () => ({ success: true, imported: 2, skipped: 0 })),
    setImportModalOpen: vi.fn(),
    openDialog: vi.fn(),
    readTextFile: vi.fn(),
    notify: { success: vi.fn(), error: vi.fn() },
  }));

vi.mock("../../stores/ruleStore", () => {
  const useRuleStore: any = (selector: any) => selector({ importBundle });
  useRuleStore.getState = () => ({ importBundle, importRulesZip });
  return { useRuleStore };
});

vi.mock("../../stores/uiStore", () => {
  const useUIStore: any = (selector: any) =>
    selector({ importModalOpen: true, setImportModalOpen });
  useUIStore.getState = () => ({ importModalOpen: true, setImportModalOpen });
  return { useUIStore };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDialog }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile }));
vi.mock("sonner", () => ({ toast: { loading: vi.fn(() => "t"), dismiss: vi.fn() } }));
vi.mock("../../lib/notify", () => ({ notify }));
vi.mock("../../lib/logger", () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("../common/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock("../common/Button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

const rule = {
  id: "r1",
  name: "block",
  match: { request: [{ type: "url" }] },
  actions: [{ type: "block_request" }],
};

function fillAndImport(text: string) {
  const textarea = screen.getByPlaceholderText("rules.import.placeholder");
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByText("rules.import.action"));
}

describe("ImportRuleModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports a pasted v2 bundle with ruleGroups preserved", () => {
    const data = {
      version: "2.0",
      type: "relaycraft-rules-bundle",
      timestamp: 1,
      bundle: { groups: [], rules: [rule], ruleGroups: { r1: "Default" } },
    };
    render(<ImportRuleModal />);
    fillAndImport(JSON.stringify(data));

    expect(importBundle).toHaveBeenCalledTimes(1);
    expect(JSON.parse(importBundle.mock.calls[0][0])).toEqual(data);
    expect(setImportModalOpen).toHaveBeenCalledWith(false);
  });

  it("wraps a pasted legacy single rule into a bundle", () => {
    render(<ImportRuleModal />);
    fillAndImport(JSON.stringify(rule));

    expect(importBundle).toHaveBeenCalledTimes(1);
    expect(JSON.parse(importBundle.mock.calls[0][0])).toEqual({ rules: [rule], groups: [] });
    expect(setImportModalOpen).toHaveBeenCalledWith(false);
  });

  it("does not touch the store or close the modal on invalid JSON", () => {
    render(<ImportRuleModal />);
    fillAndImport("{not json");

    expect(importBundle).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith("rules.import.invalid_json", "common.error");
    expect(setImportModalOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });

  it("rejects third-party JSON without invoking the store", () => {
    render(<ImportRuleModal />);
    fillAndImport(JSON.stringify({ swagger: "2.0", paths: {} }));

    expect(importBundle).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith("rules.import.invalid_format", "common.error");
    expect(setImportModalOpen).not.toHaveBeenCalled();
  });

  it("keeps the modal open when the store rejects the bundle", () => {
    importBundle.mockReturnValueOnce({ success: false, error: "boom" });
    render(<ImportRuleModal />);
    fillAndImport(JSON.stringify({ rules: [rule] }));

    expect(importBundle).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalledWith("boom", "common.error");
    expect(setImportModalOpen).not.toHaveBeenCalled();
  });

  it("routes .zip selection to the legacy zip importer", async () => {
    openDialog.mockResolvedValueOnce("/tmp/rules.zip");
    render(<ImportRuleModal />);
    await act(async () => {
      fireEvent.click(screen.getByText("rules.import.select"));
    });

    await vi.waitFor(() => expect(importRulesZip).toHaveBeenCalledWith("/tmp/rules.zip"));
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("loads a .json selection into the textarea without importing", async () => {
    openDialog.mockResolvedValueOnce("/tmp/rules.JSON");
    readTextFile.mockResolvedValueOnce(JSON.stringify({ rules: [rule] }));
    render(<ImportRuleModal />);
    await act(async () => {
      fireEvent.click(screen.getByText("rules.import.select"));
    });

    await vi.waitFor(() =>
      expect(screen.getByPlaceholderText("rules.import.placeholder")).toHaveValue(
        JSON.stringify({ rules: [rule] }),
      ),
    );
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file selection", async () => {
    openDialog.mockResolvedValueOnce("/tmp/rules.yaml");
    render(<ImportRuleModal />);
    await act(async () => {
      fireEvent.click(screen.getByText("rules.import.select"));
    });

    await vi.waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("rules.import.unsupported_format", "common.error"),
    );
    expect(importRulesZip).not.toHaveBeenCalled();
    expect(readTextFile).not.toHaveBeenCalled();
  });
});
