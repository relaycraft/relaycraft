import {
  ChevronDown,
  ChevronDown as ChevronDownIcon,
  ChevronRight,
  ChevronUp,
  Edit,
  Library,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuleStore } from "../../stores/ruleStore";
import { useUIStore } from "../../stores/uiStore";
import type { RuleGroup } from "../../types/rules";
import { Switch } from "../common/Switch";
import { Tooltip } from "../common/Tooltip";

interface RuleGroupHeaderProps {
  group: RuleGroup;
  ruleCount: number;
}

export function RuleGroupHeader({ group, ruleCount }: RuleGroupHeaderProps) {
  const { t } = useTranslation();
  const { toggleGroup, toggleGroupCollapse, deleteGroup, updateGroup, moveGroup, groups } =
    useRuleStore();
  const { showConfirm } = useUIStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);

  const handleSaveName = () => {
    if (editName.trim() && editName !== group.name) {
      updateGroup(group.id, { name: editName.trim() });
    }
    setIsEditing(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirm({
      title: t("rule_group.delete_title"),
      message: t("rule_group.delete_msg", { name: group.name }),
      variant: "danger",
      onConfirm: () => deleteGroup(group.id),
    });
  };

  return (
    <div
      className="flex items-center px-4 py-1.5 bg-muted/40 backdrop-blur-sm border-y border-border/20 group/group-header cursor-pointer select-none sticky top-0 z-10"
      onClick={() => toggleGroupCollapse(group.id)}
    >
      <div className="mr-3 transition-colors hover:text-primary">
        {group.collapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </div>

      <div className="flex-1 min-w-0 flex items-center gap-2">
        <Library
          className={`w-3.5 h-3.5 ${group.enabled ? "text-primary" : "text-muted-foreground/50"}`}
        />

        {isEditing ? (
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
            onClick={(e) => e.stopPropagation()}
            className="bg-background border border-primary/30 rounded px-2 py-0.5 text-xs font-bold w-48 outline-none"
          />
        ) : (
          <div className="flex items-center gap-2 truncate">
            <span
              className={`text-ui font-bold tracking-tight ${group.enabled ? "text-foreground" : "text-muted-foreground"}`}
            >
              {group.name}
            </span>
            <span className="text-caption font-medium bg-muted/50 px-1.5 py-0.5 rounded-full text-muted-foreground/70">
              {ruleCount}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1 opacity-0 group-hover/group-header:opacity-100 transition-all duration-200">
          <Tooltip content={t("rule_group.move_up")}>
            <button
              onClick={() => moveGroup(group.id, "up")}
              disabled={groups.sort((a, b) => a.priority - b.priority)[0]?.id === group.id}
              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t("rule_group.move_down")}>
            <button
              onClick={() => moveGroup(group.id, "down")}
              disabled={
                groups.sort((a, b) => a.priority - b.priority)[groups.length - 1]?.id === group.id
              }
              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <ChevronDownIcon className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <div className="h-3 w-px bg-border/40 mx-1" />
          <Tooltip content={t("rule_group.edit_name")}>
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary"
            >
              <Edit className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t("rule_group.delete_group")}>
            <button
              onClick={handleDelete}
              className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>

        <div className="h-4 w-px bg-border/40 mx-1" />

        <Tooltip
          content={group.enabled ? t("rule_group.disable_group") : t("rule_group.enable_group")}
        >
          <Switch size="sm" checked={group.enabled} onCheckedChange={() => toggleGroup(group.id)} />
        </Tooltip>
      </div>
    </div>
  );
}
