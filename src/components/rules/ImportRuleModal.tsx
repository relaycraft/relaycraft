import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { FileJson, FolderOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Logger } from "../../lib/logger";
import { notify } from "../../lib/notify";
import { detectRuleImportSource, prepareJsonRuleImport } from "../../lib/rules/importSource";
import { useRuleStore } from "../../stores/ruleStore";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";

export function ImportRuleModal() {
  const { t } = useTranslation();
  const importBundle = useRuleStore((state) => state.importBundle);
  const importModalOpen = useUIStore((state) => state.importModalOpen);
  const setImportModalOpen = useUIStore((state) => state.setImportModalOpen);
  const [jsonText, setJsonText] = useState("");

  const handleImport = () => {
    // Normalize through the import-source seam; invalid input leaves the
    // modal open and the store untouched so the user can fix the payload.
    const prepared = prepareJsonRuleImport(jsonText);
    if (prepared.status !== "ok") {
      const message =
        prepared.reason === "invalid_json"
          ? t("rules.import.invalid_json")
          : t("rules.import.invalid_format");
      notify.error(message, t("common.error"));
      return;
    }

    const result = importBundle(prepared.payload);
    if (result.success) {
      notify.success(t("rules.import.success", { count: result.count }), t("sidebar.rules"));
      setImportModalOpen(false);
      setJsonText("");
    } else {
      notify.error(result.error || t("rules.import.invalid_format"), t("common.error"));
    }
  };

  const handleSelectFile = async () => {
    try {
      const path = await open({
        filters: [
          {
            name: t("rules.import.file_filter"),
            extensions: ["json", "zip"],
          },
        ],
      });

      if (path) {
        const source = detectRuleImportSource(path);
        if (source.status === "unsupported") {
          notify.error(t("rules.import.unsupported_format"), t("common.error"));
          return;
        }
        if (source.sourceId === "legacy-zip") {
          const loadingId = toast.loading(t("rules.import_zip_extracting"));
          try {
            const result = await useRuleStore.getState().importRulesZip(path);
            toast.dismiss(loadingId);
            if (result.success) {
              notify.success(
                t("rules.import_zip_success", { count: result.imported }),
                t("sidebar.rules"),
              );
              setImportModalOpen(false);
            } else {
              notify.error(result.error || t("rules.import.failed"), t("common.error"));
            }
          } catch (e: any) {
            toast.dismiss(loadingId);
            notify.error(e.message || t("rules.import.failed"), t("common.error"));
          }
        } else {
          const content = await readTextFile(path);
          setJsonText(content);
        }
      }
    } catch (err) {
      Logger.error("Failed to read file", err);
      notify.error(t("rules.import.read_failed"), t("common.error"));
    }
  };

  return (
    <Modal
      isOpen={importModalOpen}
      onClose={() => setImportModalOpen(false)}
      title={t("rules.import.title")}
      icon={<FileJson className="w-4 h-4 text-primary" />}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="rule-import-json"
              className="text-ui font-medium text-muted-foreground block"
            >
              {t("rules.import.desc")}
            </label>
            <Button variant="secondary" size="xs" onClick={handleSelectFile} className="gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" />
              {t("rules.import.select")}
            </Button>
          </div>
          <textarea
            id="rule-import-json"
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
            }}
            placeholder={t("rules.import.placeholder")}
            className="w-full h-52 p-3 bg-muted/30 border border-border/60 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all resize-none placeholder:text-muted-foreground/40 placeholder:font-sans"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => setImportModalOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleImport}
            disabled={!jsonText.trim()}
            className="shadow-sm shadow-primary/20"
          >
            {t("rules.import.action")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
