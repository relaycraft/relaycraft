import { beforeEach, describe, expect, it } from "vitest";
import { type CommandAction, type SuggestionItem, useCommandStore } from "./commandStore";

describe("commandStore", () => {
  beforeEach(() => {
    // Reset store before each test
    useCommandStore.setState({
      isOpen: false,
      input: "",
      suggestions: [],
      history: [],
      lastAction: null,
    });
  });

  it("should open and close the command palette", () => {
    const store = useCommandStore.getState();

    store.setIsOpen(true);
    let state = useCommandStore.getState();
    expect(state.isOpen).toBe(true);

    // closing should reset input and lastAction
    state.setInput("test input");
    state.setLastAction({ intent: "NAVIGATE", confidence: 1 });
    state = useCommandStore.getState();
    expect(state.input).toBe("test input");
    expect(state.lastAction).not.toBeNull();

    state.setIsOpen(false);
    state = useCommandStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.input).toBe("");
    expect(state.lastAction).toBeNull();
  });

  it("should update input text", () => {
    const store = useCommandStore.getState();
    store.setInput("new input");

    const state = useCommandStore.getState();
    expect(state.input).toBe("new input");
  });

  it("should set last action", () => {
    const action: CommandAction = {
      intent: "SEARCH_TRAFFIC",
      confidence: 0.9,
      params: { query: "api" },
    };

    const store = useCommandStore.getState();
    store.setLastAction(action);

    const state = useCommandStore.getState();
    expect(state.lastAction).toEqual(action);
  });

  it("should set suggestions", () => {
    const suggestions: SuggestionItem[] = [
      { label: "Settings", action: "settings", group: "navigation", score: 1 },
      { label: "Clear", action: "clear", group: "action", score: 0.8 },
    ];

    const store = useCommandStore.getState();
    store.setSuggestions(suggestions);

    const state = useCommandStore.getState();
    expect(state.suggestions).toEqual(suggestions);
  });

  it("should add command to history and maintain max 20 items", () => {
    const store = useCommandStore.getState();

    store.addHistory("first command");
    let state = useCommandStore.getState();
    expect(state.history.length).toBe(1);
    expect(state.history[0]).toBe("first command");

    // Add 25 more commands
    for (let i = 0; i < 25; i++) {
      state.addHistory(`command ${i}`);
      state = useCommandStore.getState();
    }

    state = useCommandStore.getState();
    expect(state.history.length).toBe(20);
    expect(state.history[0]).toBe("command 24"); // Most recent
    expect(state.history[19]).toBe("command 5"); // Oldest in history
  });

  it("should reset input and last action", () => {
    const store = useCommandStore.getState();
    store.setInput("test");
    store.setLastAction({ intent: "CHAT", confidence: 1 });

    let state = useCommandStore.getState();
    expect(state.input).toBe("test");
    expect(state.lastAction).not.toBeNull();

    state.reset();
    state = useCommandStore.getState();
    expect(state.input).toBe("");
    expect(state.lastAction).toBeNull();
  });
});
