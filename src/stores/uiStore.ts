import { create } from 'zustand';

interface AlertDialogState {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    variant: 'danger' | 'warning' | 'info' | 'success';
    onConfirm: () => void;
    onCancel: () => void;
}

export type TabType = 'traffic' | 'rules' | 'scripts' | 'plugins' | 'certificate' | 'settings' | 'composer';
export type Language = 'zh' | 'en';
export type SettingsTabType = 'general' | 'appearance' | 'network' | 'ai' | 'plugins' | 'certificate' | 'about';

interface UIStore {
    activeTab: TabType;
    setActiveTab: (tab: TabType) => void;
    settingsTab: SettingsTabType;
    setSettingsTab: (tab: SettingsTabType) => void;
    availableLanguages: { value: string; label: string; triggerLabel?: string; pluginId?: string }[];
    registerAvailableLanguage: (lang: string, label?: string, triggerLabel?: string, pluginId?: string) => void;
    unregisterPluginLanguages: (pluginId: string) => void;
    alertDialog: AlertDialogState;
    importModalOpen: boolean;
    setImportModalOpen: (open: boolean) => void;
    saveSessionModalOpen: boolean;
    setSaveSessionModalOpen: (open: boolean) => void;
    showConfirm: (options: {
        title: string;
        message: string;
        confirmLabel?: string;
        cancelLabel?: string;
        variant?: 'danger' | 'warning' | 'info' | 'success';
        onConfirm: () => void;
        onCancel?: () => void;
    }) => void;
    closeConfirm: () => void;
    draftScriptPrompt: string | null;
    setDraftScriptPrompt: (prompt: string | null) => void;
    draftScriptCode: string | null;
    setDraftScriptCode: (code: string | null) => void;
    marketOpen: boolean;
    marketType: 'plugin' | 'theme';
    setMarketOpen: (open: boolean, type?: 'plugin' | 'theme') => void;
    isMac: boolean;
    setOsType: (isMac: boolean) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
    activeTab: 'traffic',
    setActiveTab: (tab) => set({ activeTab: tab }),
    settingsTab: 'general',
    setSettingsTab: (tab) => set({ settingsTab: tab }),
    isMac: typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent),
    setOsType: (isMac) => set({ isMac }),
    availableLanguages: [
        { value: 'en', label: 'English', triggerLabel: 'English' },
        { value: 'zh', label: '简体中文', triggerLabel: '简体中文' }
    ],
    registerAvailableLanguage: (lang, label, triggerLabel, pluginId) => {
        set((state) => {
            if (state.availableLanguages.some(l => l.value === lang)) return state;
            return {
                availableLanguages: [...state.availableLanguages, {
                    value: lang,
                    label: label || lang.toUpperCase(),
                    triggerLabel: triggerLabel || label || lang.toUpperCase(),
                    pluginId
                }]
            };
        });
    },
    unregisterPluginLanguages: (pluginId) => {
        set((state) => {
            // Logger.debug(`[UIStore] Unregistering languages for plugin ${pluginId}`);
            return {
                availableLanguages: state.availableLanguages.filter(l => l.pluginId !== pluginId)
            };
        });
    },
    alertDialog: {
        isOpen: false,
        title: '',
        message: '',
        confirmLabel: '',
        cancelLabel: '',
        variant: 'info',
        onConfirm: () => { },
        onCancel: () => { },
    },
    importModalOpen: false,
    setImportModalOpen: (open) => set({ importModalOpen: open }),
    saveSessionModalOpen: false,
    setSaveSessionModalOpen: (open) => set({ saveSessionModalOpen: open }),
    showConfirm: (options) => {
        set({
            alertDialog: {
                isOpen: true,
                title: options.title,
                message: options.message,
                confirmLabel: options.confirmLabel || '',
                cancelLabel: options.cancelLabel || '',
                variant: options.variant || 'info',
                onConfirm: () => {
                    options.onConfirm();
                    get().closeConfirm();
                },
                onCancel: () => {
                    options.onCancel?.();
                    get().closeConfirm();
                },
            },
        });
    },
    closeConfirm: () => {
        set((state) => ({
            alertDialog: { ...state.alertDialog, isOpen: false },
        }));
    },
    draftScriptPrompt: null,
    setDraftScriptPrompt: (draftScriptPrompt) => set({ draftScriptPrompt }),
    draftScriptCode: null,
    setDraftScriptCode: (draftScriptCode) => set({ draftScriptCode }),
    marketOpen: false,
    marketType: 'plugin',
    setMarketOpen: (open, type) => set((state) => ({
        marketOpen: open,
        marketType: type || state.marketType
    })),
}));
