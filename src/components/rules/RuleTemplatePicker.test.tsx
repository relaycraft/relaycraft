import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuleTemplatePicker } from "./RuleTemplatePicker";

const { selectRule, setDraftRule, showConfirm, getNextRulePriority } = vi.hoisted(() => ({
  selectRule: vi.fn(),
  setDraftRule: vi.fn(),
  showConfirm: vi.fn(),
  getNextRulePriority: vi.fn(() => 7),
}));

const ruleStoreState = { isEditorDirty: false };

vi.mock("../../stores/ruleStore", () => ({
  useRuleStore: {
    getState: () => ({
      isEditorDirty: ruleStoreState.isEditorDirty,
      selectRule,
      setDraftRule,
    }),
  },
  getNextRulePriority,
}));

vi.mock("../../stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({ showConfirm }),
  },
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const BLOCK_NAME = "rules.templates.block_request.name";
const MOCK_NAME = "rules.templates.map_local_json.name";

describe("RuleTemplatePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ruleStoreState.isEditorDirty = false;
  });

  it("opens the picker and lists exactly the two curated templates", () => {
    render(<RuleTemplatePicker />);
    fireEvent.click(screen.getByText("rules.templates.btn"));

    const modal = screen.getByTestId("modal");
    expect(modal).toHaveTextContent(BLOCK_NAME);
    expect(modal).toHaveTextContent(MOCK_NAME);
    expect(modal).toHaveTextContent("rules.templates.warning");
  });

  it("loads a fresh disabled draft into the editor on choose", () => {
    render(<RuleTemplatePicker />);
    fireEvent.click(screen.getByText("rules.templates.btn"));
    fireEvent.click(screen.getByText(BLOCK_NAME));

    expect(selectRule).toHaveBeenCalledWith(null);
    expect(setDraftRule).toHaveBeenCalledTimes(1);

    const draft = setDraftRule.mock.calls[0][0];
    expect(draft.type).toBe("block_request");
    expect(draft.name).toBe(BLOCK_NAME);
    expect(draft.id).toBeUndefined();
    expect(draft.metadata).toBeUndefined();
    expect(draft.execution.enabled).toBe(false);
    expect(draft.execution.stopOnMatch).toBe(true);
    expect(draft.match.request).toEqual([
      { type: "url", matchType: "exact", value: "https://example.com/blocked" },
    ]);
    expect(draft.actions).toEqual([{ type: "block_request" }]);

    // Picker closed after choosing.
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  it("applies the map_local_json template with the manual JSON action", () => {
    render(<RuleTemplatePicker />);
    fireEvent.click(screen.getByText("rules.templates.btn"));
    fireEvent.click(screen.getByText(MOCK_NAME));

    const draft = setDraftRule.mock.calls[0][0];
    expect(draft.type).toBe("map_local");
    expect(draft.actions).toEqual([
      {
        type: "map_local",
        source: "manual",
        content: '{"message":"hello"}',
        contentType: "application/json",
        statusCode: 200,
      },
    ]);
    expect(draft.execution.enabled).toBe(false);
  });

  it("defers to the dirty-editor confirmation instead of clobbering edits", () => {
    ruleStoreState.isEditorDirty = true;
    render(<RuleTemplatePicker />);
    fireEvent.click(screen.getByText("rules.templates.btn"));
    fireEvent.click(screen.getByText(BLOCK_NAME));

    // Nothing applied yet — the confirmation owns the decision.
    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(setDraftRule).not.toHaveBeenCalled();
    expect(selectRule).not.toHaveBeenCalled();
    expect(showConfirm.mock.calls[0][0].variant).toBe("warning");

    // User confirms → draft is applied and picker closes.
    act(() => {
      showConfirm.mock.calls[0][0].onConfirm();
    });
    expect(selectRule).toHaveBeenCalledWith(null);
    expect(setDraftRule).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });
});
