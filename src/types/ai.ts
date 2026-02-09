export interface AIContextOptions {
  includeLogs?: boolean;
  includeHeaders?: boolean;
  includeBody?: boolean;
  maxTrafficCount?: number;
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
}

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AISettings {
  enabled: boolean;
  provider: string;
  apiKey: string;
  customEndpoint?: string;
  model: string;
  maxTokens: number;
  temperature: number;
  enableCaching: boolean;
  maxHistoryMessages: number;
}

export interface ChatCompletionChunk {
  choices: {
    delta: {
      content?: string;
    };
    finish_reason?: string;
  }[];
}
