import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { Logger } from "../lib/logger";
import type { Rule, RuleGroup } from "../types/rules";

// sanitizeRule was removed as legacy compatibility is no longer needed

interface RuleStore {
  rules: Rule[];
  groups: RuleGroup[];
  ruleGroups: Record<string, string>; // ruleId -> groupId
  selectedRule: Rule | null;
  draftRule: (Partial<Rule> & { _draftId?: string }) | null;
  addRule: (rule: Rule, groupId?: string) => void;
  updateRule: (id: string, updates: Partial<Rule>, groupId?: string) => void;
  deleteRule: (id: string) => void;
  toggleRule: (id: string) => void;
  enableAllRules: () => void;
  disableAllRules: () => void;
  selectRule: (rule: Rule | null) => void;
  setDraftRule: (rule: Partial<Rule> | null) => void;
  clearActiveRule: () => void;
  moveRule: (id: string, direction: "up" | "down") => void;

  // Group Actions
  addGroup: (group: RuleGroup) => void;
  updateGroup: (id: string, updates: Partial<RuleGroup>) => void;
  deleteGroup: (id: string) => void;
  toggleGroup: (id: string) => void;
  toggleGroupCollapse: (id: string) => void;
  moveGroup: (id: string, direction: "up" | "down") => void;

  loadRules: () => Promise<void>;
  saveRules: () => Promise<void>;
  saveRule: (rule: Rule) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isEditorDirty: boolean;
  setIsEditorDirty: (dirty: boolean) => void;

