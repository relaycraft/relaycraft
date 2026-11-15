import { Crosshair, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "../../lib/notify";
import { cn } from "../../lib/utils";
import { isCaptureScopeEnabled, useCaptureScopeStore } from "../../stores/captureScopeStore";
import { Button } from "../common/Button";
import { Input } from "../common/Input";

function parseEntries(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function CaptureScopeButton() {
  const { t } = useTranslation();
  const scope = useCaptureScopeStore((s) => s.scope);
  const loaded = useCaptureScopeStore((s) => s.loaded);
  const recentProcesses = useCaptureScopeStore((s) => s.recentProcesses);
  const load = useCaptureScopeStore((s) => s.load);
  const apply = useCaptureScopeStore((s) => s.apply);
  const loadRecentProcesses = useCaptureScopeStore((s) => s.loadRecentProcesses);

  const [open, setOpen] = useState(false);
  const [includeText, setIncludeText] = useState("");
  const [excludeText, setExcludeText] = useState("");
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const enabled = isCaptureScopeEnabled(scope);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (open) {
      setIncludeText(scope.include.join(", "));
      setExcludeText(scope.exclude.join(", "));
      loadRecentProcesses();
    }
  }, [open, scope.include, scope.exclude, loadRecentProcesses]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const handleApply = async () => {
    setSaving(true);
    try {
      await apply({ include: parseEntries(includeText), exclude: parseEntries(excludeText) });
      setOpen(false);
    } catch (e) {
      notify.error(typeof e === "string" ? e : t("capture_scope.apply_failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await apply({ include: [], exclude: [] });
      setIncludeText("");
      setExcludeText("");
    } finally {
      setSaving(false);
    }
  };

  const addToInclude = (name: string) => {
    const entries = parseEntries(includeText);
    if (!entries.includes(name)) {
      setIncludeText([...entries, name].join(", "));
    }
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Button
        size="tiny"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "gap-1 font-medium",
          enabled
            ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20"
            : "text-muted-foreground/70",
        )}
        title={t("capture_scope.button_hint")}
      >
        <Crosshair className="w-3 h-3" />
        {t("capture_scope.button")}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-(--z-dropdown) w-[340px] relaycraft-popup rounded-xl border border-border/60 bg-popover/95 backdrop-blur-xl shadow-xl p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              {t("capture_scope.title")}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 text-muted-foreground/60 hover:text-foreground rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-micro font-semibold tracking-wider text-muted-foreground uppercase">
              {t("capture_scope.include_label")}
            </label>
            <Input
              value={includeText}
              onChange={(e) => setIncludeText(e.target.value)}
              placeholder={t("capture_scope.include_placeholder")}
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-micro font-semibold tracking-wider text-muted-foreground uppercase">
              {t("capture_scope.exclude_label")}
            </label>
            <Input
              value={excludeText}
              onChange={(e) => setExcludeText(e.target.value)}
              placeholder={t("capture_scope.exclude_placeholder")}
              className="h-8 text-xs font-mono"
            />
          </div>

          {recentProcesses.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-micro font-semibold tracking-wider text-muted-foreground uppercase">
                {t("capture_scope.recent_label")}
              </label>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {recentProcesses.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => addToInclude(p.name)}
                    className="px-1.5 py-0.5 rounded-md bg-muted/60 hover:bg-primary/15 hover:text-primary text-[11px] font-mono text-muted-foreground transition-colors"
                    title={p.path ?? p.name}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-tiny text-muted-foreground/60 leading-relaxed">
            {t("capture_scope.syntax_hint")}
          </p>
          <p className="text-tiny text-muted-foreground/60 leading-relaxed">
            {t("capture_scope.semantics_note")}
          </p>

          <div className="flex items-center justify-end gap-1.5 pt-1">
            <Button
              size="tiny"
              variant="ghost"
              onClick={handleClear}
              disabled={saving || !(enabled || includeText || excludeText)}
            >
              {t("capture_scope.clear")}
            </Button>
            <Button size="tiny" onClick={handleApply} disabled={saving || !loaded}>
              {t("capture_scope.apply")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
