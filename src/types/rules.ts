// Rule Types and Interfaces

export type RuleType =
  | "map_local"
  | "map_remote"
  | "rewrite_header"
  | "rewrite_body"
  // 'mock_response' removed
  | "throttle"
  | "block_request";

export type UrlMatchType = "contains" | "exact" | "regex" | "wildcard";
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";

export type MatchAtomType = "url" | "host" | "path" | "method" | "header" | "query" | "port" | "ip";

export interface MatchAtom {
  type: MatchAtomType;
  matchType: UrlMatchType | "exists" | "not_exists" | "equals";
  key?: string; // For header, query
  value?: string | string[]; // string or array of strings (e.g. for methods)
  invert?: boolean;
}

// Rule Actions

export interface HeaderOperation {
  operation: "add" | "set" | "remove";
  key: string;
  value?: string;
}

export interface HeaderConfig {
  request: HeaderOperation[];
  response: HeaderOperation[];
}

export interface MapLocalAction {
  type: "map_local";
  source?: "file" | "manual";
  localPath?: string;
  content?: string;
  contentType?: string;
  statusCode?: number;
  headers?: HeaderConfig;
}

export interface MapRemoteAction {
  type: "map_remote";
  targetUrl: string;
  preservePath?: boolean;
  headers?: HeaderConfig;
}

export interface RewriteHeaderAction {
  type: "rewrite_header";
  headers: HeaderConfig;
}

export interface BodySetMode {
  content: string;
  statusCode?: number;
  contentType?: string;
}

export interface BodyReplaceMode {
  pattern: string;
  replacement: string;
}

export interface JsonModification {
  path: string;
  value: any;
  operation: "set" | "delete" | "append";
  enabled?: boolean;
}

export interface RewriteBodyAction {
  type: "rewrite_body";
  target: "request" | "response";
  statusCode?: number;
  contentType?: string;
  set?: BodySetMode;
  replace?: BodyReplaceMode;
  regex_replace?: BodyReplaceMode;
  json?: {
    modifications: JsonModification[];
  };
}

export interface ThrottleAction {
  type: "throttle";
  subtype?: "delay" | "drop" | "timeout" | "reset";
  delayMs?: number;
  packetLoss?: number; // 0-100 percentage
  bandwidthKbps?: number; // Bandwidth limit in Kbps
}

export interface BlockRequestAction {
  type: "block_request";
}

export type RuleAction =
  | MapLocalAction
  | MapRemoteAction
  | RewriteHeaderAction
  | RewriteBodyAction
  | ThrottleAction
  | BlockRequestAction;

// Main Rule Interface

export interface RuleExecution {
  enabled: boolean;
  priority: number;
  stopOnMatch?: boolean;
  // times?: number; // Future
}

export interface RuleMatchConfig {
  request: MatchAtom[];
  response: MatchAtom[];
}

export interface Rule {
  id: string;
  name: string;
  execution: RuleExecution;
  match: RuleMatchConfig;
  actions: RuleAction[];
  type: RuleType; // Keeping type at top level for easy filtering/UI
  tags?: string[];
}

export interface RuleGroup {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  description?: string;
  collapsed?: boolean;
}

// Helper type guards

export function isMapLocalAction(action: RuleAction): action is MapLocalAction {
  return action.type === "map_local";
}

export function isMapRemoteAction(action: RuleAction): action is MapRemoteAction {
  return action.type === "map_remote";
}

export function isRewriteHeaderAction(action: RuleAction): action is RewriteHeaderAction {
  return action.type === "rewrite_header";
}

export function isRewriteBodyAction(action: RuleAction): action is RewriteBodyAction {
  return action.type === "rewrite_body";
}

export function isThrottleAction(action: RuleAction): action is ThrottleAction {
  return action.type === "throttle";
}

export function isBlockRequestAction(action: RuleAction): action is BlockRequestAction {
  return action.type === "block_request";
}
