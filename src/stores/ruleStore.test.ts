import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rule, RuleGroup } from "../types/rules";
import { getRuleConflicts, useRuleStore } from "./ruleStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Helper to quickly generate a basic rule
const createRule = (
  id: string,
  _group: string,
  priority: number = 1,
  match: any = {},
  actions: any[] = [],
): Rule => ({
  id,
  name: `Rule ${id}`,
  type: "block_request",
  match,
  actions,
  execution: { enabled: true, priority, stopOnMatch: false },
});

// Helper for group
const createGroup = (id: string, priority: number = 1, enabled: boolean = true): RuleGroup => ({
  id,
  name: id,
  enabled,
  priority,
});

describe("ruleStore and algorithm logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRuleStore.setState({
      version: 0,
      rules: [],
      groups: [],
      ruleGroups: {},
      selectedRule: null,
      draftRule: null,
    });
  });

  describe("Store CRUD", () => {
    it("should add a group and rule", () => {
      const store = useRuleStore.getState();
      store.addGroup(createGroup("AdBlock"));

      expect(useRuleStore.getState().groups.length).toBe(1);
      expect(useRuleStore.getState().groups[0].id).toBe("AdBlock");

      store.addRule(createRule("rule-1", "AdBlock", 1, { request: [] }, []), "AdBlock");
      expect(useRuleStore.getState().rules.length).toBe(1);
      expect(useRuleStore.getState().ruleGroups["rule-1"]).toBe("AdBlock");
    });

    it("should toggle rule and its parent group correctly", () => {
      const store = useRuleStore.getState();
      store.addGroup(createGroup("AdBlock", 1, false)); // Group disabled

      const rule = createRule("rule-1", "AdBlock", 1);
      rule.execution.enabled = false; // Rule disabled
      store.addRule(rule, "AdBlock");

      useRuleStore.getState().toggleRule("rule-1");

      const state = useRuleStore.getState();
      expect(state.rules[0].execution.enabled).toBe(true);

      // Auto-enable group if rule was enabled
      expect(state.groups[0].enabled).toBe(true);
    });

    it("should delete rule", async () => {
      const store = useRuleStore.getState();
      store.addRule(createRule("r1", "G1"), "G1");
      await useRuleStore.getState().deleteRule("r1");

      expect(useRuleStore.getState().rules.length).toBe(0);
      expect(useRuleStore.getState().ruleGroups.r1).toBeUndefined();
    });

    it("should move rules even when adjacent priorities are equal", () => {
      const store = useRuleStore.getState();
      store.addGroup(createGroup("G1"));
      store.addRule(createRule("r1", "G1", 10), "G1");
      store.addRule(createRule("r2", "G1", 10), "G1");

      store.moveRule("r2", "up");

      const state = useRuleStore.getState();
      const r1 = state.rules.find((r) => r.id === "r1")!;
      const r2 = state.rules.find((r) => r.id === "r2")!;
      expect(r2.execution.priority).toBeLessThan(r1.execution.priority);
    });

    it("should only move one step within an equal-priority block", () => {
      const store = useRuleStore.getState();
      store.addGroup(createGroup("G1"));
      store.addRule(createRule("r1", "G1", 10), "G1");
      store.addRule(createRule("r2", "G1", 10), "G1");
      store.addRule(createRule("r3", "G1", 10), "G1");

      store.moveRule("r3", "up");

      const ordered = [...useRuleStore.getState().rules].sort((a, b) => {
        if (a.execution.priority !== b.execution.priority) {
          return a.execution.priority - b.execution.priority;
        }
        return a.id.localeCompare(b.id);
      });

      expect(ordered.map((rule) => rule.id)).toEqual(["r1", "r3", "r2"]);
    });

    it("should keep changes scoped to the minimal conflicting window", () => {
      const store = useRuleStore.getState();
      store.addGroup(createGroup("G1"));
      store.addRule(createRule("r1", "G1", 10), "G1");
      store.addRule(createRule("r2", "G1", 10), "G1");
      store.addRule(createRule("r3", "G1", 20), "G1");
      store.addRule(createRule("r4", "G1", 30), "G1");

      store.moveRule("r3", "up");

      const state = useRuleStore.getState();
      const priorities = Object.fromEntries(
        state.rules.map((rule) => [rule.id, rule.execution.priority]),
      );

      expect(priorities.r1).toBe(10);
      expect(priorities.r3).toBe(11);
      expect(priorities.r2).toBe(12);
      expect(priorities.r4).toBe(30);
    });
  });

  describe("Superset and Conflict Algorithm", () => {
    it("should use store ruleGroups mapping when filtering disabled groups", () => {
      const disabledTerminator = createRule("r-disabled", "Disabled", 1, { request: [] }, [
        { type: "block_request" },
      ]);
      const activeRule = createRule("r-active", "Active", 2, { request: [] }, [
        { type: "map_local", target: "request", value: "x" },
      ]);

      useRuleStore.setState({
        rules: [disabledTerminator, activeRule],
        groups: [createGroup("Disabled", 1, false), createGroup("Active", 2, true)],
        ruleGroups: { "r-disabled": "Disabled", "r-active": "Active" },
      });

      const conflicts = getRuleConflicts(
        useRuleStore.getState().rules,
        useRuleStore.getState().groups,
        useRuleStore.getState().ruleGroups,
      );

      // r-disabled belongs to a disabled group and should not shadow r-active.
      expect(conflicts["r-active"]).toBeUndefined();
    });

    it("should ignore group priority and follow flat execution order", () => {
      const earlyByRulePriority = createRule("r-early", "LowPriorityGroup", 1, { request: [] }, [
        { type: "block_request" },
      ]);
      earlyByRulePriority.name = "z-early";

      const laterByRulePriority = createRule("r-late", "HighPriorityGroup", 2, { request: [] }, [
        { type: "map_local", target: "request", value: "y" },
      ]);
      laterByRulePriority.name = "a-late";

      useRuleStore.setState({
        rules: [laterByRulePriority, earlyByRulePriority],
        groups: [
          createGroup("HighPriorityGroup", 1, true),
          createGroup("LowPriorityGroup", 99, true),
        ],
        ruleGroups: { "r-early": "LowPriorityGroup", "r-late": "HighPriorityGroup" },
      });

      const conflicts = getRuleConflicts(
        useRuleStore.getState().rules,
        useRuleStore.getState().groups,
        useRuleStore.getState().ruleGroups,
      );

      // Group priority should not affect execution/conflict order.
      expect(conflicts["r-late"]).toEqual({ type: "shadowed", byRuleId: "r-early" });
    });

    it("should break same-priority ties by name then id", () => {
      const alphaTerminator = createRule("r-alpha", "G1", 10, { request: [] }, [
        { type: "block_request" },
      ]);
      alphaTerminator.name = "A";

      const betaRule = createRule("r-beta", "G1", 10, { request: [] }, [
        { type: "map_local", target: "request", value: "payload" },
      ]);
      betaRule.name = "B";

      useRuleStore.setState({
        rules: [betaRule, alphaTerminator],
        groups: [createGroup("G1")],
        ruleGroups: { "r-alpha": "G1", "r-beta": "G1" },
      });

      const conflicts = getRuleConflicts(
        useRuleStore.getState().rules,
        useRuleStore.getState().groups,
        useRuleStore.getState().ruleGroups,
      );

      expect(conflicts["r-beta"]).toEqual({ type: "shadowed", byRuleId: "r-alpha" });
    });

    it("should detect shadowed conflicts correctly (Method shadow)", () => {
      // Rule 1 maps all GET requests
      const rule1 = createRule(
        "r1",
        "G1",
        1,
        {
          request: [{ type: "method", matchType: "exact", value: ["GET", "POST"] }],
        },
        [{ type: "map_local", target: "request", value: "test1" }],
      );

      // Rule 2 only maps GET requests to specific host
      const rule2 = createRule(
        "r2",
        "G1",
        2,
        {
          request: [
            { type: "method", matchType: "exact", value: ["GET"] },
            { type: "host", matchType: "exact", value: "test.com" },
          ],
        },
        [{ type: "map_local", target: "request", value: "test2" }],
      );

      useRuleStore.setState({
        rules: [rule1, rule2],
        groups: [createGroup("G1")],
        ruleGroups: { r1: "G1", r2: "G1" },
      });

      const conflicts = getRuleConflicts(
        useRuleStore.getState().rules,
        useRuleStore.getState().groups,
        useRuleStore.getState().ruleGroups,
      );

      // r1 triggers a termination action (map_local) for a VERY BROAD match (GET or POST for any host)
      // r1's priority is 1 (higher/earlier than r2's 2).
      // r2 requires GET and test.com. Since GET is within [GET, POST], r1 covers it.
      // Therefore, r2 is shadowed by r1.
      expect(conflicts.r2).toBeDefined();
      expect(conflicts.r2.type).toBe("shadowed");
      expect(conflicts.r2.byRuleId).toBe("r1");
    });

    it("should NOT detect shadowed if previous rule is more specific", () => {
      // Reversing priority: r1 (specific) comes first
      const rule1 = createRule(
        "r1",
        "G1",
        1,
        {
          request: [
            { type: "method", matchType: "exact", value: ["GET"] },
            { type: "host", matchType: "exact", value: "test.com" },
          ],
        },
        [{ type: "block_request" }],
      );

      const rule2 = createRule(
        "r2",
        "G1",
        2,
        {
          request: [{ type: "method", matchType: "exact", value: ["GET", "POST"] }],
        },
        [{ type: "block_request" }],
      );

      useRuleStore.setState({
        rules: [rule1, rule2],
        groups: [createGroup("G1")],
        ruleGroups: { r1: "G1", r2: "G1" },
      });

      const conflicts = getRuleConflicts(
        useRuleStore.getState().rules,
        useRuleStore.getState().groups,
        useRuleStore.getState().ruleGroups,
      );

      // r1 blocks narrow scope, r2 blocks wide scope. It's fine, the wide scope catches everything else.
      expect(conflicts.r2).toBeUndefined();
    });

    it("should ignore rules that do not terminate the flow", () => {
      const rule1 = createRule(
        "r1",
        "G1",
        1,
        {
          request: [],
        },
        [{ type: "rewrite_header", target: "request" }],
      ); // No termination

      const rule2 = createRule(
        "r2",
        "G1",
        2,
        {
          request: [],
        },
        [{ type: "block_request" }],
      );

      useRuleStore.setState({
        rules: [rule1, rule2],
        groups: [createGroup("G1")],
        ruleGroups: { r1: "G1", r2: "G1" },
      });

      const conflicts = getRuleConflicts(
        useRuleStore.getState().rules,
        useRuleStore.getState().groups,
        useRuleStore.getState().ruleGroups,
      );

      // r1 is broad but doesn't terminate, so r2 will still get executed.
      expect(conflicts.r2).toBeUndefined();
    });

    it("should respect stopOnMatch for termination", () => {
      const rule1 = createRule(
        "r1",
        "G1",
        1,
        {
          request: [],
        },
        [{ type: "rewrite_header", target: "request" }],
      );
      // Force termination
      rule1.execution.stopOnMatch = true;

      const rule2 = createRule(
        "r2",
        "G1",
        2,
        {
          request: [],
        },
        [{ type: "block_request" }],
      );

      useRuleStore.setState({
        rules: [rule1, rule2],
        groups: [createGroup("G1")],
        ruleGroups: { r1: "G1", r2: "G1" },
      });

      const conflicts = getRuleConflicts(
        useRuleStore.getState().rules,
        useRuleStore.getState().groups,
        useRuleStore.getState().ruleGroups,
      );

      // Now r1 terminates, so r2 is shadowed.
      expect(conflicts.r2).toBeDefined();
      expect(conflicts.r2.type).toBe("shadowed");
    });
  });
});
