import { create } from 'zustand';

export type CommandIntent =
    | 'NAVIGATE'
    | 'CREATE_RULE'
    | 'CREATE_SCRIPT'
    | 'TOGGLE_PROXY'
    | 'SEARCH_TRAFFIC'
    | 'CLEAR_TRAFFIC'
    | 'OPEN_SETTINGS'
    | 'GENERATE_REQUEST'
    | 'CHAT';

export interface CommandAction {
    intent: CommandIntent;
    params?: any;
    confidence: number;
    explanation?: string;
}

export interface SuggestionItem {
    label: string;
    action: string;
    description?: string;
    group: 'history' | 'navigation' | 'action' | 'ai';
    score: number;
    metadata?: any;
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
    input: '',
    suggestions: [],
    history: [],
    lastAction: null,

    setIsOpen: (open) => set({ isOpen: open, input: open ? '' : '', lastAction: null }),
    setInput: (input) => set({ input }),
    setLastAction: (action) => set({ lastAction: action }),
    setSuggestions: (suggestions) => set({ suggestions }),
    addHistory: (command) => set((state) => ({
        history: [command, ...state.history.slice(0, 19)]
    })),
    reset: () => set({ input: '', lastAction: null })
}));
