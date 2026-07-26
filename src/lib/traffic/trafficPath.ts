import type { ShareConfig } from "../../stores/settingsStore";
import type { Rule, RuleGroup } from "../../types/rules";

export interface RuleStat {
  action: string;
  count: number;
}

export interface TrafficPathModel {
  forward: { port: number; running: boolean; active: boolean };
  share: { port: number; upstreamUrl: string; listenLan: boolean } | null;
  egress: { type: "direct" | "upstream"; url: string | null };
  enabledRuleCount: number;
  ruleStats: RuleStat[];
}

/** Display order for action chips in the panel. */
const ACTION_ORDER = [
  "map_local",
  "map_remote",
  "rewrite_header",
  "rewrite_body",
  "block_request",
  "throttle",
] as const;

export function isRuleEffectiveEnabled(
  rule: Rule,
  groups: RuleGroup[],
  ruleGroups: Record<string, string>,
): boolean {
  if (!rule.execution.enabled) return false;
  const groupId = ruleGroups[rule.id];
  if (!groupId) return true;
  const group = groups.find((g) => g.id === groupId);
  return group ? group.enabled !== false : true;
}

export function buildTrafficPathModel(input: {
  proxyPort: number;
  running: boolean;
  active: boolean;
  share?: ShareConfig;
  upstreamProxy: { enabled: boolean; url: string };
  rules: Rule[];
  groups: RuleGroup[];
  ruleGroups: Record<string, string>;
}): TrafficPathModel {
  const enabledRules = input.rules.filter((r) =>
    isRuleEffectiveEnabled(r, input.groups, input.ruleGroups),
  );

  const counts = new Map<string, number>();
  for (const rule of enabledRules) {
    for (const action of rule.actions) {
      counts.set(action.type, (counts.get(action.type) ?? 0) + 1);
    }
  }
  const ruleStats = ACTION_ORDER.filter((a) => counts.has(a)).map((a) => ({
    action: a,
    count: counts.get(a) ?? 0,
  }));

  const shareEnabled = input.share?.enabled === true && input.share.upstream_url.trim() !== "";

  const upstreamUrl = input.upstreamProxy.url.trim();

  return {
    forward: { port: input.proxyPort, running: input.running, active: input.active },
    share: shareEnabled
      ? {
          port: input.share?.port ?? 9080,
          upstreamUrl: input.share?.upstream_url.trim() ?? "",
          listenLan: input.share?.listen_lan ?? false,
        }
      : null,
    egress:
      input.upstreamProxy.enabled && upstreamUrl !== ""
        ? { type: "upstream", url: upstreamUrl }
        : { type: "direct", url: null },
    enabledRuleCount: enabledRules.length,
    ruleStats,
  };
}
