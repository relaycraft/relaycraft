import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { formatError, Logger } from "../lib/logger";
import type { Rule, RuleGroup } from "../types/rules";
import { getUniqueGroupName } from "./ruleStore/groupUniqueness";
import { getRuleConflicts as getRuleConflictsFromEngine } from "./ruleStore/ruleConflictEngine";
import { computeMoveWindow, sortRulesByExecutionOrder } from "./ruleStore/rulePriorityEngine";

// sanitizeRule was removed as legacy compatibility is no longer needed

interface RuleStore {
  version: number; // Incremented on any change, used for efficient subscription
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
  saveGroups: () => Promise<void>;
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
    failedRules?: Array<{ id: string; name: string; error: string }>;
    error?: string;
  }>;
  loadErrors: Array<{ path: string; error: string }>;
  clearLoadErrors: () => void;
}

export const useRuleStore = create<RuleStore>((set, get) => ({
  version: 0,
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
      version: state.version + 1,
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
          version: state.version + 1,
          rules: state.rules.map((rule) => (rule.id === id ? newRule : rule)),
        };
        // Check for undefined to allow empty string
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
        version: state.version + 1,
        rules: state.rules.filter((rule) => rule.id !== id),
        ruleGroups: newRuleGroups,
        selectedRule: state.selectedRule?.id === id ? null : state.selectedRule,
      };
    });
    try {
      await invoke("delete_rule", { ruleId: id });
    } catch (error) {
      Logger.error("Failed to delete rule file:", error);
    }
  },

  toggleRule: (id) => {
    set((state) => {
      // Find target rule
      const target = state.rules.find((r) => r.id === id);
      if (!target) return state;

      const nextEnabled = !target.execution.enabled;
      const updates: Partial<RuleStore> = {
        version: state.version + 1,
        rules: state.rules.map((rule) =>
          rule.id === id
            ? {
                ...rule,
                execution: { ...rule.execution, enabled: nextEnabled },
              }
            : rule,
        ),
      };

      // Enable group if enabling a rule
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
    // Only save the toggled rule, not all rules
    const toggledRule = get().rules.find((r) => r.id === id);
    if (toggledRule) {
      get().saveRule(toggledRule);
    }
    // Also save groups if we enabled a group
    const groupId = get().ruleGroups[id];
    const group = get().groups.find((g) => g.id === groupId);
    if (group && !group.enabled) {
      get().saveGroups();
    }
  },
  enableAllRules: () => {
    set((state) => ({
      version: state.version + 1,
      rules: state.rules.map((rule) => ({
        ...rule,
        execution: { ...rule.execution, enabled: true },
      })),
    }));
    get().saveRules();
  },
  disableAllRules: () => {
    set((state) => ({
      version: state.version + 1,
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
    const preMoveState = get();
    const groupId = preMoveState.ruleGroups[id];
    const groupRules = sortRulesByExecutionOrder(
      preMoveState.rules.filter((r) => preMoveState.ruleGroups[r.id] === groupId),
    );
    const index = groupRules.findIndex((r) => r.id === id);
    if (index === -1) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= groupRules.length) return;

    const reordered = [...groupRules];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(newIndex, 0, moved);
    const moveWindow = computeMoveWindow(groupRules, index, newIndex);

    const priorityUpdates = new Map<string, number>();
    reordered.slice(moveWindow.start, moveWindow.end + 1).forEach((rule, windowIndex) => {
      priorityUpdates.set(rule.id, moveWindow.priorities[windowIndex]);
    });

    set((state) => {
      const updatedRules = state.rules.map((r) => {
        const nextPriority = priorityUpdates.get(r.id);
        if (nextPriority !== undefined && nextPriority !== r.execution.priority) {
          return { ...r, execution: { ...r.execution, priority: nextPriority } };
        }
        return r;
      });

      return { version: state.version + 1, rules: updatedRules };
    });

    const affectedIds = new Set(priorityUpdates.keys());
    const affectedRules = get().rules.filter((r) => affectedIds.has(r.id));
    for (const rule of affectedRules) {
      get().saveRule(rule);
    }
  },

  moveGroup: (id: string, direction: "up" | "down") => {
    set((state) => {
      // Stable sort
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
        version: state.version + 1,
        groups: result.map((group, idx) => ({
          ...group,
          priority: idx + 1,
        })),
      };
    });
    // Only save groups, not rules
    get().saveGroups();
  },

  addGroup: (group) => {
    const currentGroups = get().groups;
    const uniqueName = getUniqueGroupName(group.name, currentGroups);

    // Enforce ID = Name for directory mapping
    const finalGroup = {
      ...group,
      name: uniqueName,
      id: uniqueName, // Force ID to match unique Name
      enabled: group.enabled ?? true,
    };
    set((state) => ({ version: state.version + 1, groups: [...state.groups, finalGroup] }));
    // Only save groups, not rules
    get().saveGroups();
  },

  updateGroup: (id, updates) => {
    const state = get();
    const oldGroup = state.groups.find((g) => g.id === id);
    if (!oldGroup) return;

    const newName = updates.name !== undefined ? updates.name : oldGroup.name;
    const isNameChanging = updates.name !== undefined && updates.name !== oldGroup.name;

    const finalName = isNameChanging ? getUniqueGroupName(newName, state.groups, id) : newName;

    // Update ID and ruleGroups mapping if name changed
    const newId = isNameChanging ? finalName : id;

    set((state) => {
      const updatedGroups = state.groups.map((group) =>
        group.id === id ? { ...group, ...updates, name: finalName, id: newId } : group,
      );

      const newState: any = { version: state.version + 1, groups: updatedGroups };

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

    // If name changed, need to save affected rules (they move to new directory)
    if (isNameChanging) {
      const affectedRules = get().rules.filter((r) => get().ruleGroups[r.id] === newId);
      for (const rule of affectedRules) {
        get().saveRule(rule);
      }
    }
    // Always save groups
    get().saveGroups();
  },

  deleteGroup: (id) => {
    // Get affected rules before state change
    const affectedRules = get().rules.filter((r) => get().ruleGroups[r.id] === id);

    set((state) => {
      const newRuleGroups = { ...state.ruleGroups };
      Object.keys(newRuleGroups).forEach((rid) => {
        if (newRuleGroups[rid] === id) {
          newRuleGroups[rid] = "Default";
        }
      });
      return {
        version: state.version + 1,
        groups: state.groups.filter((group) => group.id !== id),
        ruleGroups: newRuleGroups,
      };
    });

    // Save affected rules (they move to Default directory)
    for (const rule of affectedRules) {
      get().saveRule(rule);
    }
    // Save groups
    get().saveGroups();
  },

  toggleGroup: (id: string) => {
    set((state) => {
      const group = state.groups.find((g) => g.id === id);
      const nextEnabled = !group?.enabled;

      return {
        version: state.version + 1,
        groups: state.groups.map((g) => (g.id === id ? { ...g, enabled: nextEnabled } : g)),
        // Cascade enablement to rules
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
      version: state.version + 1,
      groups: state.groups.map((group) =>
        group.id === id ? { ...group, collapsed: !group.collapsed } : group,
      ),
    }));
    // Only save groups, not rules
    get().saveGroups();
  },

  loadRules: async () => {
    try {
      // Load rules entries
      const rulesJson = await invoke<string>("load_all_rules");
      const response: {
        rules: { groupId: string; rule: Rule }[];
        errors: { path: string; error: string }[];
      } = JSON.parse(rulesJson);

      // Load groups
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

      set((state) => ({
        version: state.version + 1,
        rules,
        groups,
        ruleGroups,
        loadErrors: response.errors || [],
      }));
    } catch (error) {
      Logger.error("Failed to load rules:", error);
    }
  },

  saveRules: async () => {
    try {
      const state = get();
      // Prepare rules with their group IDs for batch save
      const rulesWithGroups = state.rules.map((rule) => ({
        rule,
        groupId: state.ruleGroups[rule.id] || "Default",
      }));
      // Single IPC call instead of N+1 calls
      await invoke("save_all_rules", {
        rulesJson: JSON.stringify(rulesWithGroups),
        groupsJson: JSON.stringify(state.groups),
      });
    } catch (error) {
      Logger.error("Failed to save rules:", error);
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
      Logger.error("Failed to save rule:", error);
    }
  },

  saveGroups: async () => {
    try {
      const state = get();
      await invoke("save_groups", { groupsJson: JSON.stringify(state.groups) });
    } catch (error) {
      Logger.error("Failed to save groups:", error);
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
      // Create a mutable copy of ruleGroups to avoid direct state mutation
      const currentRuleGroups = { ...state.ruleGroups };

      // Merge Groups by Name
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

      // Process Rules
      let addedCount = 0;
      (bundle.rules || []).forEach((r: Rule) => {
        // Check Name Uniqueness
        let name = r.name;
        let counter = 1;
        while (currentRules.some((cr) => cr.name === name)) {
          name = `${r.name} (${counter})`;
          counter++;
        }

        // Map or Create Group ID
        let targetGroupId = "Default";
        const sourceGroupId = (r as any).groupId;

        if (sourceGroupId) {
          // Map from explicitly imported groups
          const mappedId = groupIdMap.get(sourceGroupId);
          if (mappedId) {
            targetGroupId = mappedId;
          } else {
            // Find existing group or create new one
            const existingGroup = currentGroups.find(
              (g) => g.id === sourceGroupId || g.name === sourceGroupId,
            );
            if (existingGroup) {
              targetGroupId = existingGroup.id;
            } else {
              // Create a new group
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
        // Remove legacy groupId
        delete (newRule as any).groupId;

        currentRules.push(newRule);
        // Update the local copy, not the state directly
        currentRuleGroups[newRule.id] = targetGroupId;
      });

      set((state) => ({
        version: state.version + 1,
        groups: currentGroups,
        rules: currentRules,
        ruleGroups: currentRuleGroups,
      }));
      get().saveRules();
      return { success: true, count: addedCount };
    } catch (e: any) {
      Logger.error("Import failed", e);
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
      Logger.error("Failed to export ZIP:", error);
      return { success: false, error: formatError(error) };
    }
  },

  importRulesZip: async (zipPath: string) => {
    try {
      const rulesDir = await invoke<string>("get_rules_dir_path");
      const result = await invoke<{
        success: boolean;
        importedCount: number;
        skippedCount: number;
        failedRules: Array<{ id: string; name: string; error: string }>;
        error?: string;
      }>("import_rules_zip", {
        zipPath,
        rulesDir,
      });

      if (result.success) {
        // Reload rules
        await get().loadRules();
        return {
          success: true,
          imported: result.importedCount,
          skipped: result.skippedCount,
          failedRules: result.failedRules ?? [],
        };
      }
      return { success: false, error: result.error };
    } catch (error: any) {
      Logger.error("Failed to import ZIP:", error);
      return { success: false, error: formatError(error) };
    }
  },
}));

/**
 * Compute the next available priority value for a new rule.
 * Uses max(existing) + 10 to leave gaps for manual insertion.
 */
export function getNextRulePriority(): number {
  const rules = useRuleStore.getState().rules;
  if (rules.length === 0) return 10;
  const max = Math.max(...rules.map((r) => r.execution.priority));
  return max + 10;
}

export function getRuleConflicts(
  rules: Rule[],
  groups: RuleGroup[],
  ruleGroups: Record<string, string>,
) {
  return getRuleConflictsFromEngine(rules, groups, ruleGroups);
}
