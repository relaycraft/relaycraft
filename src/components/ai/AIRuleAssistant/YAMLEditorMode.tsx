import type { TFunction } from "i18next";
import { Check, RotateCcw, SquareCode, X } from "lucide-react";
import { Button } from "../../common/Button";
import { CopyButton } from "../../common/CopyButton";
import { Editor } from "../../common/Editor";
import { Tooltip } from "../../common/Tooltip";

interface YAMLEditorModeProps {
  t: TFunction;
  yamlContent: string;
  yamlErrors: string[];
  canReset: boolean;
  canApply: boolean;
  onChange: (value: string) => void;
  onBeautify: () => void;
  onReset: () => void;
  onApply: () => void;
}

export function YAMLEditorMode({
  t,
  yamlContent,
  yamlErrors,
  canReset,
  canApply,
  onChange,
  onBeautify,
  onReset,
  onApply,
}: YAMLEditorModeProps) {
  return (
    <div className="space-y-3 animate-in fade-in duration-200">
      <div className="relative group border border-border/40 rounded-xl overflow-hidden bg-muted/5 h-[400px] focus-within:ring-2 focus-within:ring-primary/20 transition-all">
        <Editor
          language="yaml"
          value={yamlContent}
          onChange={onChange}
          options={{
            lineNumbers: "on",
            tabSize: 2,
            lineWrapping: true,
          }}
        />
        <div className="absolute right-3 top-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <Tooltip content={t("common.beautify")}>
            <Button variant="quiet" size="icon-sm" onClick={onBeautify}>
              <SquareCode className="w-3 h-3" />
            </Button>
          </Tooltip>
          <CopyButton text={yamlContent} variant="quiet" className="h-8 w-8" />
        </div>
      </div>

      {yamlErrors.length > 0 && (
        <div className="space-y-1">
          {yamlErrors.map((err, i) => (
            <div key={i} className="text-xs text-destructive flex items-start gap-1 px-1">
              <X className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end items-center pt-1">
        <div className="flex items-center gap-2">
          <Button
            variant="quiet"
            size="sm"
            onClick={onReset}
            disabled={!canReset}
            className="h-8 text-ui"
          >
            <RotateCcw className="w-3 h-3 mr-1.5" />
            {t("common.reset")}
          </Button>
          <Button size="sm" onClick={onApply} className="gap-1.5" disabled={!canApply}>
            <Check className="w-3.5 h-3.5" />
            {t("rules.editor.ai.apply_yaml")}
          </Button>
        </div>
      </div>
    </div>
  );
}
