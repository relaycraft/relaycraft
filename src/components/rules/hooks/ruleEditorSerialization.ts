/**
 * Pure serialization functions for the rule editor.
 *
 * These build Rule/RuleAction objects from flat editor state, used by both
 * the preview (getCurrentRuleObject) and save (handleSave) paths.
 */
import { getNextRulePriority } from "../../../stores/ruleStore";
import type {
  HeaderOperation,
  HttpMethod,
  JsonModification,
  MatchAtom,
  RewriteBodyAction,
  Rule,
  RuleAction,
  RuleType,
  UrlMatchType,
} from "../../../types/rules";
import {
  isMapLocalAction,
  isMapRemoteAction,
  isRewriteBodyAction,
  isThrottleAction,
} from "../../../types/rules";

// ---- Match Request ----

export function buildMatchRequest(
  urlPattern: string,
  urlMatchType: UrlMatchType,
  methods: HttpMethod[],
  requiredHeaders: Array<{
    key: string;
    value?: string;
    matchType: "contains" | "exact" | "regex";
  }>,
): MatchAtom[] {
  const atoms: MatchAtom[] = [{ type: "url", matchType: urlMatchType, value: urlPattern }];
  if (methods.length > 0) {
    atoms.push({ type: "method", matchType: "exact", value: methods });
  }
  for (const h of requiredHeaders) {
    atoms.push({ type: "header", key: h.key, matchType: h.matchType, value: h.value });
  }
  return atoms;
}

// ---- Action Building ----

export interface RewriteBodyState {
  target: "request" | "response";
  type: "set" | "replace" | "regex_replace" | "json";
  content: string;
  pattern: string;
  replacement: string;
  modifications: JsonModification[];
  statusCode?: number;
  contentType?: string;
}

export interface MapLocalState {
  source: "file" | "manual";
  localPath: string;
  content: string;
  contentType: string;
  statusCode: number;
}

export interface MapRemoteState {
  targetUrl: string;
  preservePath?: boolean;
}

export interface ThrottleState {
  delayMs: number;
  packetLoss: number;
  bandwidthKbps: number;
}

export interface ActionState {
  rewriteBody: RewriteBodyState;
  mapLocal: MapLocalState;
  mapRemote: MapRemoteState;
  throttle: ThrottleState;
  headersRequest: HeaderOperation[];
  headersResponse: HeaderOperation[];
}

function buildRewriteBodyAction(s: RewriteBodyState): RewriteBodyAction {
  const action: RewriteBodyAction = {
    type: "rewrite_body",
    target: s.target,
    statusCode: s.statusCode,
    contentType: s.contentType,
  };
  if (s.type === "set") {
    action.set = { content: s.content };
  } else if (s.type === "replace") {
    action.replace = { pattern: s.pattern, replacement: s.replacement };
  } else if (s.type === "regex_replace") {
    action.regex_replace = { pattern: s.pattern, replacement: s.replacement };
  } else if (s.type === "json") {
    action.json = { modifications: s.modifications.filter((m) => m.path.trim() !== "") };
  }
  return action;
}

/**
 * Build actions for *preview* (getCurrentRuleObject / AI context).
 * Headers are bundled inline with map_local/map_remote.
 */
export function buildActionsForPreview(ruleType: RuleType, s: ActionState): RuleAction[] {
  const actions: RuleAction[] = [];
  const sharedHeaders =
    s.headersRequest.length > 0 || s.headersResponse.length > 0
      ? { request: s.headersRequest, response: s.headersResponse }
      : undefined;

  if (ruleType === "rewrite_body") {
    actions.push(buildRewriteBodyAction(s.rewriteBody));
  } else if (ruleType === "map_local") {
    actions.push({
      type: "map_local",
      source: s.mapLocal.source,
      localPath: s.mapLocal.source === "file" ? s.mapLocal.localPath : undefined,
      content: s.mapLocal.source === "manual" ? s.mapLocal.content : undefined,
      contentType: s.mapLocal.contentType || undefined,
      statusCode: s.mapLocal.statusCode,
      headers: sharedHeaders,
    });
  } else if (ruleType === "map_remote") {
    actions.push({
      type: "map_remote",
      targetUrl: s.mapRemote.targetUrl,
      preservePath: s.mapRemote.preservePath,
      headers: sharedHeaders,
    });
  } else if (ruleType === "throttle") {
    actions.push({
      type: "throttle",
      delayMs: s.throttle.delayMs > 0 ? s.throttle.delayMs : undefined,
      packetLoss: s.throttle.packetLoss > 0 ? s.throttle.packetLoss : undefined,
      bandwidthKbps: s.throttle.bandwidthKbps > 0 ? s.throttle.bandwidthKbps : undefined,
    });
  } else if (ruleType === "rewrite_header") {
    actions.push({
      type: "rewrite_header",
      headers: { request: s.headersRequest, response: s.headersResponse },
    });
  } else if (ruleType === "block_request") {
    actions.push({ type: "block_request" });
  }

  return actions;
}

/**
 * Build actions for *save*. Differs from preview only for map_local,
 * which splits request headers into a separate rewrite_header action.
 */
export function buildActionsForSave(ruleType: RuleType, s: ActionState): RuleAction[] {
  if (ruleType === "map_local" && s.headersRequest.length > 0) {
    // Split: request headers → separate rewrite_header, response headers stay inline
    const actions: RuleAction[] = [
      { type: "rewrite_header", headers: { request: s.headersRequest, response: [] } },
      {
        type: "map_local",
        source: s.mapLocal.source,
        localPath: s.mapLocal.source === "file" ? s.mapLocal.localPath : undefined,
        content: s.mapLocal.source === "manual" ? s.mapLocal.content : undefined,
        contentType: s.mapLocal.contentType || undefined,
        statusCode: s.mapLocal.statusCode,
        headers:
          s.headersResponse.length > 0 ? { request: [], response: s.headersResponse } : undefined,
      },
    ];
    return actions;
  }
  return buildActionsForPreview(ruleType, s);
}