  exportBundle: () => string;
  importBundle: (json: string) => {
    success: boolean;
    count?: number;
    error?: string;
  };
  exportRulesZip: (
    savePath: string,
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
  importRulesZip: (zipPath: string) => Promise<{
    success: boolean;
    imported?: number;
    skipped?: number;
    error?: string;
  }>;
  loadErrors: Array<{ path: string; error: string }>;
  clearLoadErrors: () => void;
}

export const useRuleStore = create<RuleStore>((set, get) => ({
  rules: [],
  groups: [],
  ruleGroups: {},
  selectedRule: null,
  draftRule: null,
  searchQuery: "",
  isEditorDirty: false,
  loadErrors: [],

  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsEditorDirty: (dirty) => set({ isEditorDirty: dirty }),
  clearLoadErrors: () => set({ loadErrors: [] }),

  addRule: (rule, groupId) => {
    const gid = groupId || "Default";
    set((state) => ({
      rules: [...state.rules, rule],
      ruleGroups: { ...state.ruleGroups, [rule.id]: gid },
    }));
    get().saveRule(rule);
  },

  updateRule: (id, updates, groupId) => {
    const updatedRule = get().rules.find((r) => r.id === id);
    if (updatedRule) {
      const newRule = { ...updatedRule, ...updates };
      set((state) => {
        const newState: any = {
          rules: state.rules.map((rule) => (rule.id === id ? newRule : rule)),
        };
        // Fix: Check for undefined specifically, allowing empty string
        if (groupId !== undefined) {
          newState.ruleGroups = { ...state.ruleGroups, [id]: groupId };
        }
        return newState;
      });
      get().saveRule(newRule);
    }
  },

  deleteRule: async (id) => {
    set((state) => {
      const newRuleGroups = { ...state.ruleGroups };
      delete newRuleGroups[id];
      return {
        rules: state.rules.filter((rule) => rule.id !== id),
        ruleGroups: newRuleGroups,
        selectedRule: state.selectedRule?.id === id ? null : state.selectedRule,
      };
    });
    try {
      await invoke("delete_rule", { ruleId: id });
    } catch (error) {
      console.error("Failed to delete rule file:", error);
    }
  },

  toggleRule: (id) => {
    set((state) => {
      // Find target rule
      const target = state.rules.find((r) => r.id === id);
      if (!target) return state;

      const nextEnabled = !target.execution.enabled;
      const updates: Partial<RuleStore> = {
        rules: state.rules.map((rule) =>
          rule.id === id
            ? {
                ...rule,
                execution: { ...rule.execution, enabled: nextEnabled },
              }
            : rule,
        ),
      };

      // Smart Group Activation: If enabling a rule, check if group needs to be enabled
      const groupId = state.ruleGroups[id];
      if (nextEnabled && groupId) {
        const group = state.groups.find((g) => g.id === groupId);
        if (group && !group.enabled) {
          updates.groups = state.groups.map((g) =>
            g.id === group.id ? { ...g, enabled: true } : g,
          );
        }
      }

      return updates;
    });
    get().saveRules();
  },
  enableAllRules: () => {
    set((state) => ({
      rules: state.rules.map((rule) => ({
        ...rule,
        execution: { ...rule.execution, enabled: true },
      })),
    }));
    get().saveRules();
  },
  disableAllRules: () => {
    set((state) => ({
      rules: state.rules.map((rule) => ({
        ...rule,
        execution: { ...rule.execution, enabled: false },
      })),
    }));
    get().saveRules();
  },

  selectRule: (rule) => set({ selectedRule: rule }),

  setDraftRule: (rule) =>
    set({
      draftRule: rule ? { ...rule, _draftId: crypto.randomUUID() } : null,
    }),

  clearActiveRule: () => set({ selectedRule: null, draftRule: null, isEditorDirty: false }),

  moveRule: (id: string, direction: "up" | "down") => {
    set((state) => {
      const rule = state.rules.find((r) => r.id === id);
      if (!rule) return state;

      // Get all rules in the SAME group
      const groupId = state.ruleGroups[id];
      const groupRules = state.rules
        .filter((r) => state.ruleGroups[r.id] === groupId)
        .sort((a, b) => {
          if (a.execution.priority !== b.execution.priority)
            return a.execution.priority - b.execution.priority;
          return a.id.localeCompare(b.id);
        });

      const index = groupRules.findIndex((r) => r.id === id);
      if (index === -1) return state;

      const newIndex = direction === "up" ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= groupRules.length) return state;

      // Swap in the group rules subset
      const result = [...groupRules];
      const [removed] = result.splice(index, 1);
      result.splice(newIndex, 0, removed);

      // Update priorities in the global list
      const updatedRules = [...state.rules];
      result.forEach((r, idx) => {
        const globalIdx = updatedRules.findIndex((gr) => gr.id === r.id);
        if (globalIdx !== -1) {
          updatedRules[globalIdx] = {
            ...r,
            execution: { ...r.execution, priority: idx + 1 },
          };
        }
      });

      return { rules: updatedRules };
    });
    get().saveRules();
  },

  moveGroup: (id: string, direction: "up" | "down") => {
    set((state) => {
      // Stable sort: priority -> createdAt -> id
      const sortedGroups = [...state.groups].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.id.localeCompare(b.id);
      });

      const index = sortedGroups.findIndex((g) => g.id === id);
      if (index === -1) return state;

      const newIndex = direction === "up" ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= sortedGroups.length) return state;

      const result = [...sortedGroups];
      const [removed] = result.splice(index, 1);
      result.splice(newIndex, 0, removed);

      return {
        groups: result.map((group, idx) => ({
          ...group,
          priority: idx + 1,
        })),
      };
    });
    get().saveRules();
  },

  addGroup: (group) => {
    // 1. Ensure unique name within current groups
    const currentGroups = get().groups;
    let uniqueName = group.name;
    let counter = 1;
    while (currentGroups.some((g) => g.name === uniqueName)) {
      uniqueName = `${group.name} (${counter++})`;
    }

    // 2. Enforce ID = Name for directory mapping
    const finalGroup = {
      ...group,
      name: uniqueName,
      id: uniqueName, // Force ID to match unique Name
      enabled: group.enabled ?? true,
    };
    set((state) => ({ groups: [...state.groups, finalGroup] }));
    get().saveRules();
  },

  updateGroup: (id, updates) => {
    const state = get();
    const oldGroup = state.groups.find((g) => g.id === id);
    if (!oldGroup) return;

    const newName = updates.name !== undefined ? updates.name : oldGroup.name;
    const isNameChanging = updates.name !== undefined && updates.name !== oldGroup.name;

    let finalName = newName;
    if (isNameChanging) {
      // Ensure the new name is unique (excluding self)
      let counter = 1;
      const otherGroups = state.groups.filter((g) => g.id !== id);
      while (otherGroups.some((g) => g.name === finalName)) {
        finalName = `${newName} (${counter++})`;
      }
    }

    // If name changed, we also need to update its ID (since ID=Name)
    // AND update the ruleGroups mapping for all rules in this group
    const newId = isNameChanging ? finalName : id;

    set((state) => {
      const updatedGroups = state.groups.map((group) =>
        group.id === id ? { ...group, ...updates, name: finalName, id: newId } : group,
      );

      const newState: any = { groups: updatedGroups };

      if (isNameChanging) {
        const newRuleGroups = { ...state.ruleGroups };
        Object.keys(newRuleGroups).forEach((rid) => {
          if (newRuleGroups[rid] === id) {
            newRuleGroups[rid] = newId;
          }
        });
        newState.ruleGroups = newRuleGroups;
      }

      return newState;
    });

    get().saveRules();
  },

  deleteGroup: (id) => {
    set((state) => {
      const newRuleGroups = { ...state.ruleGroups };
      Object.keys(newRuleGroups).forEach((rid) => {
        if (newRuleGroups[rid] === id) {
          newRuleGroups[rid] = "Default";
        }
      });
      return {
        groups: state.groups.filter((group) => group.id !== id),
        ruleGroups: newRuleGroups,
      };
    });
    get().saveRules();
  },

  toggleGroup: (id: string) => {
    set((state) => {
      const group = state.groups.find((g) => g.id === id);
      const nextEnabled = !group?.enabled;

      return {
        groups: state.groups.map((g) => (g.id === id ? { ...g, enabled: nextEnabled } : g)),
        // Cascade enablement to rules in this group
        rules: state.rules.map((r) =>
          state.ruleGroups[r.id] === id
            ? { ...r, execution: { ...r.execution, enabled: nextEnabled } }
            : r,
        ),
      };
    });
    get().saveRules();
  },

  toggleGroupCollapse: (id: string) => {
    set((state) => ({
      groups: state.groups.map((group) =>
        group.id === id ? { ...group, collapsed: !group.collapsed } : group,
      ),
    }));
    get().saveRules();
  },

  loadRules: async () => {
    try {
      // Load rules entries from backend
      const rulesJson = await invoke<string>("load_all_rules");
      const response: {
        rules: { groupId: string; rule: Rule }[];
        errors: { path: string; error: string }[];
      } = JSON.parse(rulesJson);

      // Load groups from groups.yaml
      const groupsJson = await invoke<string>("load_groups");
      const groups = JSON.parse(groupsJson);

      const rules = response.rules.map((e) => e.rule);
      const ruleGroups = response.rules.reduce(
        (acc, e) => {
          acc[e.rule.id] = e.groupId;
          return acc;
        },
        {} as Record<string, string>,
      );

      set({
        rules,
        groups,
        ruleGroups,
        loadErrors: response.errors || [],
      });
    } catch (error) {
      console.error("Failed to load rules:", error);
    }
  },

  saveRules: async () => {
    try {
      const state = get();
      for (const rule of state.rules) {
        await invoke("save_rule", {
          ruleJson: JSON.stringify(rule),
          groupId: state.ruleGroups[rule.id],
        });
      }
      await invoke("save_groups", { groupsJson: JSON.stringify(state.groups) });
    } catch (error) {
      console.error("Failed to save rules:", error);
    }
  },

  saveRule: async (rule: Rule) => {
    try {
      const state = get();
      const groupId = state.ruleGroups[rule.id];
      Logger.debug(`[Store] Saving rule ${rule.id} (Name: ${rule.name}) to Group: '${groupId}'`);
      await invoke("save_rule", {
        ruleJson: JSON.stringify(rule),
        groupId: groupId,
      });
    } catch (error) {
      console.error("Failed to save rule:", error);
    }
  },

  exportBundle: () => {
    const state = get();
    return JSON.stringify(
      {
        version: "2.0",
        type: "relaycraft-rules-bundle",
        timestamp: Date.now(),
        bundle: {
          groups: state.groups,
          rules: state.rules,
        },
      },
      null,
      2,
    );
  },

  importBundle: (json: string) => {
    try {
      const data = JSON.parse(json);
      const bundle = data.bundle || data; // compatible with raw {groups:[], rules:[]}

      if (!bundle.rules) throw new Error("Invalid bundle format: missing rules");

      const state = get();
      const currentGroups = [...state.groups];
      const currentRules = [...state.rules];

      // 1. Process Groups (Merge by Name)
      const groupIdMap = new Map<string, string>(); // OldID -> NewID

      (bundle.groups || []).forEach((g: RuleGroup) => {
        const existing = currentGroups.find((cg) => cg.name === g.name);
        if (existing) {
          groupIdMap.set(g.id, existing.id);
        } else {
          const newId = g.name; // Use Name as ID
          groupIdMap.set(g.id, newId);
          currentGroups.push({
            ...g,
            id: newId,
            enabled: g.enabled ?? true,
          });
        }
      });

      // 2. Process Rules
      let addedCount = 0;
      (bundle.rules || []).forEach((r: Rule) => {
        // Name Uniqueness check
        let name = r.name;
        let counter = 1;
        while (currentRules.some((cr) => cr.name === name)) {
          name = `${r.name} (${counter})`;
          counter++;
        }

        // Map Group ID or Create if missing
        let targetGroupId = "Default";
        const sourceGroupId = (r as any).groupId;

        if (sourceGroupId) {
          // Try to map from explicitly imported groups
          const mappedId = groupIdMap.get(sourceGroupId);
          if (mappedId) {
            targetGroupId = mappedId;
          } else {
            // Group ID exists in rule but not in groups definitions
            // Check if we have an existing group with this ID (if ID is readable name)
            // Or create a new group for it
            const existingGroup = currentGroups.find(
              (g) => g.id === sourceGroupId || g.name === sourceGroupId,
            );
            if (existingGroup) {
              targetGroupId = existingGroup.id;
            } else {
              // Create on the fly
              const newGroup: RuleGroup = {
                id: sourceGroupId,
                name: sourceGroupId, // Best guess
                enabled: true,
                priority: currentGroups.length + 1,
              };
              currentGroups.push(newGroup);
              targetGroupId = newGroup.id;
              // Remember it
              groupIdMap.set(sourceGroupId, newGroup.id);
            }
          }
        }

        const newRule = {
          ...r,
          id: `rule-${Date.now()}-${addedCount++}`, // Ensure unique ID
          name: name,
        };
        // Remove legacy groupId if it existed in imported JSON
        delete (newRule as any).groupId;

        currentRules.push(newRule);
        state.ruleGroups[newRule.id] = targetGroupId;
      });

      set({
        groups: currentGroups,
        rules: currentRules,
        ruleGroups: { ...state.ruleGroups },
      });
      get().saveRules();
      return { success: true, count: addedCount };
    } catch (e: any) {
      console.error("Import failed", e);
      return { success: false, error: e.message };
    }
  },

  exportRulesZip: async (savePath: string) => {
    try {
      const rulesDir = await invoke<string>("get_rules_dir_path");
      const message = await invoke<string>("export_rules_zip", {
        savePath,
        rulesDir,
      });
      return { success: true, message };
    } catch (error: any) {
      console.error("Failed to export ZIP:", error);
      return { success: false, error: error.toString() };
    }
  },

  importRulesZip: async (zipPath: string) => {
    try {
      const rulesDir = await invoke<string>("get_rules_dir_path");
      const result = await invoke<{
        success: boolean;
        importedCount: number;
        skippedCount: number;
        error?: string;
      }>("import_rules_zip", {
        zipPath,
        rulesDir,
      });

      if (result.success) {
        // Reload rules after import
        await get().loadRules();
        return {
          success: true,
          imported: result.importedCount,
          skipped: result.skippedCount,
        };
      }
      return { success: false, error: result.error };
    } catch (error: any) {
      console.error("Failed to import ZIP:", error);
      return { success: false, error: error.toString() };
    }
  },
}));

