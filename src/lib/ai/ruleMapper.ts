import { getNextRulePriority } from "../../stores/ruleStore";
import type { MatchAtom, Rule, RuleAction } from "../../types/rules";

/** Loose match atom shapes the AI may emit (legacy / hallucinated field names). */
interface LegacyMatchAtom {
  type?: string;
  matchType?: string;
  match_type?: string;
  mode?: string;
  value?: string;
  pattern?: string;
  match?: string;
  key?: string;
}

/** Legacy match shapes: bare atom array, {request,response} object, or a flat {url, mode}. */
type AIRuleMatch =
  | LegacyMatchAtom[]
  | { request?: LegacyMatchAtom[]; response?: LegacyMatchAtom[] }
  | { url?: string; mode?: string };

/**
 * AI action payloads conform to RuleAction but may additionally carry
 * legacy V2 rewrite_body fields that are normalized below.
 */
type AIRuleAction = RuleAction &
  Partial<{
    rewriteType: "set" | "replace";
    content: string;
    statusCode: number;
    contentType: string;
    pattern: string;
    replacement: string;
  }>;

export interface AIRule extends Partial<Omit<Rule, "match" | "actions">> {
  /** Legacy flat execution fields (older prompts may emit these at top level) */
  enabled?: boolean;
  priority?: number;
  stopOnMatch?: boolean;
  /** Legacy match shapes (array / object / flat {url}) */
  match?: AIRuleMatch;
  actions?: AIRuleAction[];
  /** Legacy single-action shape */
  action?: RuleAction;
}

/**
 * Maps the AI rule format (strict or legacy) to the internal application Rule structure.
 * This is the single normalization entry point for AI-generated rules
 * (both the parseAIResponse path and the function-calling path funnel through here).
 */
export function mapAIRuleToInternal(aiRule: AIRule): Partial<Rule> {
  if (!aiRule) return { type: "block_request" };

  // 1. Base Mapping
  const baseRule: Partial<Rule> = {
    name: aiRule.name || "AI Suggested Rule",
    type: aiRule.type || "block_request",
    execution: {
      enabled: aiRule.execution?.enabled ?? aiRule.enabled ?? true,
      priority: aiRule.execution?.priority ?? aiRule.priority ?? getNextRulePriority(),
      stopOnMatch: aiRule.execution?.stopOnMatch ?? aiRule.stopOnMatch ?? true,
    },
    match: {
      request: [],
      response: [],
    },
    actions: [],
    // Mark all rules created via the built-in AI assistant
    metadata: { source: "ai_assistant" },
  };

  // 2. Normalize Match (Handle Array vs Object)
  if (Array.isArray(aiRule.match)) {
    baseRule.match!.request = aiRule.match.map(
      (m) =>
        ({
          ...m,
          // Map 'path' or 'host' to 'url' if it's the only match to ensure UI compatibility
          type: m.type === "path" || m.type === "host" ? "url" : m.type,
        }) as MatchAtom,
    );
  } else if (aiRule.match && typeof aiRule.match === "object") {
    const matchObj = aiRule.match as {
      request?: LegacyMatchAtom[];
      response?: LegacyMatchAtom[];
      url?: string;
      mode?: string;
    };
    if (matchObj.request || matchObj.response) {
      baseRule.match = {
        request: (matchObj.request || []).map(
          (m) =>
            ({
              ...m,
              type: m.type === "path" || m.type === "host" ? "url" : m.type,
              matchType: m.matchType || m.match_type || m.mode || "contains",
              value: m.value || m.pattern || m.match || "",
            }) as MatchAtom,
        ),
        response: (matchObj.response || []).map(
          (m) =>
            ({
              ...m,
              matchType: m.matchType || m.match_type || m.mode || "contains",
              value: m.value || m.pattern || m.match || "",
            }) as MatchAtom,
        ),
      };
    } else {
      // Legacy conversion
      if (matchObj.url) {
        baseRule.match!.request.push({
          type: "url",
          matchType: (matchObj.mode || "contains") as MatchAtom["matchType"],
          value: matchObj.url,
        });
      }
    }
  }

  // 3. Normalize Actions (Handle Array vs Object)
  if (Array.isArray(aiRule.actions)) {
    baseRule.actions = aiRule.actions.map((a) => {
      const action: AIRuleAction = { ...a };
      // Simple V2 -> V3 for common hallucinations
      if (
        action.type === "rewrite_body" &&
        action.rewriteType &&
        !action.set &&
        !action.replace &&
        !action.regex_replace &&
        !action.json
      ) {
        const rt = action.rewriteType;
        if (rt === "set") {
          action.set = {
            content: action.content || "",
            statusCode: action.statusCode,
            contentType: action.contentType,
          };
        } else if (rt === "replace") {
          action.replace = {
            pattern: action.pattern || "",
            replacement: action.replacement || "",
          };
        }
        delete action.rewriteType;
        delete action.content;
        delete action.statusCode;
        delete action.contentType;
        delete action.pattern;
        delete action.replacement;
      }
      return action;
    });
  } else if (aiRule.action) {
    baseRule.actions!.push(aiRule.action);
  }

  // 4. Fallback if empty (should not happen with strict prompt)
  if (
    !baseRule.match ||
    (baseRule.match.request.length === 0 && baseRule.match.response.length === 0)
  ) {
    // Default to match all if missing? Or leave empty.
  }

  // 5. Ensure actions array exists
  if (!baseRule.actions) {
    baseRule.actions = [];
  }

  return baseRule;
}
