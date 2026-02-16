import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Folders, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRuleConflicts, useRuleStore } from "../../stores/ruleStore";
import { useUIStore } from "../../stores/uiStore";
import type { Rule, RuleGroup } from "../../types/rules";
import { EmptyState } from "../common/EmptyState";
import { RuleEditor } from "./RuleEditor";
import { RuleGroupHeader } from "./RuleGroupHeader";
import { RuleList } from "./RuleList";

export function RuleView() {
  const { t } = useTranslation();
  const {
    rules,
    groups,
    addGroup,
    selectedRule,
    selectRule,
    loadRules,
    draftRule,
    setDraftRule,
    searchQuery,
    isEditorDirty,
    setIsEditorDirty,
    ruleGroups,
    loadErrors,
    clearLoadErrors,
  } = useRuleStore();
  const { showConfirm } = useUIStore();
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // Auto-open editor if there is a draft rule (including empty object for new rule)
  useEffect(() => {
    if (draftRule) {
      setShowEditor(true);
    }
  }, [draftRule]);

  const filteredRules = rules.filter((rule) =>
    rule.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleEditRule = (rule: Rule) => {
    const performSwitch = () => {
      selectRule(rule);
      setDraftRule(null);
      setShowEditor(true);
      setIsEditorDirty(false); // Reset dirty state on switch
    };

    // If clicking the SAME rule that's already selected, do nothing
    if (selectedRule?.id === rule.id && showEditor) return;

    if (isEditorDirty) {
      showConfirm({
        title: t("rules.alerts.discard_title"),
        message: t("rules.alerts.discard_msg"),
        variant: "warning",
        onConfirm: performSwitch,
      });
    } else {
      performSwitch();
    }
  };

  const handleCloseEditor = (force = false) => {
    if (!force && isEditorDirty) {
      showConfirm({
        title: t("rules.alerts.discard_title"),
        message: t("rules.alerts.discard_msg"),
        variant: "warning",
        onConfirm: () => {
          setShowEditor(false);
          useRuleStore.getState().clearActiveRule();
        },
      });
    } else {
      setShowEditor(false);
      useRuleStore.getState().clearActiveRule();
    }
  };

  const handleAddGroup = () => {
    const newGroup: RuleGroup = {
      id: crypto.randomUUID(),
      name: t("rules.new_group_name"),
      enabled: true,
      priority: groups.length + 1,
    };
    addGroup(newGroup);
  };

  const groupedRules = filteredRules.reduce(
    (acc: Record<string, Rule[]>, rule: Rule) => {
      const groupId = ruleGroups[rule.id];
      const gid = groupId && groupId !== "Default" ? groupId : "uncategorized";
      if (!acc[gid]) acc[gid] = [];
      acc[gid].push(rule);
      return acc;
    },
    {} as Record<string, Rule[]>,
  );

  // Sort rules within each group by priority (stable)
  Object.keys(groupedRules).forEach((gid) => {
    groupedRules[gid].sort((a, b) => {
      if (a.execution.priority !== b.execution.priority)
        return a.execution.priority - b.execution.priority;
      return a.id.localeCompare(b.id);
    });
  });

  const conflicts = getRuleConflicts(rules, groups);

  return (
    <div className="h-full flex overflow-hidden">
      {/* Rule List Container */}
      <div className="flex-1 border-r border-border flex flex-col bg-card/20 min-w-0">
        <div className="flex-1 overflow-y-auto">
          {loadErrors.length > 0 && (
            <div className="m-4 p-4 rounded-xl bg-destructive/10 border border-destructive/20 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-destructive">
                      {t("rules.alerts.load_error_title", "Corrupted Rules Detected")}
                    </h3>
                    <button
                      onClick={clearLoadErrors}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t(
                      "rules.alerts.load_error_msg",
                      "Some rule files on disk could not be parsed. They have been skipped but you may want to fix them manually.",
                    )}
                  </p>
                  <div className="space-y-1 mt-3">
                    {loadErrors.slice(0, 3).map((err, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col gap-0.5 p-2 rounded-lg bg-background/50 border border-border/10"
                      >
                        <div className="text-[10px] font-mono text-foreground truncate">
                          {err.path.split(/[\\/]/).pop()}
                        </div>
                        <div className="text-[10px] text-destructive/80 italic line-clamp-2">
                          {err.error}
                        </div>
                      </div>
                    ))}
                    {loadErrors.length > 3 && (
                      <div className="text-[10px] text-muted-foreground pl-2 italic">
                        ...and {loadErrors.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {filteredRules.length === 0 && groups.length === 0 ? (
            <EmptyState
              icon={Plus}
              title={t("rules.empty.title")}
              description={t("rules.empty.desc")}
              action={{
                label: t("rules.empty.create_first_group"),
                onClick: handleAddGroup,
                icon: Folders,
              }}
              animation="float"
            />
          ) : (
            <div className="pb-20 space-y-4">
              {/* Groups with rules */}
              {[...groups]
                .sort((a: RuleGroup, b: RuleGroup) => {
                  if (a.priority !== b.priority) return a.priority - b.priority;
                  return a.id.localeCompare(b.id);
                })
                .map((group: RuleGroup) => (
                  <div key={group.id} className="border-b border-border/20 last:border-0">
                    <RuleGroupHeader
                      group={group}
                      ruleCount={groupedRules[group.id]?.length || 0}
                    />
                    <AnimatePresence initial={false}>
                      {!group.collapsed && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="bg-background/40">
                            {groupedRules[group.id] && groupedRules[group.id].length > 0 ? (
                              <RuleList
                                rules={groupedRules[group.id]}
                                onEdit={handleEditRule}
                                conflicts={conflicts}
                                selectedRuleId={selectedRule?.id}
                              />
                            ) : (
                              <div className="px-12 py-6 text-[11px] text-muted-foreground/50 italic text-center">
                                {t("rules.empty.group_empty")}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}

              {/* Uncategorized Rules */}
              {groupedRules.uncategorized && groupedRules.uncategorized.length > 0 && (
                <div className="border-b border-border/20">
                  <div className="flex items-center px-4 py-2 bg-muted/40 border-y border-border/40 select-none">
                    <Folders className="w-3.5 h-3.5 mr-2 text-muted-foreground/60" />
                    <span className="text-system font-bold tracking-tight text-muted-foreground">
                      {t("rules.uncategorized")}
                    </span>
                    <span className="ml-2 text-[10px] font-medium bg-muted/50 px-1.5 py-0.5 rounded-full text-muted-foreground/70">
                      {groupedRules.uncategorized.length}
                    </span>
                  </div>
                  <RuleList
                    rules={groupedRules.uncategorized}
                    onEdit={handleEditRule}
                    conflicts={conflicts}
                    selectedRuleId={selectedRule?.id}
                  />
                </div>
              )}

              {/* Bottom Add Group Button */}
              <div className="p-8 flex justify-center">
                <button
                  onClick={handleAddGroup}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg border-2 border-dashed border-border/40 text-muted-foreground/60 hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all text-xs font-bold"
                >
                  <Plus className="w-4 h-4" />
                  {t("rules.add_group")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rule Editor */}
      <AnimatePresence>
        {showEditor && (
          <motion.div
            key="rule-editor-drawer"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "50%", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden bg-background border-l border-border shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.2)] flex flex-col"
          >
            <RuleEditor
              key={
                selectedRule?.id || (draftRule as any)?._draftId || (draftRule ? "draft" : "none")
              }
              rule={selectedRule || draftRule}
              onClose={handleCloseEditor}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
