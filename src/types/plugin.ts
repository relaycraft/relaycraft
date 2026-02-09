// Core Manifest Schema
export interface PluginManifest {
  // Metadata
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string | { name: string; email?: string; url?: string };
  icon?: string;
  homepage?: string;
  license?: string;
  locales?: Record<string, { name?: string; description?: string }>;

  // Compatibility
  engines?: {
    relaycraft?: string; // SemVer range e.g. ">=0.9.0"
    node?: string;
  };

  // Capabilities (The "Entry Points")
  capabilities: {
    // Domain A: UI Extensions
    ui?: {
      theme?: string; // path to theme.json
      settings_schema?: string; // path to settings.json (JSON Schema)
      entry: string; // path to entry.js
    };
    // Domain B: Traffic Processing
    logic?: {
      entry: string; // path to main.py
    };
    // [DEPRECATED] Proxy capability mapping
    proxy?: {
      script?: string;
    };
    i18n?: {
      locales: Record<string, string>; // locale_code -> file_path
      namespace?: string; // default: pluginId
    };
  };

  // Permissions (The Security Contract)
  // Required for calling restricted backend commands via RelayCraft.api.invoke
  permissions?: PluginPermission[];

  /** @deprecated Use capabilities.ui.entry or capabilities.logic.entry */
  entry?: {
    ui?: string;
    python?: string;
  };
  type?: "plugin" | "theme";
}

export type PluginPermission =
  | "proxy:read" // Read access to traffic
  | "proxy:write" // Modify access to traffic
  | "fs:read_logs" // Read application logs
  | "network:outbound" // Make external network calls
  | "ai:chat" // Access to AI Chat Completion models
  | "stats:read" // Access to system performance stats
  | string; // Future proofing

export interface PluginInfo {
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
}

// Re-export specific types from stores to keep types consolidated for API consumers
import type { PluginPage } from "../stores/pluginPageStore";
import type { Theme } from "../stores/themeStore";
import type { AIMessage } from "./ai";

export type { PluginPage, Theme };

export interface AICommand {
  id: string;
  name: string;
  description: string;
  handler: (context: any) => Promise<void>;
}

export interface SlotOptions {
  id?: string;
  component: React.ComponentType;
  order?: number;
}

export interface PluginAPI {
  ui: {
    registerPage: (page: Omit<PluginPage, "pluginId">) => void;
    registerSlot: (slotId: string, options: SlotOptions) => void;
    registerTheme: (theme: Omit<Theme, "pluginId">) => void;
    setTheme: (themeId: string) => void;
    registerLocale: (lang: string, resources: Record<string, string>) => void;
    toast: (message: string, type?: "info" | "success" | "error") => void;
    t: (key: string, options?: any) => string;
    language: string;
    onLanguageChange: (callback: (lng: string) => void) => () => void;
    components: {
      Editor: React.ComponentType<any>;
      DiffEditor: React.ComponentType<any>;
      Markdown: React.ComponentType<any>;
    };
  };
  ai: {
    chat: (messages: AIMessage[]) => Promise<string>;
  };
  stats: {
    getProcessStats: () => Promise<{
      cpu_usage: number;
      memory_usage: number;
      up_time: number;
    }>;
  };
  // Legacy support
  invoke: <T>(command: string, args?: any) => Promise<T>;
  settings: {
    get: (key?: string) => any;
  };
  log: {
    info: (message: string, context?: any) => void;
    warn: (message: string, context?: any) => void;
    error: (message: string, errorObj?: any) => void;
  };
}
