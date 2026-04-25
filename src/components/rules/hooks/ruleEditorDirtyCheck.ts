/**
 * Pure dirty-check function for the rule editor.
 *
 * Compares current editor state against the initial rule to determine
 * if unsaved changes exist.
 */
import type {
  HeaderOperation,
  HttpMethod,
  JsonModification,
  Rule,
  RuleType,
  UrlMatchType,
} from "../../../types/rules";
import {
  isMapLocalAction,
  isMapRemoteAction,
  isRewriteBodyAction,
  isThrottleAction,
} from "../../../types/rules";

export interface DirtyCheckParams {
  initialRule: Partial<Rule> | null;
  rule: Partial<Rule> | null;
  ruleGroups: Record<string, string>;
  groupId: string;
  name: string;
  ruleType: RuleType;
  urlPattern: string;
  urlMatchType: UrlMatchType;
  methods: HttpMethod[];
  requiredHeaders: Array<{
    key: string;
    value?: string;
    matchType: "contains" | "exact" | "regex";
  }>;
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

/** Check if a new (unsaved) rule has any meaningful content. */
function isNewRuleDirty(p: DirtyCheckParams): boolean {
  if (p.name.trim() !== "") return true;
  if (p.urlPattern.trim() !== "") return true;
  if (p.methods.length > 0) return true;
  if (p.requiredHeaders.length > 0) return true;

  if (p.ruleType === "map_remote" && p.targetUrl.trim() !== "") return true;
  if (p.ruleType === "map_local" && (p.localPath.trim() !== "" || p.mapLocalContent.trim() !== ""))
    return true;
  if (
    p.ruleType === "rewrite_body" &&
    (p.rewriteContent.trim() !== "" || p.rewritePattern.trim() !== "")
  )
    return true;
  if (p.ruleType === "throttle" && (p.delayMs > 0 || p.packetLoss > 0 || p.bandwidthKbps > 0))
    return true;
  if (
    p.ruleType === "rewrite_header" &&
    (p.headersRequest.length > 0 || p.headersResponse.length > 0)
  )
    return true;

  return false;
}

function extractInitialHeaders(actions: Rule["actions"]): {
  request: HeaderOperation[];
  response: HeaderOperation[];
} {
  const request: HeaderOperation[] = [];
  const response: HeaderOperation[] = [];
  for (const a of actions) {
    if ("headers" in a && a.headers) {
      if (a.headers.request) request.push(...a.headers.request);
      if (a.headers.response) response.push(...a.headers.response);
    }
  }
  return { request, response };
}

export function checkIsDirty(p: DirtyCheckParams): boolean {
  if (!p.rule?.id) return isNewRuleDirty(p);

  const ir = p.initialRule;

  // Basic fields
  if (p.name.trim() !== (ir?.name || "").trim()) return true;
  if (p.ruleType !== (ir?.type || "rewrite_body")) return true;

  const initialGid = ir?.id ? p.ruleGroups[ir.id] : undefined;
  if ((p.groupId || "Default") !== (initialGid || "Default")) return true;

  // Match fields
  const initialAtoms = ir?.match?.request || [];
  const initialUrl = initialAtoms.find((a) => a.type === "url")?.value || "";
  const initialUrlMatch =
    (initialAtoms.find((a) => a.type === "url")?.matchType as UrlMatchType) || "contains";
  if (p.urlPattern !== initialUrl) return true;
  if (p.urlMatchType !== initialUrlMatch) return true;

  const initialMethods = initialAtoms.find((a) => a.type === "method")?.value || [];
  if (
    JSON.stringify([...p.methods].sort()) !==
    JSON.stringify([...(initialMethods as string[])].sort())
  )
    return true;

  const initialHeaders =
    initialAtoms
      .filter((a) => a.type === "header")
      .map((a) => ({
        key: a.key!,
        matchType: (a.matchType as "contains" | "exact" | "regex") || "exact",
        value: a.value as string,
      })) || [];
  if (JSON.stringify(p.requiredHeaders) !== JSON.stringify(initialHeaders)) return true;

  // Action fields
  const actions = ir?.actions || [];
  const { request: initialReq, response: initialRes } = extractInitialHeaders(actions);

  if (p.ruleType === "rewrite_body") {
    const ia = actions.find(isRewriteBodyAction);
    if (p.rewriteTarget !== (ia?.target || "response")) return true;

    const iStatusCode = ia?.statusCode ?? ia?.set?.statusCode;
    const iContentType = ia?.contentType ?? ia?.set?.contentType;
    if ((p.rewriteStatusCode ?? undefined) !== (iStatusCode ?? undefined)) return true;
    if ((p.rewriteContentType ?? undefined) !== (iContentType ?? undefined)) return true;

    if (p.rewriteType === "set") {
      if (!ia?.set) return true;
      if (p.rewriteContent !== (ia.set.content || "")) return true;
    } else if (p.rewriteType === "replace") {
      if (!ia?.replace) return true;
      if (p.rewritePattern !== (ia.replace.pattern || "")) return true;
      if (p.rewriteReplacement !== (ia.replace.replacement || "")) return true;
    } else if (p.rewriteType === "regex_replace") {
      if (!ia?.regex_replace) return true;
      if (p.rewritePattern !== (ia.regex_replace.pattern || "")) return true;
      if (p.rewriteReplacement !== (ia.regex_replace.replacement || "")) return true;
    } else if (p.rewriteType === "json") {
      if (!ia?.json) return true;
      if (JSON.stringify(p.jsonModifications) !== JSON.stringify(ia.json.modifications || []))
        return true;
    }
  } else if (p.ruleType === "map_local") {
    const ia = actions.find(isMapLocalAction);
    if (p.mapLocalSource !== (ia?.source || "file")) return true;
    if (p.localPath !== (ia?.localPath || "")) return true;
    if (p.mapLocalContent !== (ia?.content || "")) return true;
    if (p.contentType !== (ia?.contentType || "")) return true;
    if (p.mapLocalStatusCode !== (ia?.statusCode || 200)) return true;
    if (JSON.stringify(p.headersRequest) !== JSON.stringify(initialReq)) return true;
    if (JSON.stringify(p.headersResponse) !== JSON.stringify(initialRes)) return true;
  } else if (p.ruleType === "map_remote") {
    const ia = actions.find(isMapRemoteAction);
    if (p.targetUrl !== (ia?.targetUrl || "")) return true;
    if (p.preservePath !== (ia?.preservePath ?? false)) return true;
    if (JSON.stringify(p.headersRequest) !== JSON.stringify(initialReq)) return true;
    if (JSON.stringify(p.headersResponse) !== JSON.stringify(initialRes)) return true;
  } else if (p.ruleType === "throttle") {
    const ia = actions.find(isThrottleAction);
    if (p.delayMs !== (ia?.delayMs || 0)) return true;
    if (p.packetLoss !== (ia?.packetLoss || 0)) return true;
    if (p.bandwidthKbps !== (ia?.bandwidthKbps || 0)) return true;
  } else if (p.ruleType === "rewrite_header") {
    if (JSON.stringify(p.headersRequest) !== JSON.stringify(initialReq)) return true;
    if (JSON.stringify(p.headersResponse) !== JSON.stringify(initialRes)) return true;
  }

  return false;
}
