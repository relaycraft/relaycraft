import { describe, expect, it } from "vitest";
import type { MatchAtom, Rule } from "../../types/rules";
import { getRuleConflicts } from "./ruleConflictEngine";

function makeRule(id: string, atoms: MatchAtom[], priority = 0): Rule {
  return {
    id,
    name: id,
    execution: { enabled: true, priority, stopOnMatch: true },
    match: { request: atoms, response: [] },
    actions: [{ type: "block_request" }],
    type: "block_request",
  } as Rule;
}

const urlAtom: MatchAtom = { type: "url", matchType: "contains", value: "example.com" };

describe("getRuleConflicts with process atoms", () => {
  it("does not flag rules that differ only by process atom", () => {
    const chrome = makeRule("chrome", [
      urlAtom,
      { type: "process", matchType: "contains", value: "chrome" },
    ]);
    const code = makeRule("code", [
      urlAtom,
      { type: "process", matchType: "contains", value: "Code" },
    ]);
    const conflicts = getRuleConflicts([chrome, code], [], {});
    expect(conflicts.chrome).toBeUndefined();
    expect(conflicts.code).toBeUndefined();
  });

  it("still flags a rule shadowed by an identical-match terminator", () => {
    const a = makeRule("a", [urlAtom], 0);
    const b = makeRule("b", [urlAtom], 1);
    const conflicts = getRuleConflicts([a, b], [], {});
    expect(conflicts.b).toEqual({ type: "shadowed", byRuleId: "a" });
  });
});
