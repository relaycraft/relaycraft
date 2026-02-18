import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { FileJson, FolderOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { notify } from "../../lib/notify";
import { useRuleStore } from "../../stores/ruleStore";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";

export function ImportRuleModal() {
  const { t } = useTranslation();
  const { importBundle } = useRuleStore();
  const { importModalOpen, setImportModalOpen } = useUIStore();
  const [jsonText, setJsonText] = useState("");

  // ... (logic remains same)

  const handleImport = () => {
    try {
      const data = JSON.parse(jsonText);

      // MODE A: Smart Bundle Import (Groups + Rules)
      if (data.bundle || (data.rules && Array.isArray(data.rules))) {
        const result = importBundle(jsonText);
        if (result.success) {
          notify.success(t("import_modal.success", { count: result.count }), t("sidebar.rules"));
          setImportModalOpen(false);
          setJsonText("");
        } else {
          throw new Error(result.error);
        }
        return;
      }

      // MODE B: Single Rule Legacy Import
      // Support single rule object by wrapping it in a bundle
      if (data.match && data.actions) {
        const bundle = { rules: [data], groups: [] };
        const result = importBundle(JSON.stringify(bundle));
        if (result.success) {
          notify.success(t("import_modal.success", { count: result.count }), t("sidebar.rules"));
          setImportModalOpen(false);
          setJsonText("");
        } else {
          throw new Error(result.error);
        }
        return;
      }

      notify.error(
        "Invalid rule format. Please use a valid Bundle or Single Rule JSON.",
        t("common.error"),
      );
      setImportModalOpen(false);
      setJsonText("");
    } catch (e: any) {
      notify.error(e.message || "JSON Parse Failed", t("common.error"));
    }
  };

  const handleSelectFile = async () => {
    try {
      const path = await open({
        filters: [
          {
            name: "Rule Files (JSON/ZIP)",
            extensions: ["json", "zip"],
          },
        ],
      });

      if (path) {
        if (path.toLowerCase().endsWith(".zip")) {
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
              notify.error(result.error || "Import Failed", t("common.error"));
            }
          } catch (e: any) {
            toast.dismiss(loadingId);
            notify.error(e.message, t("common.error"));
          }
        } else {
          const content = await readTextFile(path);
          setJsonText(content);
        }
      }
    } catch (err) {
      console.error(err);
      notify.error("Failed to read file", t("common.error"));
    }
  };

  return (
    <Modal
      isOpen={importModalOpen}
      onClose={() => setImportModalOpen(false)}
      title={t("import_modal.title")}
      icon={<FileJson className="w-4 h-4 text-primary" />}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="rule-import-json"
              className="text-ui font-medium text-muted-foreground block"
            >
              {t("import_modal.desc")}
            </label>
            <Button variant="secondary" size="xs" onClick={handleSelectFile} className="gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" />
              {t("import_modal.select")}
            </Button>
          </div>
          <textarea
            id="rule-import-json"
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
            }}
            placeholder={t("import_modal.placeholder")}
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
            {t("import_modal.action")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
