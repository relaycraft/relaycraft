import { info, warn, error, debug } from '@tauri-apps/plugin-log';
import { invoke } from '@tauri-apps/api/core';
import { createConsola } from "consola";

const consola = createConsola({
    level: 3, // Info
});

/**
 * Core Application Logger
 *
 * Purpose:
 * 1. Unified interface for logging throughout the frontend application.
 * 2. Bridges frontend logs to backend Rust logger via tauri-plugin-log.
 * 3. Ensures logs are persisted to file (handled by backend plugin).
 * 4. Provides beautiful console output via consola.
 *
 * Usage:
 * import { Logger } from './logger';
 * Logger.info('My component loaded', { id: 123 });
 */
export const Logger = {
    info: async (message: string, context?: any) => {
        const msg = context ? `${message} ${JSON.stringify(context)}` : message;
        if (context) {
            consola.info(message, context);
        } else {
            consola.info(message);
        }
        try {
            await info(msg);
        } catch (e) {
            consola.error('Failed to log info to backend', e);
        }
    },

    warn: async (message: string, context?: any) => {
        const msg = context ? `${message} ${JSON.stringify(context)}` : message;
        if (context) {
            consola.warn(message, context);
        } else {
            consola.warn(message);
        }
        try {
            await warn(msg);
        } catch (e) {
            consola.error('Failed to log warn to backend', e);
        }
    },

    error: async (message: string, errorObj?: any) => {
        const msg = errorObj ? `${message} Error: ${errorObj instanceof Error ? errorObj.message : JSON.stringify(errorObj)}` : message;
        if (errorObj) {
            consola.error(message, errorObj);
        } else {
            consola.error(message);
        }
        try {
            await error(msg);
        } catch (e) {
            consola.error('Failed to log error to backend', e);
        }
    },

    debug: async (message: string, context?: any) => {
        // Only log debug in development or if specifically enabled
        if (import.meta.env.PROD) return;

        const msg = context ? `${message} ${JSON.stringify(context)}` : message;
        if (context) {
            consola.debug(message, context);
        } else {
            consola.debug(message);
        }
        try {
            await debug(msg);
        } catch (e) {
            consola.error('Failed to log debug to backend', e);
        }
    },

    /**
     * Log to audit.log (Sensitive Operations)
     */
    audit: async (message: string, context?: any) => {
        const msg = context ? `${message} ${JSON.stringify(context)}` : message;
        consola.withTag("AUDIT").log(message, context || "");

        try {
            await invoke('log_domain_event', { domain: 'audit', message: msg });
        } catch (e) {
            consola.error('Failed to write audit log', e);
        }
    },

    /**
     * Log to script.log (User Script Output)
     */
    script: async (message: string, scriptName?: string) => {
        const msg = scriptName ? `[${scriptName}] ${message}` : message;
        // Don't clutter console too much, maybe just standard log
        consola.withTag("SCRIPT").log(message);

        try {
            await invoke('log_domain_event', { domain: 'script', message: msg });
        } catch (e) {
            consola.error('Failed to write script log', e);
        }
    },

    /**
     * Log to plugin.log (Plugin System Output)
     */
    plugin: async (message: string, pluginId?: string) => {
        const msg = pluginId ? `[${pluginId}] ${message}` : message;
        consola.withTag("PLUGIN").log(message);

        try {
            await invoke('log_domain_event', { domain: 'plugin', message: msg });
        } catch (e) {
            consola.error('Failed to write plugin log', e);
        }
    }
};
