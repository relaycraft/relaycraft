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
  | "rules:read" // Read proxy rules
  | "traffic:read" // Read captured traffic flows
  | "storage:read" // Read plugin storage entries
  | "storage:write" // Modify plugin storage entries
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

export type PluginAIMessageTuple = [AIMessage["role"], string];
export type PluginAIMessageInput = AIMessage | PluginAIMessageTuple;

export interface PluginAIChatStreamOptions {
  temperature?: number;
  includeContext?: boolean;
}

export type PluginAIErrorCode = "permission" | "params" | "provider" | "timeout" | "unknown";

export interface PluginAIError extends Error {
  code: PluginAIErrorCode;
  cause?: unknown;
}

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
  /** Existing rule ID to update in place. If omitted, a new rule is created. */
  ruleId?: string;
  name: string;
  /** URL pattern (wildcard match). Example: "https://api.example.com/v1/users*" */
  urlPattern: string;
  /** Response body string (usually JSON.stringify of your mock data) */
  responseBody: string;
  /** HTTP status code, defaults to 200 */
  statusCode?: number;
  /** Content-Type header, defaults to "application/json" */
  contentType?: string;
  /** Additional response headers to set on mocked responses (except Content-Type). */
  responseHeaders?: Record<string, string>;
  /** If set, only requests with this method are matched */
  method?: string;
}

export interface AICommand {
  id: string;
  name: string;
  description: string;
  handler: (context: any) => Promise<void>;
}

// ── Traffic API types ─────────────────────────────────────────────────────────

/** Summary of a captured traffic flow, as returned by traffic.listFlows. */
export interface PluginFlowSummary {
  id: string;
  method: string;
  url: string;
  host: string;
  path: string;
  status: number | null;
  contentType: string | null;
  /** ISO-8601 timestamp when the request started. */
  startedAt: string;
  durationMs: number | null;
  sizeBytes: number | null;
  hasError: boolean;
  hasRequestBody: boolean;
  hasResponseBody: boolean;
}

/** Full detail of a single captured flow, as returned by traffic.getFlow. */
export interface PluginFlowDetail {
  id: string;
  startedAt: string;
  durationMs: number | null;
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    /** Present only when `includeBodies: true` was requested. */
    body: string | null;
    bodyTruncated: boolean;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    headers: Array<{ name: string; value: string }>;
    /** Present only when `includeBodies: true` was requested. */
    body: string | null;
    bodyTruncated: boolean;
    bodySize: number;
    mimeType: string;
  };
  /** Rule IDs that matched this flow, or null when unavailable. */
  ruleHits: string[] | null;
}

export interface SearchFlowsFilter {
  sessionId?: string;
  method?: string;
  host?: string;
  /** Substring match against the full URL. */
  urlPattern?: string;
  /** Exact code ("200"), or class prefix ("4xx", "5xx"). */
  status?: string;
  /** Pagination offset, defaults to 0. */
  offset?: number;
  /** Max flows to return. Capped at 1000, default 100. */
  limit?: number;
}

export interface PluginFlowListResult {
  flows: PluginFlowSummary[];
  /** Total matched flows in current session snapshot (before pagination). */
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

// ── Rules API types ───────────────────────────────────────────────────────────

/** Lightweight rule summary returned by rules.list. */
export interface PluginRule {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  priority: number;
  urlPattern: string;
  source: string;
  groupId: string | null;
}

// ── Host runtime type ─────────────────────────────────────────────────────────

export interface HostRuntime {
  proxyPort: number;
  proxyRunning: boolean;
  proxyActive: boolean;
  mcpEnabled: boolean;
  mcpRunning: boolean;
  mcpPort: number;
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
    chat: (messages: PluginAIMessageInput[]) => Promise<string>;
    chatStream: (
      messages: PluginAIMessageInput[],
      onChunk: (chunk: string) => void,
      options?: PluginAIChatStreamOptions,
    ) => Promise<void>;
    isEnabled: () => boolean;
  };
  stats: {
    getProcessStats: () => Promise<{
      cpu_usage: number;
      memory_usage: number;
      up_time: number;
    }>;
  };
  proxy: {
    getStatus: () => Promise<{
      running: boolean;
      active: boolean;
      active_scripts: string[];
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
    /**
     * List all rules with optional filtering.
     * Requires `rules:read` permission.
     */
    list: (filter?: { enabled?: boolean; source?: string; type?: string }) => Promise<PluginRule[]>;
    /**
     * Get a single rule by ID (full rule object).
     * Requires `rules:read` permission.
     */
    get: (id: string) => Promise<unknown>;
  };
  /**
   * Access captured traffic flows from the proxy engine.
   * Requires `traffic:read` permission.
   */
  traffic: {
    /** List flows with optional filtering and offset-based pagination. */
    listFlows: (filter?: SearchFlowsFilter) => Promise<PluginFlowListResult>;
    /** Get full details of a single flow by ID. */
    getFlow: (
      id: string,
      options?: { includeBodies?: boolean; maxBodyBytes?: number },
    ) => Promise<PluginFlowDetail>;
  };
  /**
   * Read host runtime state (proxy port, status, MCP info).
   * No permission required.
   */
  host: {
    getRuntime: () => Promise<HostRuntime>;
  };
}
