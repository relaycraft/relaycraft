import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronUp,
  Edit,
  FileCode,
  FileSignature,
  Globe,
  LayoutList,
  ShieldCheck,
  Trash2,
  Wifi,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRuleStore } from "../../stores/ruleStore";
import { useUIStore } from "../../stores/uiStore";
import type { Rule, RuleType } from "../../types/rules";
import { CopyButton } from "../common/CopyButton";
import { Switch } from "../common/Switch";
import { Tooltip } from "../common/Tooltip";

interface RuleListProps {
  rules: Rule[];
  onEdit: (rule: Rule) => void;
  conflicts?: Record<string, { type: "shadowed" | "redundant"; byRuleId: string }>;
  selectedRuleId?: string;
}

export function RuleList({ rules, onEdit, conflicts = {}, selectedRuleId }: RuleListProps) {
  const { toggleRule, deleteRule, rules: allRules, moveRule } = useRuleStore();
  const { showConfirm } = useUIStore();
  const { t } = useTranslation();

  const getRuleIcon = (type: RuleType) => {
    switch (type) {
      case "rewrite_body":
        return <FileSignature className="w-3.5 h-3.5" />;
      case "map_local":
        return <FileCode className="w-3.5 h-3.5" />;
      case "map_remote":
        return <Globe className="w-3.5 h-3.5" />;
      case "rewrite_header":
        return <LayoutList className="w-3.5 h-3.5" />;
      case "throttle":
        return <Wifi className="w-3.5 h-3.5" />;
      case "block_request":
        return <Ban className="w-3.5 h-3.5" />;
      default:
        return <ShieldCheck className="w-3.5 h-3.5" />;
    }
  };

  const getRuleColorCheck = (type: RuleType) => {
    switch (type) {
      case "rewrite_body":
        return "text-purple-500 bg-purple-500/10 border-purple-200 dark:border-purple-900";
      case "map_local":
        return "text-blue-500 bg-blue-500/10 border-blue-200 dark:border-blue-900";
      case "map_remote":
        return "text-emerald-500 bg-emerald-500/10 border-emerald-200 dark:border-emerald-900";
      case "rewrite_header":
        return "text-orange-500 bg-orange-500/10 border-orange-200 dark:border-orange-900";
      case "throttle":
        return "text-cyan-500 bg-cyan-500/10 border-cyan-200 dark:border-cyan-900";
      case "block_request":
        return "text-rose-500 bg-rose-500/10 border-rose-200 dark:border-rose-900";
      default:
        return "text-gray-500 bg-gray-500/10 border-gray-200 dark:border-gray-800";
    }
  };

  const belowLabel = (rule: Rule) => {
    const actions = rule.actions || [];
    const primaryAction = actions[0];

    if (!primaryAction) return "";

    const actionCount = actions.length > 1 ? ` (+${actions.length - 1} more)` : "";

    switch (primaryAction.type) {
      case "map_local":
        return (
          t("rules.summary.map_local", {
            path: primaryAction.localPath
              ? primaryAction.localPath.split(/[/\\]/).pop()
              : t("rules.summary.manual_mock"),
          }) + actionCount
        );
      case "map_remote":
        return (
          t("rules.summary.map_remote", {
            url: new URL(primaryAction.targetUrl).hostname,
          }) + actionCount
        );
      case "rewrite_body": {
        const target = t(`rules.summary.types.${primaryAction.target}`);
        let typeKey = "set";
        if (primaryAction.replace) typeKey = "replace";
        else if (primaryAction.regex_replace) typeKey = "regex";
        else if (primaryAction.json) typeKey = "json";
        const type = t(`rules.summary.types.${typeKey}`);
        return t("rules.summary.rewrite_body", { target, type }) + actionCount;
      }
      case "throttle":
        return t("rules.summary.throttle", { delay: primaryAction.delayMs }) + actionCount;
      case "rewrite_header": {
        const reqCount = primaryAction.headers?.request?.length || 0;
        const resCount = primaryAction.headers?.response?.length || 0;
        return t("rules.summary.rewrite_header", { req: reqCount, res: resCount }) + actionCount;
      }
      case "block_request":
        return t("rules.summary.block") + actionCount;
      default:
        return "";
    }
  };
  return (
    <div className="p-2 space-y-1">
      <AnimatePresence initial={false}>
        {rules.map((rule, index) => {
          const colorClass = getRuleColorCheck(rule.type);
          const conflict = conflicts[rule.id];
          const isSelected = rule.id === selectedRuleId;

          return (
            <motion.div
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              key={rule.id}
              className={`group relative flex items-center px-3 py-1.5 rounded-2xl border transition-all duration-300 ${
                isSelected
                  ? "bg-primary/12 border-primary/40 shadow-md shadow-primary/5 ring-1 ring-primary/20 z-10"
                  : `bg-card hover:shadow-xl hover:shadow-primary/5 hover:border-primary/20 ${rule.execution.enabled ? "border-border/60" : "border-border/30 bg-muted/30"}`
              }`}
            >
              {/* Inner Glow (Selection) */}
              {isSelected && (
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/10 via-transparent to-transparent pointer-events-none" />
              )}

              {/* Toggle Switch */}
              <div className="pl-0.5 pr-2.5 relative z-10">
                <Tooltip
                  content={rule.execution.enabled ? t("common.disable") : t("common.enable")}
                >
                  <Switch
                    size="sm"
                    checked={rule.execution.enabled}
                    onCheckedChange={() => toggleRule(rule.id)}
                  />
                </Tooltip>
              </div>

              {/* Icon Box */}
              <div
                className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-lg mr-2.5 ${colorClass
                  .split(" ")
                  .filter((c) => !c.includes("border"))
                  .join(" ")}`}
              >
                {getRuleIcon(rule.type)}
              </div>

              {/* Content */}
              <div
                className="relative z-10 flex-1 min-w-0 mr-2.5 cursor-pointer group/content"
                onClick={() => onEdit(rule)}
              >
                <div className="flex items-center gap-2 mb-0 min-h-[20px]">
                  <span
                    className={`font-semibold text-xs truncate transition-colors tracking-tight ${
                      rule.execution.enabled
                        ? isSelected
                          ? "text-primary"
                          : "group-hover/content:text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    {rule.name}
                  </span>
                  {conflict && rule.execution.enabled && (
                    <Tooltip
                      content={
                        <div className="max-w-[200px] whitespace-normal space-y-1">
                          <p className="font-semibold text-red-400">
                            {t("rules.conflict.shadowed")}
                          </p>
                          <p className="text-[10px] opacity-80 leading-tight">
                            {t("rules.conflict.shadowed_desc", {
                              name: allRules.find((r) => r.id === conflict.byRuleId)?.name,
                            })}
                          </p>
                        </div>
                      }
                    >
                      <div className="flex items-center gap-1 bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full border border-destructive/20 shadow-sm animate-pulse cursor-help pointer-events-auto">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        <span className="text-[9px] uppercase font-semibold leading-none">
                          {t("rules.conflict.overridden")}
                        </span>
                      </div>
                    </Tooltip>
                  )}
                  {!rule.execution.enabled && (
                    <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground/80 leading-none">
                      {t("common.disabled")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground/80">
                  <span
                    className={`truncate opacity-100 ${conflict && rule.execution.enabled ? "line-through decoration-destructive/40" : ""} ${isSelected ? "text-primary/90" : ""}`}
                  >
                    {rule.match.request.find((m) => m.type === "url" || m.type === "host")?.value ||
                      t("rules.match_all")}
                  </span>
                  {belowLabel(rule) && (
                    <>
                      <span className="opacity-30 text-[10px]">•</span>
                      <span className="truncate text-[11px] text-muted-foreground/70">
                        {belowLabel(rule)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200">
                <Tooltip content={t("common.move_up")}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      moveRule(rule.id, "up");
                    }}
                    disabled={index === 0}
                    className="p-1.5 hover:bg-primary/5 rounded-xl text-muted-foreground hover:text-primary transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                </Tooltip>
                <Tooltip content={t("common.move_down")}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      moveRule(rule.id, "down");
                    }}
                    disabled={index === rules.length - 1}
                    className="p-1.5 hover:bg-primary/5 rounded-xl text-muted-foreground hover:text-primary transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </Tooltip>
                <div className="w-px h-3 bg-border/40 mx-1" />
                <CopyButton
                  text={JSON.stringify(rule, null, 2)}
                  className="p-1.5"
                  label={t("common.copy_json")}
                />
                <Tooltip content={t("common.edit")}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(rule);
                    }}
                    className="p-1.5 hover:bg-primary/5 rounded-xl text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                </Tooltip>
                <Tooltip content={t("common.delete")}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      showConfirm({
                        title: t("rules.alerts.delete_title"),
                        message: t("rules.alerts.delete_msg"),
                        variant: "danger",
                        onConfirm: () => deleteRule(rule.id),
                      });
                    }}
                    className="p-1.5 hover:bg-destructive/5 rounded-xl text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </Tooltip>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
