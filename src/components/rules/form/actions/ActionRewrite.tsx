import { CheckCircle2, Circle, Info, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JsonModification } from "../../../../types/rules";
import { Button } from "../../../common/Button";
import { Input } from "../../../common/Input";
import { SegmentedControl } from "../../../common/SegmentedControl";
import { Select } from "../../../common/Select";

interface ActionRewriteProps {
  target: "request" | "response";
  onChangeTarget: (val: "request" | "response") => void;
  type: "set" | "replace" | "regex_replace" | "json";
  onChangeType: (val: "set" | "replace" | "regex_replace" | "json") => void;

  // Set content fields
  content: string;
  onChangeContent: (val: string) => void;
  statusCode?: number;
  onChangeStatusCode: (val?: number) => void;
  contentType?: string;
  onChangeContentType: (val?: string) => void;

  // Replace/Regex fields
  pattern: string;
  onChangePattern: (val: string) => void;
  replacement: string;
  onChangeReplacement: (val: string) => void;

  // JSON fields
  jsonModifications: JsonModification[];
  onChangeJsonModifications: (mods: JsonModification[]) => void;
}

const LABEL_STYLE = "text-xs font-bold text-foreground/50 uppercase tracking-widest mb-0.5 block";

export function ActionRewrite({
  target,
  onChangeTarget,
  type,
  onChangeType,
  content,
  onChangeContent,
  statusCode,
  onChangeStatusCode,
  contentType,
  onChangeContentType,
  pattern,
  onChangePattern,
  replacement,
  onChangeReplacement,
  jsonModifications,
  onChangeJsonModifications,
}: ActionRewriteProps) {
  const { t } = useTranslation();

  // JSON Helper functions
  const addJsonMod = () =>
    onChangeJsonModifications([...jsonModifications, { path: "", value: "", operation: "set" }]);

  const updateJsonMod = (idx: number, field: keyof JsonModification, val: any) => {
    const newMods = [...jsonModifications];
    newMods[idx] = { ...newMods[idx], [field]: val };
    onChangeJsonModifications(newMods);
  };

  const removeJsonMod = (idx: number) => {
    onChangeJsonModifications(jsonModifications.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4 p-3.5 bg-muted/20 rounded-xl border border-border/40">
      <div className="space-y-3">
        <div className="space-y-1">
          <SegmentedControl
            name="rewrite-target"
            options={[
              { label: t("rule_editor.action.rewrite.req"), value: "request" },
              { label: t("rule_editor.action.rewrite.res"), value: "response" },
            ]}
            value={target}
            onChange={(val) => onChangeTarget(val as any)}
          />
        </div>

        {/* Independent Response Settings - Moved above Rewrite Mode */}
        {target === "response" && (
          <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className={LABEL_STYLE}>
                  {t("rule_editor.action.map_local.content_type")}
                </label>
                <span className="text-xs text-muted-foreground/40 font-medium mb-0.5 uppercase tracking-tighter">
                  {t("common.optional")}
                </span>
              </div>
              <Input
                type="text"
                value={contentType || ""}
                onChange={(e) => onChangeContentType(e.target.value)}
                placeholder="application/json"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className={LABEL_STYLE}>{t("rule_editor.action.rewrite.status_code")}</label>
                <span className="text-xs text-muted-foreground/40 font-medium mb-0.5 uppercase tracking-tighter">
                  {t("common.optional")}
                </span>
              </div>
              <Input
                type="number"
                value={statusCode ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  onChangeStatusCode(val === "" ? undefined : parseInt(val, 10));
                }}
                placeholder="200"
                className="font-mono text-xs"
              />
            </div>
          </div>
        )}

        <div className="space-y-1">
          <label className={LABEL_STYLE}>{t("rule_editor.action.rewrite.type")}</label>
          <SegmentedControl
            name="rewrite-mode"
            options={[
              {
                label: t("rule_editor.action.rewrite.modes_set"),
                value: "set",
              },
              {
                label: t("rule_editor.action.rewrite.modes_replace"),
                value: "replace",
              },
              {
                label: t("rule_editor.action.rewrite.modes_regex"),
                value: "regex_replace",
              },
              {
                label: t("rule_editor.action.rewrite.modes_json"),
                value: "json",
              },
            ]}
            value={type}
            onChange={(val) => onChangeType(val as any)}
          />
        </div>

        {type === "set" && (
          <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="space-y-1">
              <label className={LABEL_STYLE}>{t("rule_editor.action.rewrite.modes_set")}</label>
              <textarea
                value={content}
                onChange={(e) => onChangeContent(e.target.value)}
                className="w-full h-40 bg-background border border-input rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all resize-none"
                placeholder={t("rule_editor.action.rewrite.placeholders_content")}
              />
            </div>
          </div>
        )}

        {type === "json" && target === "response" && (
          <div className="hidden">{/* Hidden block to remove previous injection if any */}</div>
        )}

        {(type === "replace" || type === "regex_replace") && (
          <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="space-y-1">
              <label className={LABEL_STYLE}>
                {type === "regex_replace"
                  ? t("rule_editor.action.rewrite.placeholders_regex_pattern")
                  : t("rule_editor.action.rewrite.placeholders_pattern")}
              </label>
              <Input
                type="text"
                value={pattern}
                onChange={(e) => onChangePattern(e.target.value)}
                placeholder={type === "regex_replace" ? "^Hello (.*)$" : "Hello World"}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL_STYLE}>
                {t("rule_editor.action.rewrite.placeholders_replacement")}
              </label>
              <Input
                type="text"
                value={replacement}
                onChange={(e) => onChangeReplacement(e.target.value)}
                placeholder={type === "regex_replace" ? "Hi $1" : "Hi Universe"}
                className="font-mono text-xs"
              />
            </div>
          </div>
        )}

        {type === "json" && (
          <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="space-y-2">
              <div className="flex items-start gap-3 px-3 py-2.5 bg-primary/5 border border-primary/10 border-l-2 border-l-primary rounded-lg mb-4 animate-in fade-in slide-in-from-top-1">
                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs text-primary/80 leading-relaxed font-medium">
                  {t("rule_editor.action.rewrite.jsonpath_hint")}
                </p>
              </div>
              {jsonModifications.map((mod, i) => (
                <div
                  key={i}
                  className="flex gap-2 items-center p-2 bg-background/80 rounded-lg border border-border/50 shadow-sm"
                >
                  <button
                    onClick={() => updateJsonMod(i, "enabled", mod.enabled === false)}
                    className={`p-1 rounded-lg transition-colors ${mod.enabled !== false ? "text-primary" : "text-muted-foreground/30"}`}
                  >
                    {mod.enabled !== false ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <Circle className="w-4 h-4" />
                    )}
                  </button>
                  <div className="flex-1 flex gap-2 items-center">
                    <Input
                      value={mod.path}
                      onChange={(e) => updateJsonMod(i, "path", e.target.value)}
                      placeholder="$.store.book[0].title"
                      className="flex-1 h-7 text-ui font-mono px-2"
                    />
                    <Select
                      value={mod.operation || "set"}
                      onChange={(val) => updateJsonMod(i, "operation", val)}
                      className="w-24 text-xs h-7 min-h-0 py-0"
                      containerClassName="w-24 shrink-0"
                    >
                      <option value="set">
                        {t("rule_editor.action.rewrite.json_ops_set", "Set")}
                      </option>
                      <option value="delete">
                        {t("rule_editor.action.rewrite.json_ops_delete", "Delete")}
                      </option>
                      <option value="append">
                        {t("rule_editor.action.rewrite.json_ops_append", "Append")}
                      </option>
                    </Select>
                    {mod.operation !== "delete" && (
                      <Input
                        value={
                          typeof mod.value === "string" ? mod.value : JSON.stringify(mod.value)
                        }
                        onChange={(e) => updateJsonMod(i, "value", e.target.value)}
                        placeholder={t(
                          "rule_editor.action.rewrite.json_value_placeholder",
                          "Value (JSON)",
                        )}
                        className="flex-1 h-7 text-ui font-mono px-2"
                      />
                    )}
                  </div>
                  <button
                    onClick={() => removeJsonMod(i)}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-1 rounded transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <Button
                variant="outline"
                onClick={addJsonMod}
                className="w-full h-auto py-3 text-ui border-dashed border-border/60 hover:bg-muted/50 text-muted-foreground mt-2 flex items-center justify-center gap-2"
              >
                <span className="text-lg leading-none">+</span>
                {t("common.add")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
