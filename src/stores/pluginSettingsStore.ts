import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { persist } from 'zustand/middleware';
import { Logger } from '../lib/logger';

interface PluginSettingsState {
    // pluginId -> schema object
    schemas: Record<string, any>;
    // pluginId -> settings object
    settings: Record<string, any>;

    loading: boolean;
    error: string | null;

    loadSchema: (pluginId: string, schemaPath: string) => Promise<void>;
    loadSettings: (pluginId: string) => Promise<void>;
    saveSettings: (pluginId: string, settings: any) => Promise<void>;
    getSettings: (pluginId: string) => any;
}

export const usePluginSettingsStore = create<PluginSettingsState>()(
    persist(
        (set, get) => ({
            schemas: {},
            settings: {},
            loading: false,
            error: null,

            loadSchema: async (pluginId, schemaPath) => {
                if (get().schemas[pluginId]) return; // Already loaded

                set({ loading: true, error: null });
                try {
                    Logger.debug(`[PluginSettings] Loading schema for ${pluginId} from ${schemaPath}`);
                    const schemaContent = await invoke<string>('read_plugin_file', {
                        pluginId,
                        fileName: schemaPath
                    });

                    const schema = JSON.parse(schemaContent);
                    set(state => ({
                        schemas: { ...state.schemas, [pluginId]: schema },
                        loading: false
                    }));
                } catch (err: any) {
                    Logger.error(`[PluginSettings] Failed to load schema:`, err);
                    set({ loading: false, error: err.message || 'Failed to load schema' });
                }
            },

            loadSettings: async (pluginId) => {
                set({ loading: true });
                try {
                    // Use local state (handled by persist middleware automatically)
                    // Sync with backend via invoke if available
                    const backendConfig = await invoke<any>('get_plugin_config', { pluginId }).catch(() => null);

                    if (backendConfig) {
                        set(state => ({
                            settings: { ...state.settings, [pluginId]: backendConfig },
                            loading: false
                        }));
                    } else {
                        set({ loading: false });
                    }

                } catch (err) {
                    set({ loading: false });
                }
            },

            saveSettings: async (pluginId, newSettings) => {
                // Update local state
                set(state => ({
                    settings: { ...state.settings, [pluginId]: newSettings }
                }));

                // Persist to backend
                try {
                    await invoke('save_plugin_config', { pluginId, config: newSettings });
                } catch (err) {
                    Logger.error('Failed to save plugin config to backend:', err);
                    // Decide if we revert state or just warn
                }
            },

            getSettings: (pluginId) => {
                return get().settings[pluginId] || {};
            }
        }),
        {
            name: 'relaycraft-plugin-settings',
            partialize: (state) => ({ settings: state.settings }), // Only persist settings, reload schemas
        }
    )
);