// ---- Full Rule Assembly ----

export function buildRuleForPreview(
  existingRule: Partial<Rule> | null,
  name: string,
  ruleType: RuleType,
  matchRequest: MatchAtom[],
  actions: RuleAction[],
): Partial<Rule> {
  return {
    id: existingRule?.id,
    name,
    type: ruleType,
    execution: {
      enabled: existingRule?.execution?.enabled ?? true,
      priority: existingRule?.execution?.priority ?? getNextRulePriority(),
      stopOnMatch: ["map_local", "block_request"].includes(ruleType),
    },
    match: { request: matchRequest, response: [] },
    actions,
  };
}

export function buildRuleForSave(
  existingRule: Partial<Rule> | null,
  finalName: string,
  ruleType: RuleType,
  matchRequest: MatchAtom[],
  actions: RuleAction[],
): Rule {
  return {
    id: existingRule?.id || `rule-${Date.now()}`,
    name: finalName,
    execution: {
      enabled: existingRule?.execution?.enabled ?? true,
      priority: existingRule?.execution?.priority ?? getNextRulePriority(),
      stopOnMatch: ["map_local", "block_request"].includes(ruleType),
    },
    type: ruleType,
    match: { request: matchRequest, response: [] },
    actions,
    tags: existingRule?.tags,
  };
}

// ---- Action Parsing (initialization) ----

export interface ParsedActionState {
  rewriteTarget: "request" | "response";
  rewriteType: "set" | "replace" | "regex_replace" | "json";
  rewriteContent: string;
  rewritePattern: string;
  rewriteReplacement: string;
  jsonModifications: JsonModification[];
  rewriteStatusCode?: number;
  rewriteContentType?: string;
  mapLocalSource: "file" | "manual";
  localPath: string;
  mapLocalContent: string;
  contentType: string;
  mapLocalStatusCode: number;
  headersRequest: HeaderOperation[];
  headersResponse: HeaderOperation[];
  targetUrl: string;
  preservePath: boolean;
  delayMs: number;
  packetLoss: number;
  bandwidthKbps: number;
}

export const DEFAULT_ACTION_STATE: ParsedActionState = {
  rewriteTarget: "response",
  rewriteType: "set",
  rewriteContent: "",
  rewritePattern: "",
  rewriteReplacement: "",
  jsonModifications: [],
  rewriteStatusCode: undefined,
  rewriteContentType: "",
  mapLocalSource: "file",
  localPath: "",
  mapLocalContent: "",
  contentType: "",
  mapLocalStatusCode: 200,
  headersRequest: [],
  headersResponse: [],
  targetUrl: "",
  preservePath: false,
  delayMs: 0,
  packetLoss: 0,
  bandwidthKbps: 0,
};

/** Normalize null → undefined for dirty-check consistency. */
function nullToUndef<T>(v: T | null | undefined): T | undefined {
  return v === null ? undefined : v;
}

/** Parse a list of actions into flat editor state (for initialization / sync). */
export function parseActionsToState(actions: RuleAction[]): ParsedActionState {
  const s = { ...DEFAULT_ACTION_STATE };

  for (const a of actions) {
    if (isRewriteBodyAction(a)) {
      s.rewriteTarget = a.target || "response";
      if (a.statusCode !== undefined) s.rewriteStatusCode = nullToUndef(a.statusCode);
      if (a.contentType !== undefined) s.rewriteContentType = nullToUndef(a.contentType);

      if (a.set) {
        s.rewriteType = "set";
        s.rewriteContent = a.set.content;
        if (a.statusCode === undefined && a.set.statusCode) {
          s.rewriteStatusCode = nullToUndef(a.set.statusCode);
        }
        if (a.contentType === undefined && a.set.contentType) {
          s.rewriteContentType = nullToUndef(a.set.contentType);
        }
      } else if (a.replace) {
        s.rewriteType = "replace";
        s.rewritePattern = a.replace.pattern;
        s.rewriteReplacement = a.replace.replacement;
      } else if (a.regex_replace) {
        s.rewriteType = "regex_replace";
        s.rewritePattern = a.regex_replace.pattern;
        s.rewriteReplacement = a.regex_replace.replacement;
      } else if (a.json) {
        s.rewriteType = "json";
        s.jsonModifications = a.json.modifications;
      }
    } else if (isMapLocalAction(a)) {
      s.mapLocalSource = a.source || "file";
      s.localPath = a.localPath || "";
      s.mapLocalContent = a.content || "";
      s.contentType = a.contentType || "";
      s.mapLocalStatusCode = a.statusCode || 200;
      if (a.headers) {
        if (a.headers.request.length > 0) s.headersRequest = [...a.headers.request];
        if (a.headers.response.length > 0) s.headersResponse = [...a.headers.response];
      }
    } else if (isMapRemoteAction(a)) {
      s.targetUrl = a.targetUrl || "";
      s.preservePath = a.preservePath ?? false;
      if (a.headers) {
        if (a.headers.request.length > 0) s.headersRequest = [...a.headers.request];
        if (a.headers.response.length > 0) s.headersResponse = [...a.headers.response];
      }
    } else if (isThrottleAction(a)) {
      s.delayMs = a.delayMs || 0;
      s.packetLoss = a.packetLoss || 0;
      s.bandwidthKbps = a.bandwidthKbps || 0;
    }
  }

  return s;
}
