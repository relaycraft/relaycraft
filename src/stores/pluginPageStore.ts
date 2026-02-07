import { create } from 'zustand';
import React from 'react';
import { Logger } from '../lib/logger';

export interface PluginPage {
    id: string;
    name: string;
    nameKey?: string; // Optional translation key for dynamic localization
    i18nNamespace?: string; // Plugin's i18n namespace (defaults to pluginId)
    icon?: React.ComponentType<{ className?: string }>;
    route: string;
    component: React.ComponentType;
    pluginId: string;
    order?: number;
}

interface PluginPageStore {
    pages: PluginPage[];
    registerPage: (page: Omit<PluginPage, 'pluginId'>, pluginId: string) => void;
    unregisterPluginPages: (pluginId: string) => void;
}

export const usePluginPageStore = create<PluginPageStore>((set) => ({
    pages: [],

    registerPage: (page, pluginId) => {
        set((state) => {
            // Avoid duplicates
            if (state.pages.some(p => p.id === page.id)) return state;

            const newPage = { ...page, pluginId };
            const newPages = [...state.pages, newPage].sort((a, b) => (a.order || 99) - (b.order || 99));

            return { pages: newPages };
        });
    },

    unregisterPluginPages: (pluginId) => {
        set((state) => {
            const count = state.pages.filter(p => p.pluginId === pluginId).length;
            Logger.debug(`[PluginPageStore] Unregistering ${count} pages for plugin ${pluginId}`);
            return {
                pages: state.pages.filter(p => p.pluginId !== pluginId)
            };
        });
    }
}));
