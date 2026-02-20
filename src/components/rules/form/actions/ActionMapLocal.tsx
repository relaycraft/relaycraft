import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../common/Button";
import { Input } from "../../../common/Input";
import { SegmentedControl } from "../../../common/SegmentedControl";

interface ActionMapLocalProps {
  source: "file" | "manual";
  onChangeSource: (val: "file" | "manual") => void;
  localPath: string;
  onChangeLocalPath: (val: string) => void;
  content: string;
  onChangeContent: (val: string) => void;
  statusCode: number;
  onChangeStatusCode: (val: number) => void;
  contentType: string;
  onChangeContentType: (val: string) => void;
  onBrowseFile?: (callback: (path: string) => void) => void; // Optional custom handler
}

const LABEL_STYLE = "text-xs font-bold text-foreground/50 uppercase tracking-widest mb-0.5 block";

export function ActionMapLocal({
  source,
  onChangeSource,
  localPath,
  onChangeLocalPath,
  content,
  onChangeContent,
  statusCode,
  onChangeStatusCode,
  contentType,
  onChangeContentType,
}: ActionMapLocalProps) {
  const { t } = useTranslation();

  const handleBrowse = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
      });
      if (selected && typeof selected === "string") {
        onChangeLocalPath(selected);
      }
    } catch (error) {
      console.error("Failed to open file dialog:", error);
    }
  };

  return (
    <div className="space-y-4 p-3.5 bg-muted/20 rounded-xl border border-border/40">
      <div className="space-y-3">
        <div className="space-y-1">
          <label className={LABEL_STYLE}>{t("rules.editor.action.map_local.source")}</label>
          <SegmentedControl
            name="map-local-source"
            options={[
              {
                label: t("rules.editor.action.map_local.source_file"),
                value: "file",
              },
              {
                label: t("rules.editor.action.map_local.source_manual"),
                value: "manual",
              },
            ]}
            value={source}
            onChange={(val) => onChangeSource(val as any)}
          />
        </div>

        {source === "file" ? (
          <div className="space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
            <label className={LABEL_STYLE}>{t("rules.editor.action.map_local.path")}</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={localPath}
                onChange={(e) => onChangeLocalPath(e.target.value)}
                placeholder="/path/to/file"
                className="flex-1 font-mono text-xs"
              />
              <Button variant="outline" onClick={handleBrowse} className="gap-1.5 shrink-0">
                <FolderOpen className="w-3.5 h-3.5" />
                {t("common.browse")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
            <label className={LABEL_STYLE}>{t("rules.editor.action.map_local.content")}</label>
            <textarea
              value={content}
              onChange={(e) => onChangeContent(e.target.value)}
              className="w-full h-40 bg-background border border-input rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all resize-none"
              placeholder='{ "mock": true }'
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className={LABEL_STYLE}>
                {t("rules.editor.action.map_local.status_code")}
              </label>
              <span className="text-xs text-muted-foreground/40 font-medium mb-0.5 uppercase tracking-tighter">
                {t("common.optional")}
              </span>
            </div>
            <Input
              type="number"
              value={statusCode ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                onChangeStatusCode(val === "" ? 200 : parseInt(val, 10));
              }}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className={LABEL_STYLE}>
                {t("rules.editor.action.map_local.content_type")}
              </label>
              <span className="text-xs text-muted-foreground/40 font-medium mb-0.5 uppercase tracking-tighter">
                {t("common.optional")}
              </span>
            </div>
            <Input
              type="text"
              value={contentType}
              onChange={(e) => onChangeContentType(e.target.value)}
              placeholder={source === "file" ? "Auto-detect" : "application/json"}
              className="font-mono text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
