import {
  Ban,
  FileCode,
  FileSignature,
  Globe,
  Info,
  LayoutList,
  Loader2,
  Wand2,
  Wifi,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getAILanguageInfo } from "../../../lib/ai/lang";
import { NAMING_ASSISTANT_SYSTEM_PROMPT } from "../../../lib/ai/prompts";
import { cleanAIResult } from "../../../lib/ai/utils";
import { Logger } from "../../../lib/logger";
import { getRuleTypeTheme } from "../../../lib/ruleTypeTheme";
import { useAIStore } from "../../../stores/aiStore";
import { useRuleStore } from "../../../stores/ruleStore";
import type { RuleType } from "../../../types/rules";
import { Input } from "../../common/Input";
import { Select } from "../../common/Select";
import { Tooltip } from "../../common/Tooltip";

interface BasicInfoProps {
  name: string;
  onChangeName: (name: string) => void;
  groupId: string;
  onChangeGroup: (groupId: string) => void;
  ruleType: RuleType;
  onChangeType: (type: RuleType) => void;
  context?: {
    urlPattern: string;
    urlMatchType: string;
    methods: string[];
  };
}

const LABEL_STYLE = "text-xs font-bold text-foreground/60 uppercase tracking-widest mb-0.5 block";

export function BasicInfo({
  name,
  onChangeName,
  groupId,
  onChangeGroup,
  ruleType,
  onChangeType,
  context,
}: BasicInfoProps) {
  const { t } = useTranslation();
  const { groups } = useRuleStore();
  const { chatCompletionStream, settings: aiSettings } = useAIStore();
  const [isGeneratingName, setIsGeneratingName] = useState(false);

  const handleAutoName = async () => {
    if (isGeneratingName) return;
    setIsGeneratingName(true);

    try {
      const langInfo = getAILanguageInfo();

      const systemMsg = {
        role: "system" as const,
        content: NAMING_ASSISTANT_SYSTEM_PROMPT.replace(/{{LANGUAGE}}/g, langInfo.name).replace(
          /{{TERMINOLOGY}}/g,
          langInfo.terminology,
        ),
      };

      const userMsg = {
        role: "user" as const,
        content: `Generate a name for this rule config: ${JSON.stringify({
          urlPattern: context?.urlPattern,
          urlMatchType: context?.urlMatchType,
          methods: context?.methods,
          type: ruleType,
        })}`,
      };

      let fullName = "";
      await chatCompletionStream([systemMsg, userMsg], (chunk) => {
        fullName += chunk;
      });

      if (fullName) {
        const cleaned = cleanAIResult(fullName)
          .replace(/^["']|["']$/g, "")
          .replace(/\.$/, "");
        onChangeName(cleaned);
      }
    } catch (error) {
      Logger.error("Naming generation failed", error);
    } finally {
      setIsGeneratingName(false);
    }
  };

  return (
    <section className="space-y-4 relative z-10">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-1 h-3.5 bg-primary rounded-full shadow-[0_0_10px_rgba(var(--primary-rgb),0.5)]" />
        <span className="text-xs font-bold text-foreground/90 uppercase tracking-widest py-1">
          {t("rules.editor.sections.core")}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className={LABEL_STYLE}>{t("rules.editor.core.name")}</label>
          <div className="relative group/nameinput">
            <Input
              type="text"
              value={name}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder={t("rules.editor.core.name_placeholder")}
              className="pr-10"
              autoFocus={!name}
            />
            <div className="absolute right-1 top-1 bottom-1 flex items-center justify-center z-30">
              {aiSettings.enabled && (
                <Tooltip content={t("ai.assistant.naming.suggestions.auto")} side="left">
                  <button
                    onClick={handleAutoName}
                    disabled={isGeneratingName}
                    className={`p-1.5 rounded-lg transition-all ${
                      isGeneratingName
                        ? "text-primary bg-primary/10"
                        : "text-muted-foreground/40 hover:text-primary hover:bg-primary/10"
                    }`}
                  >
                    {isGeneratingName ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className={LABEL_STYLE}>{t("rules.editor.core.group")}</label>
            <Select
              value={groupId}
              onChange={onChangeGroup}
              className=""
              containerClassName="w-full"
              placeholder={t("common.select_placeholder")}
            >
              <option value="">{t("rules.editor.core.no_group")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className={LABEL_STYLE}>{t("rules.editor.core.type")}</label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            {
              id: "rewrite_body",
              label: t("rules.editor.core.types.rewrite_body_label"),
              icon: FileSignature,
              desc: t("rules.editor.core.types.rewrite_body_desc"),
            },
            {
              id: "rewrite_header",
              label: t("rules.editor.core.types.rewrite_label"),
              icon: LayoutList,
              desc: t("rules.editor.core.types.rewrite_desc"),
            },
            {
              id: "map_local",
              label: t("rules.editor.core.types.map_local_label"),
              icon: FileCode,
              desc: t("rules.editor.core.types.map_local_desc"),
            },
            {
              id: "map_remote",
              label: t("rules.editor.core.types.map_remote_label"),
              icon: Globe,
              desc: t("rules.editor.core.types.map_remote_desc"),
            },
            {
              id: "throttle",
              label: t("rules.editor.core.types.throttle_label"),
              icon: Wifi,
              desc: t("rules.editor.core.types.throttle_desc"),
            },
            {
              id: "block_request",
              label: t("rules.editor.core.types.block_label"),
              icon: Ban,
              desc: t("rules.editor.core.types.block_desc"),
            },
          ].map((type) => {
            const theme = getRuleTypeTheme(type.id as RuleType);

            return (
              <Tooltip key={type.id} content={type.desc} side="top">
                <button
                  onClick={() => onChangeType(type.id as RuleType)}
                  className={`w-full flex items-center justify-start gap-2.5 py-2 px-2.5 rounded-xl border transition-all duration-300 ${
                    ruleType === type.id
                      ? `${theme.bg} ${theme.border} ring-1 ring-inset ring-primary/30 shadow-[0_0_15px_rgba(0,0,0,0.1)] scale-[1.02]`
                      : "bg-card/50 border-border/40 hover:border-primary/30 hover:bg-primary/5"
                  }`}
                >
                  <div
                    className={`p-1.5 rounded-lg transition-colors ${ruleType === type.id ? "bg-background shadow-sm" : "bg-muted/30"}`}
                  >
                    <type.icon
                      className={`w-3.5 h-3.5 ${ruleType === type.id ? theme.text : "text-muted-foreground/60"}`}
                    />
                  </div>
                  <div
                    className={`text-xs font-semibold tracking-wide ${ruleType === type.id ? "text-foreground" : "text-muted-foreground/80"}`}
                  >
                    {type.label}
                  </div>
                </button>
              </Tooltip>
            );
          })}
        </div>

        {/* Behavior Hint Banner */}
        <div
          className={`mt-2 px-3 py-2 rounded-lg border flex items-center gap-2 transition-all duration-300 ${
            ruleType === "block_request"
              ? "bg-rule-block-soft border-rule-block-soft text-rule-block"
              : ruleType === "map_local"
                ? "bg-warning/5 border-warning/20 text-warning"
                : "bg-primary/5 border-primary/10 text-primary"
          }`}
        >
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs font-medium leading-tight">
            {ruleType === "block_request"
              ? t("rules.editor.core.hints.terminal")
              : ruleType === "map_local"
                ? t("rules.editor.core.hints.request_terminal")
                : t("rules.editor.core.hints.modify")}
          </span>
        </div>
      </div>
    </section>
  );
}
