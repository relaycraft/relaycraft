import type { TFunction } from "i18next";
import { FileCode } from "lucide-react";
import type { Rule } from "../../../types/rules";
import { Button } from "../../common/Button";
import { CopyButton } from "../../common/CopyButton";
import { Editor } from "../../common/Editor";
import { Switch } from "../../common/Switch";

interface ScriptModeProps {
  t: TFunction;
  scriptContent: string;
  disableOriginal: boolean;
  enableScript: boolean;
  initialRule?: Partial<Rule>;
  onDisableOriginalChange: (value: boolean) => void;
  onEnableScriptChange: (value: boolean) => void;
  onCreateScript: () => void;
}

export function ScriptMode({
  t,
  scriptContent,
  disableOriginal,
  enableScript,
  initialRule,
  onDisableOriginalChange,
  onEnableScriptChange,
  onCreateScript,
}: ScriptModeProps) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
      <div className="relative border border-border/40 rounded-xl overflow-hidden bg-muted/5 h-[400px]">
        <Editor
          language="python"
          value={scriptContent}
          options={{
            readOnly: true,
            lineNumbers: "on",
            tabSize: 4,
          }}
        />
        <div className="absolute top-2 right-2 z-10">
          <CopyButton
            text={scriptContent}
            variant="secondary"
            className="h-8 w-8"
            tooltipSide="left"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="disable-rule"
              size="sm"
              checked={disableOriginal}
              onCheckedChange={onDisableOriginalChange}
              disabled={!initialRule?.id}
            />
            <label
              htmlFor="disable-rule"
              className={`text-xs select-none cursor-pointer ${!initialRule?.id ? "opacity-50" : ""}`}
            >
              {t("rules.editor.ai.script.disable_rule")}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="enable-script"
              size="sm"
              checked={enableScript}
              onCheckedChange={onEnableScriptChange}
            />
            <label htmlFor="enable-script" className="text-xs select-none cursor-pointer">
              {t("rules.editor.ai.script.enable_script")}
            </label>
          </div>
        </div>
        <Button size="sm" onClick={onCreateScript} className="gap-1.5 h-8">
          <FileCode className="w-3.5 h-3.5" />
          {t("rules.editor.ai.script.create_btn")}
        </Button>
      </div>
    </div>
  );
}
