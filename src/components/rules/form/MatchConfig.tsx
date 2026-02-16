import { AlertCircle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HttpMethod, UrlMatchType } from "../../../types/rules";
import { AIAssistant } from "../../ai/AIAssistant";
import { Button } from "../../common/Button";
import { Input } from "../../common/Input";
import { SegmentedControl } from "../../common/SegmentedControl";
import { Select } from "../../common/Select";
import { Tooltip } from "../../common/Tooltip";

interface HeaderMatch {
  key: string;
  value?: string;
  matchType: "contains" | "exact" | "regex";
}

interface MatchConfigProps {
  urlPattern: string;
  onChangeUrlPattern: (val: string) => void;
  urlMatchType: UrlMatchType;
  onChangeUrlMatchType: (val: UrlMatchType) => void;
  methods: HttpMethod[];
  onChangeMethods: (methods: HttpMethod[]) => void;
  requiredHeaders: HeaderMatch[];
  onChangeHeaders: (headers: HeaderMatch[]) => void;
}

// LABEL_STYLE removed

export function MatchConfig({
  urlPattern,
  onChangeUrlPattern,
  urlMatchType,
  onChangeUrlMatchType,
  methods,
  onChangeMethods,
  requiredHeaders,
  onChangeHeaders,
}: MatchConfigProps) {
  const { t } = useTranslation();

  // Local state for match testing
  const [testUrl, setTestUrl] = useState("");
  const [isMatch, setIsMatch] = useState<boolean | null>(null);

  // Live matching logic
  useEffect(() => {
    if (!(testUrl && urlPattern)) {
      setIsMatch(null);
      return;
    }

    try {
      if (urlMatchType === "exact") {
        setIsMatch(testUrl === urlPattern);
      } else if (urlMatchType === "contains") {
        setIsMatch(testUrl.includes(urlPattern));
      } else if (urlMatchType === "regex") {
        const re = new RegExp(urlPattern);
        setIsMatch(re.test(testUrl));
      } else if (urlMatchType === "wildcard") {
        const re = new RegExp(
          "^" +
            urlPattern
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, ".") +
            "$",
        );
        setIsMatch(re.test(testUrl));
      }
    } catch (_e) {
      setIsMatch(false);
    }
  }, [testUrl, urlPattern, urlMatchType]);

  const toggleMethod = (method: HttpMethod) => {
    onChangeMethods(
      methods.includes(method) ? methods.filter((m) => m !== method) : [...methods, method],
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-1 h-3.5 bg-primary rounded-full shadow-[0_0_10px_rgba(var(--primary-rgb),0.5)]" />
        <span className="text-small font-bold text-foreground/90 uppercase tracking-widest py-1">
          {t("rule_editor.sections.match")}
        </span>
      </div>

      <div className="space-y-3">
        {/* URL Match */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-col gap-2 p-3 bg-muted/20 rounded-xl border border-border/40">
            <SegmentedControl
              name="url-match-type"
              options={[
                {
                  label: t("rule_editor.match.url_match_type.contains"),
                  value: "contains",
                },
                {
                  label: t("rule_editor.match.url_match_type.exact"),
                  value: "exact",
                },
                {
                  label: t("rule_editor.match.url_match_type.regex"),
                  value: "regex",
                },
                {
                  label: t("rule_editor.match.url_match_type.wildcard"),
                  value: "wildcard",
                },
              ]}
              value={urlMatchType}
              onChange={(val) => onChangeUrlMatchType(val as UrlMatchType)}
              className="mb-1"
            />
            <div className="relative group/urlinput">
              <Input
                type="text"
                value={urlPattern}
                onChange={(e) => onChangeUrlPattern(e.target.value)}
                placeholder={t("rule_editor.match.url_placeholder")}
                className="h-8 font-mono text-ui placeholder:font-sans placeholder:text-small pr-10 bg-background/50"
              />
              {urlMatchType === "regex" && (
                <div className="absolute right-2 top-0 bottom-0 flex items-center justify-center z-30">
                  <AIAssistant
                    mode="regex"
                    value={urlPattern}
                    onGenerate={(regex) => {
                      onChangeUrlPattern(regex);
                      onChangeUrlMatchType("regex");
                    }}
                  />
                </div>
              )}
            </div>

            {/* Live Match Test */}
            <div className="mt-1 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-small font-bold text-foreground/60 uppercase tracking-widest">
                  {t("rule_editor.match.test.label")}
                </label>
                {testUrl && (
                  <div
                    className={`text-caption font-semibold px-1.5 py-0 rounded-full flex items-center gap-1 transition-all duration-300 ${isMatch ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}
                  >
                    {isMatch ? (
                      <CheckCircle2 className="w-2.5 h-2.5" />
                    ) : (
                      <AlertCircle className="w-2.5 h-2.5" />
                    )}
                    {isMatch
                      ? t("rule_editor.match.test.matched")
                      : t("rule_editor.match.test.not_matched")}
                  </div>
                )}
              </div>
              <Input
                type="text"
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                placeholder={t("rule_editor.match.test.placeholder")}
                className="h-8 bg-background/30 border-dashed border-input transition-all focus:border-solid text-ui placeholder:text-small"
              />
            </div>
          </div>
        </div>

        {/* Methods */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Button
              size="xs"
              variant={methods.length === 0 ? "default" : "outline"}
              onClick={() => onChangeMethods([])}
              className={methods.length === 0 ? "" : "text-muted-foreground hover:text-foreground"}
            >
              ANY
            </Button>
            {(["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"] as HttpMethod[]).map(
              (method) => {
                const isSelected = methods.includes(method);
                return (
                  <Button
                    key={method}
                    size="xs"
                    variant={isSelected ? "default" : "outline"}
                    onClick={() => toggleMethod(method)}
                    className={isSelected ? "" : "text-muted-foreground hover:text-foreground"}
                  >
                    {method}
                  </Button>
                );
              },
            )}
          </div>
        </div>

        {/* Headers Match */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <label className="text-small font-bold text-foreground/60 uppercase tracking-widest">
                {t("rule_editor.match.headers.label")}
              </label>
              <span className="text-caption text-muted-foreground/40 font-medium uppercase tracking-tighter">
                {t("common.optional")}
              </span>
              <Tooltip content={t("rule_editor.match.headers.tooltip")}>
                <AlertCircle className="w-3 h-3 text-muted-foreground/40 cursor-help" />
              </Tooltip>
            </div>
          </div>

          <div className="space-y-4 p-4 bg-muted/20 rounded-xl border border-border/40">
            {requiredHeaders.length > 0 && (
              <div className="space-y-2">
                {requiredHeaders.map((header, index) => (
                  <div key={index} className="flex gap-2 items-center group">
                    <div className="flex-1 grid grid-cols-[1.5fr_1fr_2fr] gap-2">
                      <div>
                        <Input
                          type="text"
                          value={header.key}
                          onChange={(e) => {
                            const newHeaders = [...requiredHeaders];
                            newHeaders[index].key = e.target.value;
                            onChangeHeaders(newHeaders);
                          }}
                          placeholder="Key"
                          className="h-8 py-1 px-2 text-ui placeholder:text-small font-mono w-full"
                        />
                      </div>
                      <div>
                        <Select
                          value={header.matchType}
                          onChange={(val) => {
                            const newHeaders = [...requiredHeaders];
                            newHeaders[index].matchType = val as any;
                            onChangeHeaders(newHeaders);
                          }}
                          className="h-8 py-1 text-small w-full"
                          containerClassName="w-full"
                        >
                          <option value="exact">
                            {t("rule_editor.match.url_match_type.exact")}
                          </option>
                          <option value="contains">
                            {t("rule_editor.match.url_match_type.contains")}
                          </option>
                          <option value="regex">
                            {t("rule_editor.match.url_match_type.regex")}
                          </option>
                        </Select>
                      </div>
                      <div>
                        <Input
                          value={header.value}
                          onChange={(e) => {
                            const newHeaders = [...requiredHeaders];
                            newHeaders[index].value = e.target.value;
                            onChangeHeaders(newHeaders);
                          }}
                          placeholder="Value"
                          className="h-8 py-1 px-2 text-ui placeholder:text-small w-full"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onChangeHeaders(requiredHeaders.filter((_, i) => i !== index))}
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() =>
                onChangeHeaders([...requiredHeaders, { key: "", value: "", matchType: "exact" }])
              }
              className="w-full py-2 flex items-center justify-center gap-1.5 border border-dashed border-border rounded-lg text-small font-medium text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("rule_editor.match.headers.add")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