/**
 * Helper to check if ruleA is a logical SUPERSET of ruleB.
 * Returns true if every request matching B is guaranteed to be matched by A.
 */
function isSuperset(ruleA: Rule, ruleB: Rule): boolean {
  const atomsA = ruleA.match.request || [];
  const atomsB = ruleB.match.request || [];

  // A matches everything -> Superset of anything
  if (atomsA.length === 0) return true;
  // B matches everything but A doesn't -> A cannot be superset
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

  // For every constraint in A, B must have a corresponding constraint that is AT LEAST as restrictive.
  for (const [type, listA] of mapA.entries()) {
    const listB = mapB.get(type);
    if (!listB) return false; // A has a requirement that B doesn't have

    if (type === "method") {
      const methodsA = new Set(
        listA.flatMap((a) => (Array.isArray(a.value) ? a.value : [a.value])),
      );
      const methodsB = new Set(
        listB.flatMap((b) => (Array.isArray(b.value) ? b.value : [b.value])),
      );
      // Methods in A must be a superset of methods in B
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

          // Is condition cover?
          if (typeA === "exact" || typeA === "equals") {
            if ((typeB === "exact" || typeB === "equals") && valA === valB) covered = true;
          } else if (typeA === "contains") {
            // If B requires EXACT match that contains valA, then A covers it.
            if ((typeB === "exact" || typeB === "equals") && valB.includes(valA)) covered = true;
            // If B requires CONTAINS valB, and valB contains valA, then A covers it.
            // e.g. A contains "google", B contains "google.com" -> A is wider.
            if (typeB === "contains" && valB.includes(valA)) covered = true;
          } else if (typeA === "regex") {
            // Harder, but for same regex it works
            if (typeB === "regex" && valA === valB) covered = true;
          }
        }
        if (!covered) return false;
      }
    } else if (type === "header" || type === "query") {
      // Check if every specific key=val in A is also present/implied in B
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

export function getRuleConflicts(rules: Rule[], groups: RuleGroup[]) {
  const conflicts: Record<string, { type: "shadowed" | "redundant"; byRuleId: string }> = {};

  // 1. Sort groups and rules to get execution order
  const sortedGroups = [...groups].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

  const activeRules: Rule[] = [];
  const ruleGroups = useRuleStore.getState().ruleGroups;

  sortedGroups.forEach((group) => {
    if (!group.enabled) return;
    const groupRules = rules
      .filter((r) => ruleGroups[r.id] === group.id && r.execution.enabled)
      .sort((a, b) => {
        if (a.execution.priority !== b.execution.priority)
          return a.execution.priority - b.execution.priority;
        return a.id.localeCompare(b.id);
      });
    activeRules.push(...groupRules);
  });

  const uncategorizedRules = rules
    .filter((r) => (!ruleGroups[r.id] || ruleGroups[r.id] === "Default") && r.execution.enabled)
    .sort((a, b) => {
      if (a.execution.priority !== b.execution.priority)
        return a.execution.priority - b.execution.priority;
      return a.id.localeCompare(b.id);
    });
  activeRules.push(...uncategorizedRules);

  // 2. Detect shadowing with disjoint check
  // We maintain a list of rules that have "Terminated" the phase.
  const requestTerminators: Rule[] = [];
  const responseTerminators: Rule[] = [];

  for (const rule of activeRules) {
    const actions = rule.actions || [];

    let doesTerminateRequest = false;
    let doesTerminateResponse = false;

    // Check actions to see if this rule IS a terminator
    for (const action of actions) {
      if (action.type === "block_request" || action.type === "map_local") {
        doesTerminateRequest = true;
        if (action.type === "block_request") doesTerminateResponse = true; // Block stops everything
      }
    }
    if (rule.execution.stopOnMatch) {
      doesTerminateRequest = true;
      doesTerminateResponse = true;
    }

    // Check against existing request terminators
    // A rule is shadowed if it overlaps with ANY previous terminator for its active phase

    // Does this rule have request-phase actions?
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

    // If not already shadowed, check response phase
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

    // If this rule terminates, add to list
    if (doesTerminateRequest) requestTerminators.push(rule);
    if (doesTerminateResponse) responseTerminators.push(rule);
  }

  return conflicts;
}
