import { Globe, PauseCircle, SlidersHorizontal, Timer } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { useBreakpointStore } from "../../stores/breakpointStore";
import { Button } from "../common/Button";
import { Input } from "../common/Input";
import { Modal } from "../common/Modal";
import { Select } from "../common/Select";

interface AddBreakpointModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUrl: string;
  initialMethod?: string;
}

export function AddBreakpointModal({
  isOpen,
  onClose,
  initialUrl,
  initialMethod: _initialMethod = "GET",
}: AddBreakpointModalProps) {
  const { t } = useTranslation();
  const { addBreakpoint } = useBreakpointStore();

  // Parse initial URL to suggest pattern
  const getUrlSuggestion = useCallback((url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.host;
    } catch {
      return url;
    }
  }, []);

  const [pattern, setPattern] = useState(getUrlSuggestion(initialUrl));
  const [matchType, setMatchType] = useState<"contains" | "exact" | "regex">("contains");
  const [breakOnRequest, setBreakOnRequest] = useState(true);
  const [breakOnResponse, setBreakOnResponse] = useState(false);

  // Reset pattern when modal opens with new URL
  useEffect(() => {
    if (isOpen) {
      setPattern(getUrlSuggestion(initialUrl));
      setMatchType("contains");
      setBreakOnRequest(true);
      setBreakOnResponse(false);
    }
  }, [isOpen, initialUrl, getUrlSuggestion]);

  const handleSave = async () => {
    if (!pattern.trim()) return;

    addBreakpoint({
      pattern: pattern.trim(),
      matchType,
      breakOnRequest,
      breakOnResponse,
    });

    onClose();
  };

  const matchTypeOptions = [
    { value: "contains", label: t("breakpoint.match_types.contains", "Contains") },
    { value: "exact", label: t("breakpoint.match_types.exact", "Exact Match") },
    { value: "regex", label: t("breakpoint.match_types.regex", "Regular Expression") },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("breakpoint.add_title", "Add Breakpoint")}
      icon={<PauseCircle className="w-4 h-4 text-red-500" />}
      className="max-w-md"
    >
      <div className="space-y-6">
        {/* Pattern Input */}
        <div className="space-y-2">
          <label className="text-tiny font-bold text-foreground/60 uppercase tracking-widest flex items-center gap-2">
            <Globe className="w-3.5 h-3.5" />
            {t("breakpoint.pattern", "URL Pattern")}
          </label>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={t("breakpoint.pattern_placeholder", "e.g. api.example.com")}
            className="font-mono text-ui h-8.5 bg-muted/20 border-border/50 focus:bg-background transition-all"
          />
          <p className="text-micro text-muted-foreground/50 px-1">
            {t("breakpoint.pattern_hint", "Enter domain, path, or full URL to match")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Match Type */}
          <div className="space-y-2">
            <label className="text-tiny font-bold text-foreground/60 uppercase tracking-widest flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {t("breakpoint.match_type_label", "Match Type")}
            </label>
            <Select
              value={matchType}
              onChange={(v) => setMatchType(v as "contains" | "exact" | "regex")}
              options={matchTypeOptions}
              className="h-8.5 text-ui"
            />
          </div>

          {/* Break Phase */}
          <div className="space-y-2">
            <label className="text-tiny font-bold text-foreground/60 uppercase tracking-widest flex items-center gap-2">
              <Timer className="w-3.5 h-3.5" />
              {t("breakpoint.break_on", "Break On")}
            </label>
            <div className="flex items-center gap-1 p-1 h-8.5 bg-muted/20 rounded-lg border border-border/40">
              <button
                type="button"
                onClick={() => setBreakOnRequest(!breakOnRequest)}
                className={cn(
                  "flex-1 h-full rounded-md text-xs font-bold transition-all duration-200",
                  breakOnRequest
                    ? "bg-background text-primary shadow-sm"
                    : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/30",
                )}
              >
                {t("breakpoint.request", "Request")}
              </button>
              <button
                type="button"
                onClick={() => setBreakOnResponse(!breakOnResponse)}
                className={cn(
                  "flex-1 h-full rounded-md text-xs font-bold transition-all duration-200",
                  breakOnResponse
                    ? "bg-background text-primary shadow-sm"
                    : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/30",
                )}
              >
                {t("breakpoint.response", "Response")}
              </button>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="p-4 bg-muted/10 rounded-2xl border border-border/40 relative overflow-hidden group/preview">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-1 h-3.5 bg-primary rounded-full shadow-[0_0_8px_rgba(var(--primary-rgb),0.3)]" />
            <span className="text-tiny font-bold text-foreground/70 uppercase tracking-widest">
              {t("breakpoint.preview", "Rules Preview")}
            </span>
          </div>
          <div className="space-y-2 relative z-10">
            <div className="p-3 bg-background/40 backdrop-blur-sm rounded-xl border border-border/40 shadow-sm leading-none">
              <p className="text-xs font-mono break-all leading-relaxed">
                {matchType === "contains" && (
                  <>
                    <span className="text-muted-foreground mr-2">
                      {t("breakpoint.preview_contains", "URL contains")}
                    </span>
                    <span className="text-foreground font-bold underline decoration-primary/30 underline-offset-4 decoration-2">
                      "{pattern}"
                    </span>
                  </>
                )}
                {matchType === "exact" && (
                  <>
                    <span className="text-muted-foreground mr-2">
                      {t("breakpoint.preview_equals", "URL equals")}
                    </span>
                    <span className="text-foreground font-bold underline decoration-primary/30 underline-offset-4 decoration-2">
                      "{pattern}"
                    </span>
                  </>
                )}
                {matchType === "regex" && (
                  <>
                    <span className="text-muted-foreground mr-2">
                      {t("breakpoint.preview_matches", "URL matches regex")}
                    </span>
                    <span className="text-foreground font-bold underline decoration-primary/30 underline-offset-4 decoration-2">
                      /{pattern}/
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 px-1 pt-1 opacity-80 group-hover/preview:opacity-100 transition-opacity duration-300">
              <div className="relative flex items-center justify-center">
                <div
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(var(--primary-rgb),0.4)]",
                    !(breakOnRequest || breakOnResponse)
                      ? "bg-red-500 shadow-red-500/40"
                      : "bg-primary shadow-primary/40",
                  )}
                />
                {(breakOnRequest || breakOnResponse) && (
                  <div className="absolute inset-0 bg-primary rounded-full blur-[2px] opacity-40 animate-pulse" />
                )}
              </div>
              <span className="text-tiny font-medium text-muted-foreground/80 tracking-tight italic">
                {breakOnRequest &&
                  breakOnResponse &&
                  t("breakpoint.preview_both", "Will break on both request and response phases")}
                {breakOnRequest &&
                  !breakOnResponse &&
                  t("breakpoint.preview_request", "Will break on request phase only")}
                {!breakOnRequest &&
                  breakOnResponse &&
                  t("breakpoint.preview_response", "Will break on response phase only")}
                {!(breakOnRequest || breakOnResponse) && (
                  <span className="text-red-500/80 font-bold not-italic">
                    {t("breakpoint.preview_none", "No break phase selected")}
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="rounded-xl px-4 h-8.5 text-xs font-semibold"
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!(pattern.trim() && (breakOnRequest || breakOnResponse))}
            className="gap-2 rounded-xl px-5 h-8.5 shadow-lg shadow-primary/10 transition-all interactive-pop"
          >
            <PauseCircle className="w-3.5 h-3.5" />
            <span className="text-tiny font-bold">{t("breakpoint.add", "Add Breakpoint")}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
