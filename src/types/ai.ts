export type AIContextBudgetProfile =
  | "default"
  | "command_center"
  | "rule_assistant"
  | "script_assistant"
  | "store_snapshot";

export interface AIContextOptions {
  includeLogs?: boolean;
  includeHeaders?: boolean;
  includeBody?: boolean;
  maxTrafficCount?: number;
  maxChars?: number;
  budgetProfile?: AIContextBudgetProfile;
}

export interface AIContext {
  /**
   * Concise natural language summary of the system state.
   */
  summary: string;

  /**
   * Compact list of active rules for AI reference.
   */
  activeRules: {
    id: string;
    name: string;
    type: string;
    match: string;
    actionSummary: string;
  }[];

  /**
   * Names of enabled scripts.
   */
  activeScripts: string[];

  /**
   * System configuration snapshot.
   */
  system: {
    proxyPort: number;
    upstreamProxy?: string;
    version: string;
  };

  /**
   * Focus item: Detailed snapshot of the currently selected flow or rule.
   */
  selectedItem?: {
    type: "flow" | "rule";
    id: string;
    details: any; // Simplified for LLM consumption
  };

  /**
   * Enrichment: Recent traffic snapshots (Title/URL only by default).
   */
  recentTraffic?: {
    id: string;
    method: string;
    url: string;
    status?: number;
  }[];

  /**
   * Enrichment: Recent system/plugin logs.
   */
  recentLogs?: string[];

  /**
   * Active UI state.
   */
  activeTab?: string;

  /**
   * Lightweight fingerprint for cache/reuse decisions.
   */
  contextHash?: string;
}

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIToolMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  name?: string;
  tool_call_id?: string;
}

export interface AISettings {
  enabled: boolean;
  provider: string;
  profileId?: string;
  adapterMode?: string;
  apiKey: string;
  customEndpoint?: string;
  model: string;
  maxTokens: number;
  temperature: number;
  enableCaching: boolean;
  maxHistoryMessages: number;
}

export interface AIProfileCapabilities {
  chat: boolean;
  stream: boolean;
  tools: boolean;
}

export interface AIProviderProfile {
  id: string;
  providerId: string;
  label: string;
  adapterMode: string;
  baseUrl: string;
  defaultModel: string;
  supportLevel: string;
  capabilities: AIProfileCapabilities;
}

export interface AICapabilityProbeItem {
  ok: boolean;
  message: string;
}

export interface AICapabilityProbeResult {
  profileId?: string;
  chat: AICapabilityProbeItem;
  stream: AICapabilityProbeItem;
  tools: AICapabilityProbeItem;
}

export interface FunctionParameter {
  type?: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: string[];
  properties?: Record<string, FunctionParameter>;
  required?: string[];
  items?: FunctionParameter;
  minimum?: number;
  maximum?: number;
}

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, FunctionParameter>;
    required?: string[];
  };
}

export interface Tool {
  type: "function";
  function: FunctionDefinition;
}

export type ToolChoice = "auto" | { type: "function"; function: { name: string } };

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolCompletionResult {
  content?: string | null;
  tool_calls?: ToolCall[] | null;
}

export interface StreamingToolCall {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChatCompletionChunk {
  choices: {
    delta: {
      content?: string;
      tool_calls?: StreamingToolCall[];
    };
    finish_reason?: string;
  }[];
}
