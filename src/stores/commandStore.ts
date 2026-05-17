import { create } from "zustand";
import type { SettingsTabType } from "./uiStore";

export type CommandIntent =
  | "NAVIGATE"
  | "CREATE_RULE"
  | "CREATE_SCRIPT"
  | "TOGGLE_PROXY"
  | "SEARCH_TRAFFIC"
  | "CLEAR_TRAFFIC"
  | "FILTER_TRAFFIC"
  | "OPEN_SETTINGS"
  | "GENERATE_REQUEST"
  | "CHAT";

export type CommandRoutingLayer = "direct_command" | "guided_action" | "conversation";

export type CommandRequestBodyType = "none" | "raw" | "x-www-form-urlencoded";

export interface CommandHeaderParam {
  key: string;
  value: string;
}

export interface CommandParams {
  path?: string;
  action?: "start" | "stop";
  category?: SettingsTabType;
  requirement?: string;
  description?: string;
  message?: string;
  name?: string;
  query?: string;
  method?: string;
  url?: string;
  headers?: CommandHeaderParam[];
  body?: string;
  bodyType?: CommandRequestBodyType;
}

export interface CommandAction {
  intent: CommandIntent;
  params?: CommandParams;
  confidence: number;
  explanation?: string;
  executionMode?: "auto" | "confirm";
  layer?: CommandRoutingLayer;
}

export interface SuggestionItem {
  label: string;
  action: string;
  description?: string;
  group: "history" | "navigation" | "action" | "ai";
  score: number;
  metadata?: Record<string, unknown>;
}

interface CommandStore {
  isOpen: boolean;
  input: string;
  suggestions: SuggestionItem[];
  history: string[];
  lastAction: CommandAction | null;

  setIsOpen: (open: boolean) => void;
  setInput: (input: string) => void;
  setLastAction: (action: CommandAction | null) => void;
  setSuggestions: (suggestions: SuggestionItem[]) => void;
  addHistory: (command: string) => void;
  reset: () => void;
}

export const useCommandStore = create<CommandStore>((set) => ({
  isOpen: false,
  input: "",
  suggestions: [],
  history: [],
  lastAction: null,

  setIsOpen: (open) => set({ isOpen: open, input: open ? "" : "", lastAction: null }),
  setInput: (input) => set({ input }),
  setLastAction: (action) => set({ lastAction: action }),
  setSuggestions: (suggestions) => set({ suggestions }),
  addHistory: (command) =>
    set((state) => ({
      history: [command, ...state.history.slice(0, 19)],
    })),
  reset: () => set({ input: "", lastAction: null }),
}));
