import { describe, expect, it } from "vitest";
import type { Rule, RuleGroup } from "../../types/rules";
import { buildTrafficPathModel, isRuleEffectiveEnabled } from "./trafficPath";

function makeRule(id: string, enabled: boolean, actions: Rule["actions"]): Rule {
  return {
    id,
    name: id,
    execution: { enabled, priority: 0 },
    match: { request: [], response: [] },
    actions,
    type: "map_local",
  } as Rule;
}

const groups: RuleGroup[] = [
  { id: "g1", name: "G1", enabled: true, priority: 0 },
  { id: "g2", name: "G2", enabled: false, priority: 1 },
];

describe("isRuleEffectiveEnabled", () => {
  it("is enabled when rule enabled and group enabled", () => {
    expect(isRuleEffectiveEnabled(makeRule("r1", true, []), groups, { r1: "g1" })).toBe(true);
  });

  it("is disabled when its group is disabled", () => {
    expect(isRuleEffectiveEnabled(makeRule("r1", true, []), groups, { r1: "g2" })).toBe(false);
  });

  it("is disabled when rule itself is disabled", () => {
    expect(isRuleEffectiveEnabled(makeRule("r1", false, []), groups, { r1: "g1" })).toBe(false);
  });

  it("is enabled when the rule has no group mapping", () => {
    expect(isRuleEffectiveEnabled(makeRule("r1", true, []), groups, {})).toBe(true);
  });
});

describe("buildTrafficPathModel", () => {
  const base = {
    proxyPort: 9090,
    running: true,
    active: true,
    upstreamProxy: { enabled: false, url: "" },
    groups,
    ruleGroups: { r1: "g1", r2: "g2", r3: "g1" },
    rules: [
      makeRule("r1", true, [{ type: "map_local" } as Rule["actions"][number]]),
      makeRule("r2", true, [{ type: "map_remote" } as Rule["actions"][number]]),
      makeRule("r3", true, [
        { type: "block_request" } as Rule["actions"][number],
        { type: "block_request" } as Rule["actions"][number],
      ]),
    ],
  };

  it("counts only effective rules and orders stats", () => {
    const model = buildTrafficPathModel(base);
    expect(model.enabledRuleCount).toBe(2); // r2's group is disabled
    expect(model.ruleStats).toEqual([
      { action: "map_local", count: 1 },
      { action: "block_request", count: 2 },
    ]);
  });

  it("omits share entry when disabled or upstream missing", () => {
    expect(buildTrafficPathModel({ ...base, share: undefined }).share).toBeNull();
    expect(
      buildTrafficPathModel({
        ...base,
        share: { enabled: true, port: 9080, upstream_url: "  ", listen_lan: false },
      }).share,
    ).toBeNull();
  });

  it("includes share entry when enabled with upstream", () => {
    const model = buildTrafficPathModel({
      ...base,
      share: { enabled: true, port: 9080, upstream_url: "https://example.com", listen_lan: true },
    });
    expect(model.share).toEqual({
      port: 9080,
      upstreamUrl: "https://example.com",
      listenLan: true,
    });
  });

  it("reports upstream egress only when enabled with url", () => {
    expect(buildTrafficPathModel(base).egress).toEqual({ type: "direct", url: null });
    expect(
      buildTrafficPathModel({
        ...base,
        upstreamProxy: { enabled: true, url: "http://127.0.0.1:7890" },
      }).egress,
    ).toEqual({ type: "upstream", url: "http://127.0.0.1:7890" });
  });
});
