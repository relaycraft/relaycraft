import type { TFunction } from "i18next";
import { Bot, Code, Loader2, PlusCircle, Wand2 } from "lucide-react";
import type { Rule } from "../../../types/rules";
import { Button } from "../../common/Button";
import { Input } from "../../common/Input";
import { Skeleton } from "../../common/Skeleton";
import { AIMarkdown } from "../AIMarkdown";

interface AIRuleModeProps {
  t: TFunction;
  prompt: string;
  generating: boolean;
  detectedIntent: "explain" | "rule" | "unknown";
  preview: Partial<Rule> | null;
  explanation: string | null;
  initialRule?: Partial<Rule>;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onGenerateWithPrompt: (value: string) => void;
  onEditPreviewYAML: () => void;
  onApplyPreview: () => void;
}

export function AIRuleMode({
  t,
  prompt,
  generating,
  detectedIntent,
  preview,
  explanation,
  initialRule,
  onPromptChange,
  onGenerate,
  onGenerateWithPrompt,
  onEditPreviewYAML,
  onApplyPreview,
}: AIRuleModeProps) {
  return (
    <>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Input
            type="text"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onGenerate()}
            placeholder={t("rules.editor.ai.placeholder")}
            className="pr-10 text-xs rounded-xl h-8 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/40"
            autoFocus
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2">
            {generating ? (
              <div className="p-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              </div>
            ) : (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onGenerate}
                disabled={!prompt}
                className="hover:bg-transparent"
              >
                <Wand2 className="w-4 h-4 text-primary hover:scale-110 transition-transform disabled:opacity-30" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {initialRule?.id ? (
          <>
            <button
              onClick={() => onGenerateWithPrompt(t("rules.editor.ai.chip_explain"))}
              className="text-xs font-bold px-3 py-1 bg-muted/20 border border-border/10 rounded-full hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all text-muted-foreground"
            >
              {t("rules.editor.ai.chip_explain")}
            </button>
            <button
              onClick={() => onPromptChange(`${t("rules.editor.ai.chip_modify")}: `)}
              className="text-xs font-bold px-3 py-1 bg-muted/20 border border-border/10 rounded-full hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all text-muted-foreground"
            >
              {t("rules.editor.ai.chip_modify")}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onPromptChange(`${t("rules.editor.ai.chip_create")}: `)}
              className="text-xs font-bold px-3 py-1 bg-muted/20 border border-border/10 rounded-full hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all text-muted-foreground"
            >
              {t("rules.editor.ai.chip_create")}
            </button>
            <button
              onClick={() => onPromptChange(`${t("rules.editor.ai.chip_import")}: `)}
              className="text-xs font-bold px-3 py-1 bg-muted/20 border border-border/10 rounded-full hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all text-muted-foreground"
            >
              {t("rules.editor.ai.chip_import")}
            </button>
          </>
        )}
      </div>

      {generating && detectedIntent === "rule" && (
        <div className="p-3 bg-card border border-primary/10 rounded-xl animate-in fade-in duration-500 shadow-sm space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-14 rounded bg-primary/10" />
            <Skeleton className="h-4 w-24 rounded bg-muted" />
          </div>
          <Skeleton className="h-2.5 w-full rounded bg-muted/60" />
          <div className="flex justify-end gap-2 pt-0.5">
            <Skeleton className="h-7 w-16 rounded bg-muted/40" />
            <Skeleton className="h-7 w-20 rounded bg-primary/20" />
          </div>
        </div>
      )}

      {preview && (
        <div className="flex items-center justify-between p-3 bg-card border border-primary/20 rounded-xl animate-in fade-in zoom-in-95 duration-200 shadow-sm">
          <div className="flex flex-col gap-1 overflow-hidden">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-primary px-1.5 py-0.5 bg-primary/10 rounded uppercase flex-shrink-0">
                {preview.type
                  ? t(
                      `rules.editor.core.types.${preview.type === "rewrite_header" ? "rewrite" : preview.type === "block_request" ? "block" : preview.type}_label`,
                    )
                  : "UNKNOWN"}
              </span>
              <span className="text-xs font-semibold text-foreground truncate">{preview.name}</span>
            </div>
            <div className="text-xs text-muted-foreground font-mono truncate">
              {t("rules.editor.match.label", "Match")}:{" "}
              {preview.match?.request?.find((a) => a.type === "url")?.value || ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="quiet" size="sm" onClick={onEditPreviewYAML} className="text-xs h-8">
              <Code className="w-3 h-3 mr-1" />
              {t("rules.editor.ai.edit_yaml")}
            </Button>
            <Button
              size="sm"
              onClick={onApplyPreview}
              className="flex-shrink-0 gap-1.5 shadow-sm shadow-primary/20"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              {t("rules.editor.ai.fill_form")}
            </Button>
          </div>
        </div>
      )}

      {explanation && (detectedIntent !== "rule" || !generating) && (
        <div className="bg-muted/50 rounded-xl p-4 mb-4 animate-in fade-in slide-in-from-bottom-2 border border-border/40 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 blur-3xl -mr-12 -mt-12" />
          <div className="flex items-start gap-4 relative z-10">
            <div className="mt-1 p-1 bg-primary/10 rounded-lg">
              <Bot className="w-4 h-4 text-primary shrink-0" />
            </div>
            <div className="space-y-2 flex-1 overflow-hidden">
              {detectedIntent === "explain" && (
                <h4 className="text-xs font-bold text-primary tracking-widest uppercase">
                  {t("rules.editor.ai.analysis_title")}
                </h4>
              )}
              <div>
                <AIMarkdown content={explanation || ""} />
                {generating && (
                  <span className="inline-block w-1.5 h-4 ml-1 bg-primary animate-pulse align-middle" />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!(preview || generating || explanation) && <div />}
    </>
  );
}
