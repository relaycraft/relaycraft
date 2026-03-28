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
  | "rules:write" // Create / modify proxy rules
  | string; // Future proofing

export interface PluginInfo {
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
}

// Re-export specific types from stores to keep types consolidated for API consumers
import type { ComponentType } from "react";
import type { PluginContextMenuEntry, TrafficFlowSummary } from "../stores/pluginContextMenuStore";
import type { PluginPage } from "../stores/pluginPageStore";
import type { Theme } from "../stores/themeStore";
import type { AIMessage } from "./ai";

export type { PluginContextMenuEntry, PluginPage, Theme, TrafficFlowSummary };

// ── Plugin API extension types ────────────────────────────────────────────────

export interface HttpSendRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
}

/**
 * Response from `RelayCraft.api.http.send()`.
 * Field names match Rust's serde snake_case serialization.
 */
export interface HttpSendResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** `"text"` for UTF-8 bodies; `"base64"` for binary content. */
  encoding: "text" | "base64";
  truncated: boolean;
  total_bytes: number;
}

export interface ContextMenuItemConfig {
  id: string;
  label: string | (() => string);
  icon?: ComponentType<{ className?: string }>;
  when?: (flow: TrafficFlowSummary) => boolean;
  onClick: (flow: TrafficFlowSummary) => void;
}

export interface CreateMockConfig {
  name: string;
  /** URL pattern (substring match). E.g. "/api/users" */
  urlPattern: string;
  /** Response body string (usually JSON.stringify of your mock data) */
  responseBody: string;
  /** HTTP status code, defaults to 200 */
  statusCode?: number;
  /** Content-Type header, defaults to "application/json" */
  contentType?: string;
  /** If set, only requests with this method are matched */
  method?: string;
}

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
  i18n: {
    t: (key: string, options?: any) => string;
    language: string;
    onLanguageChange: (callback: (lng: string) => void) => () => void;
    registerLocale: (lang: string, resources: Record<string, string>) => void;
  };
  theme: {
    register: (theme: Omit<Theme, "pluginId">) => void;
    set: (themeId: string) => void;
  };
  ui: {
    registerPage: (page: Omit<PluginPage, "pluginId">) => void;
    registerSlot: (slotId: string, options: SlotOptions) => void;
    toast: (message: string, type?: "info" | "success" | "error") => void;
    components: {
      Editor: React.ComponentType<any>;
      DiffEditor: React.ComponentType<any>;
      Markdown: React.ComponentType<any>;
    };
    /**
     * Inject a custom item into the traffic flow right-click context menu.
     * Returns an unregister function — call it when the plugin is unloaded.
     */
    registerContextMenuItem: (config: ContextMenuItemConfig) => () => void;
  };
  ai: {
    chat: (messages: AIMessage[]) => Promise<string>;
    isEnabled: () => boolean;
  };
  stats: {
    getProcessStats: () => Promise<{
      cpu_usage: number;
      memory_usage: number;
      up_time: number;
    }>;
  };
  settings: {
    get: (key?: string) => any;
  };
  log: {
    info: (message: string, context?: any) => void;
    warn: (message: string, context?: any) => void;
    error: (message: string, errorObj?: any) => void;
  };
  /**
   * Send an HTTP request via the Rust layer (captured by the local proxy,
   * bypasses WebView CORS/CSP).
   * Requires `network:outbound` permission in the plugin manifest.
   */
  http: {
    send: (request: HttpSendRequest) => Promise<HttpSendResponse>;
  };
  /**
   * Plugin-scoped key-value storage persisted to disk.
   * Keys must match [a-zA-Z0-9-_], max 128 chars.
   * No permission required — each plugin only accesses its own namespace.
   */
  storage: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    delete: (key: string) => Promise<void>;
    list: (prefix?: string) => Promise<string[]>;
    clear: () => Promise<void>;
  };
  /**
   * Subscribe to Tauri events emitted by the host or other plugins.
   * Returns an unlisten function for cleanup.
   */
  events: {
    on: (eventName: string, callback: (payload: unknown) => void) => () => void;
  };
  /**
   * Proxy rule management helpers.
   * Requires corresponding permissions in the plugin manifest.
   */
  rules: {
    /**
     * Create a Map Local mock rule.
     * Requires `rules:write` permission.
     * `metadata.source` is automatically set to `"plugin:<pluginId>"`.
     * Returns the new rule's ID.
     */
    createMock: (config: CreateMockConfig) => Promise<string>;
  };
}
