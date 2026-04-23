import type { Rule, RuleGroup } from "../../types/rules";

export type RuleConflict = { type: "shadowed" | "redundant"; byRuleId: string };

function isSuperset(ruleA: Rule, ruleB: Rule): boolean {
  const atomsA = ruleA.match.request || [];
  const atomsB = ruleB.match.request || [];

  if (atomsA.length === 0) return true;
  if (atomsB.length === 0) return false;

  const getAtomsByType = (atoms: any[]) => {
    const map = new Map<string, any[]>();
    atoms.forEach((a) => {
      const list = map.get(a.type) || [];
      list.push(a);
      map.set(a.type, list);
    });
    return map;
  };

  const mapA = getAtomsByType(atomsA);
  const mapB = getAtomsByType(atomsB);

  for (const [type, listA] of mapA.entries()) {
    const listB = mapB.get(type);
    if (!listB) return false;

    if (type === "method") {
      const methodsA = new Set(
        listA.flatMap((a) => (Array.isArray(a.value) ? a.value : [a.value])),
      );
      const methodsB = new Set(
        listB.flatMap((b) => (Array.isArray(b.value) ? b.value : [b.value])),
      );
      const isMethodSuperset = [...methodsB].every((m) => methodsA.has(m));
      if (!isMethodSuperset) return false;
    } else if (type === "host" || type === "url" || type === "path") {
      for (const ua of listA) {
        const valA = ua.value as string;
        const typeA = ua.matchType;

        let covered = false;
        for (const ub of listB) {
          const valB = ub.value as string;
          const typeB = ub.matchType;

          if (typeA === "exact" || typeA === "equals") {
            if ((typeB === "exact" || typeB === "equals") && valA === valB) covered = true;
          } else if (typeA === "contains") {
            if ((typeB === "exact" || typeB === "equals") && valB.includes(valA)) covered = true;
            if (typeB === "contains" && valB.includes(valA)) covered = true;
          } else if (typeA === "wildcard") {
            if (typeB === "wildcard" && valA === valB) covered = true;
            if (typeB === "exact" || typeB === "equals") {
              try {
                const re = new RegExp(
                  "^" +
                    valA
                      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                      .replace(/\*/g, ".*")
                      .replace(/\?/g, ".") +
                    "$",
                );
                if (re.test(valB)) covered = true;
              } catch {
                /* invalid pattern, skip */
              }
            }
          } else if (typeA === "regex") {
            if (typeB === "regex" && valA === valB) covered = true;
          }
        }
        if (!covered) return false;
      }
    } else if (type === "header" || type === "query") {
      for (const ua of listA) {
        let covered = false;
        for (const ub of listB) {
          if (ua.key === ub.key && ua.value === ub.value && ua.matchType === ub.matchType) {
            covered = true;
          }
        }
        if (!covered) return false;
      }
    }
  }

  return true;
}

export function getRuleConflicts(
  rules: Rule[],
  groups: RuleGroup[],
  ruleGroups: Record<string, string>,
): Record<string, RuleConflict> {
  const conflicts: Record<string, RuleConflict> = {};
  const disabledGroupIds = new Set(groups.filter((g) => !g.enabled).map((g) => g.id));

  const activeRules = rules
    .filter((r) => {
      if (!r.execution.enabled) return false;
      const gid = ruleGroups[r.id];
      if (gid && disabledGroupIds.has(gid)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.execution.priority !== b.execution.priority) {
        return a.execution.priority - b.execution.priority;
      }
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.id.localeCompare(b.id);
    });

  const requestTerminators: Rule[] = [];
  const responseTerminators: Rule[] = [];

  for (const rule of activeRules) {
    const actions = rule.actions || [];

    let doesTerminateRequest = false;
    let doesTerminateResponse = false;

    for (const action of actions) {
      if (action.type === "block_request" || action.type === "map_local") {
        doesTerminateRequest = true;
        if (action.type === "block_request") doesTerminateResponse = true;
      }
    }
    if (rule.execution.stopOnMatch) {
      doesTerminateRequest = true;
      doesTerminateResponse = true;
    }

    const hasRequestAction = actions.some(
      (a) =>
        [
          "map_local",
          "map_remote",
          "rewrite_header",
          "rewrite_body",
          "throttle",
          "block_request",
        ].includes(a.type) &&
        (!(a as any).target || (a as any).target === "request"),
    );

    if (hasRequestAction) {
      for (const terminator of requestTerminators) {
        if (isSuperset(terminator, rule)) {
          conflicts[rule.id] = { type: "shadowed", byRuleId: terminator.id };
          break;
        }
      }
    }

    if (!conflicts[rule.id]) {
      const hasResponseAction = actions.some(
        (a) =>
          ["rewrite_header", "rewrite_body", "throttle"].includes(a.type) &&
          (a as any).target === "response",
      );

      if (hasResponseAction) {
        for (const terminator of responseTerminators) {
          if (isSuperset(terminator, rule)) {
            conflicts[rule.id] = { type: "shadowed", byRuleId: terminator.id };
            break;
          }
        }
      }
    }

    if (doesTerminateRequest) requestTerminators.push(rule);
    if (doesTerminateResponse) responseTerminators.push(rule);
  }

  return conflicts;
}
