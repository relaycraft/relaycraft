import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { FileJson2, FolderOpen, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatError, Logger } from "../../lib/logger";
import { notify } from "../../lib/notify";
import {
  buildDiagnosticPackage,
  DIAGNOSTIC_NOTE_MAX_LENGTH,
  DIAGNOSTIC_PACKAGE_MAX_BYTES,
  DiagnosticPackageError,
  type DiagnosticPackageErrorCode,
  parseDiagnosticPackage,
  serializeDiagnosticPackage,
} from "../../lib/sharing/diagnosticPackage";
import { fetchFlowDetail } from "../../lib/traffic";
import type { Flow } from "../../types";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";
import { Tooltip } from "../common/Tooltip";

interface ExportDraft {
  /** Freshly fetched flow the package was built from. */
  flow: Flow;
  note: string;
  /** Exact bytes that will be written; recomputed whenever the note changes. */
  json: string;
}

/**
 * Export / read-only-open actions for the metadata-only diagnostic package.
 * The export always re-fetches the flow detail from the backend and fails
 * closed if it is unavailable — the possibly stale `flow` prop is only used
 * to know which flow to fetch.
 */
export function DiagnosticPackageActions({ flow }: { flow: Flow }) {
  const { t } = useTranslation();
  const [exportDraft, setExportDraft] = useState<ExportDraft | null>(null);
  const [viewJson, setViewJson] = useState<string | null>(null);
  const [busy, setBusy] = useState<"export" | "open" | null>(null);
  const [saving, setSaving] = useState(false);

  const isStreamFlow = !!flow._rc?.isWebsocket || !!flow._rc?.isSse;

  const reportPackageError = (e: unknown, fallbackKey: string) => {
    if (e instanceof DiagnosticPackageError) {
      // Static per-code mapping so check:i18n sees literal keys.
      const messages: Record<DiagnosticPackageErrorCode, string> = {
        no_flow: t("flow.diagnostic.errors.no_flow"),
        unsupported_flow: t("flow.diagnostic.errors.unsupported_flow"),
        note_too_long: t("flow.diagnostic.errors.note_too_long"),
        file_too_large: t("flow.diagnostic.errors.file_too_large"),
        invalid_json: t("flow.diagnostic.errors.invalid_json"),
        invalid_package: t("flow.diagnostic.errors.invalid_package"),
      };
      notify.error(messages[e.code] ?? messages.invalid_package, t("common.error"));
    } else {
      Logger.error("Diagnostic package operation failed:", e);
      notify.error(formatError(e) || t(fallbackKey), t("common.error"));
    }
  };

  const handleExport = async () => {
    if (busy) return;
    setBusy("export");
    try {
      const fresh = await fetchFlowDetail(flow.id);
      // Fail closed: never fall back to the prop when the backend cannot
      // confirm this is still the same flow.
      if (!fresh || fresh.id !== flow.id) {
        notify.error(t("flow.diagnostic.fetch_failed"), t("common.error"));
        return;
      }
      const pkg = buildDiagnosticPackage(fresh, "");
      setExportDraft({ flow: fresh, note: "", json: serializeDiagnosticPackage(pkg) });
    } catch (e) {
      reportPackageError(e, "flow.diagnostic.errors.invalid_package");
    } finally {
      setBusy(null);
    }
  };

  const handleNoteChange = (note: string) => {
    setExportDraft((prev) => {
      if (!prev) return prev;
      try {
        const pkg = buildDiagnosticPackage(prev.flow, note);
        return { flow: prev.flow, note, json: serializeDiagnosticPackage(pkg) };
      } catch {
        // Over-length or otherwise invalid note: keep the last valid preview.
        return prev;
      }
    });
  };

  const handleSave = async () => {
    if (!exportDraft || saving) return;
    setSaving(true);
    try {
      const filePath = await save({
        defaultPath: "flow-diagnostic.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      // User cancelled the dialog — nothing is written.
      if (!filePath) return;
      await writeTextFile(filePath, exportDraft.json);
      notify.success(t("flow.diagnostic.saved"), t("common.success"));
      setExportDraft(null);
    } catch (e) {
      Logger.error("Failed to save diagnostic package:", e);
      notify.error(formatError(e), t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleOpen = async () => {
    if (busy) return;
    setBusy("open");
    try {
      const filePath = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath || Array.isArray(filePath)) return;
      // Reject oversized files before reading them into memory; the parser
      // re-checks the byte length to cover a stat→read race.
      const info = await stat(filePath);
      if (info.size > DIAGNOSTIC_PACKAGE_MAX_BYTES) {
        throw new DiagnosticPackageError(
          "file_too_large",
          `Diagnostic package exceeds ${DIAGNOSTIC_PACKAGE_MAX_BYTES} bytes`,
        );
      }
      const text = await readTextFile(filePath);
      // Strict, read-only validation — the content is never applied.
      const pkg = parseDiagnosticPackage(text);
      setViewJson(serializeDiagnosticPackage(pkg));
    } catch (e) {
      reportPackageError(e, "flow.diagnostic.errors.invalid_package");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {!isStreamFlow && (
        <Tooltip content={t("flow.diagnostic.export_btn")}>
          <button
            type="button"
            onClick={handleExport}
            disabled={busy !== null}
            aria-label={t("flow.diagnostic.export_btn")}
            className="p-1.5 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {busy === "export" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileJson2 className="w-4 h-4" />
            )}
          </button>
        </Tooltip>
      )}
      <Tooltip content={t("flow.diagnostic.open_btn")}>
        <button
          type="button"
          onClick={handleOpen}
          disabled={busy !== null}
          aria-label={t("flow.diagnostic.open_btn")}
          className="p-1.5 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {busy === "open" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FolderOpen className="w-4 h-4" />
          )}
        </button>
      </Tooltip>

      <Modal
        isOpen={!!exportDraft}
        onClose={() => setExportDraft(null)}
        title={t("flow.diagnostic.export_title")}
        icon={<FileJson2 className="w-4 h-4 text-primary" />}
        className="max-w-xl"
      >
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("flow.diagnostic.desc")}</p>

          <div className="space-y-1.5">
            <label
              htmlFor="diagnostic-note"
              className="text-ui font-medium text-muted-foreground block"
            >
              {t("flow.diagnostic.note_label")}
            </label>
            <textarea
              id="diagnostic-note"
              value={exportDraft?.note ?? ""}
              onChange={(e) => handleNoteChange(e.target.value)}
              maxLength={DIAGNOSTIC_NOTE_MAX_LENGTH}
              rows={3}
              placeholder={t("flow.diagnostic.note_placeholder")}
              className="w-full p-3 bg-muted/30 border border-border/60 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all resize-none placeholder:text-muted-foreground/40"
            />
            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <TriangleAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {t("flow.diagnostic.note_warning")}
            </p>
          </div>

          <div className="space-y-1.5">
            <span className="text-ui font-medium text-muted-foreground block">
              {t("flow.diagnostic.preview_label")}
            </span>
            <pre className="max-h-64 overflow-auto custom-scrollbar p-3 bg-muted/30 border border-border/60 rounded-lg text-xs font-mono whitespace-pre-wrap break-all">
              {exportDraft?.json}
            </pre>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setExportDraft(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {t("flow.diagnostic.save")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!viewJson}
        onClose={() => setViewJson(null)}
        title={t("flow.diagnostic.view_title")}
        icon={<FileJson2 className="w-4 h-4 text-primary" />}
        className="max-w-xl"
      >
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("flow.diagnostic.view_only")}</p>
          <pre className="max-h-96 overflow-auto custom-scrollbar p-3 bg-muted/30 border border-border/60 rounded-lg text-xs font-mono whitespace-pre-wrap break-all">
            {viewJson}
          </pre>
          <div className="flex items-center justify-end">
            <Button variant="ghost" onClick={() => setViewJson(null)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
