import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  ScrollText,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProxyStore } from "../../stores/proxyStore";
import { useScriptStore } from "../../stores/scriptStore";
import { useUIStore } from "../../stores/uiStore";
import { EmptyState } from "../common/EmptyState";
import { Tooltip } from "../common/Tooltip";
import { ScriptEditor } from "./ScriptEditor";

export function ScriptManager() {
  const { t } = useTranslation();
  const {
    scripts,
    selectedScript,
    loading,
    fetchScripts,
    selectScript,
    deleteScript,
    toggleScript,
    renameScript,
    moveScript,
    modifiedSinceStart,
  } = useScriptStore();

  const { restartProxy, running, activeScripts } = useProxyStore();
  const { showConfirm } = useUIStore();

  const { draftScript, setDraftScript } = useScriptStore();

  const [restarting, setRestarting] = useState(false);

  // Rename state
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Check if a script is currently active (loaded in running engine)
  // activeScripts stores script names (not temp paths) for consistent comparison
  const checkIsScriptActive = (name: string) => {
    return activeScripts.includes(name);
  };

  useEffect(() => {
    fetchScripts();
  }, [fetchScripts]);

  // Auto-select first script if none selected
  useEffect(() => {
    if (!loading && scripts.length > 0 && !selectedScript && !draftScript) {
      selectScript(scripts[0].name);
    }
  }, [loading, scripts, selectedScript, draftScript, selectScript]);

  const handleCreate = () => {
    const defaultTemplate = `"""\nAddon Script for RelayCraft\n"""\nfrom mitmproxy import http, ctx\n\nclass Addon:\n    def request(self, flow: http.HTTPFlow):\n        # TODO: Add your logic\n        pass\n\naddons = [Addon()]\n`;
    setDraftScript({ name: "Untitled Script.py", content: defaultTemplate });
  };

  // Calculate if restart is needed based on:
  // 1. Any script has been modified since last start
  // 2. Any script's enabled state differs from its active state
  const needsRestart =
    running &&
    (modifiedSinceStart.size > 0 ||
      scripts.some(
        (s) =>
          (s.enabled && !activeScripts.includes(s.name)) ||
          (!s.enabled && activeScripts.includes(s.name)),
      ));

  const handleDelete = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    showConfirm({
      title: t("scripts.delete_title"),
      message: t("scripts.delete_confirm", { name }),
      variant: "danger",
      onConfirm: async () => {
        try {
          await deleteScript(name);
        } catch (error) {
          console.error(error);
        }
      },
    });
  };

  const handleToggle = async (e: React.MouseEvent, name: string, currentStatus: boolean) => {
    e.stopPropagation();
    await toggleScript(name, !currentStatus);
  };

  const handleMove = async (e: React.MouseEvent, name: string, direction: "up" | "down") => {
    e.stopPropagation();
    await moveScript(name, direction);
  };

  const startRenaming = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    setEditingScriptId(name);
    setEditName(name);
  };

  const confirmRename = async () => {
    if (!(editingScriptId && editName.trim()) || editName === editingScriptId) {
      setEditingScriptId(null);
      return;
    }

    let targetName = editName.trim();
    if (!targetName.endsWith(".py")) targetName += ".py";

    try {
      await renameScript(editingScriptId, targetName);
    } catch (error) {
      console.error("Rename failed", error);
    } finally {
      setEditingScriptId(null);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await restartProxy();
    } catch (error) {
      console.error("Restart failed", error);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Sidebar List */}
      <div className="w-80 border-r border-border bg-muted/40 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-border bg-muted/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-bold">{t("scripts.title")}</h2>
            </div>
          </div>

          <p className="text-ui text-muted-foreground leading-relaxed opacity-70">
            {t("scripts.subtitle")}
          </p>
        </div>

        {/* Restart Hint Banner - Moved to top for better visibility */}
        {needsRestart && (
          <div className="px-4 py-3 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-600 text-xs shadow-inner animate-in slide-in-from-top-2 duration-300">
            <div className="flex gap-2 items-start mb-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-yellow-600" />
              <div className="flex-1 font-medium">{t("scripts.restart_hint")}</div>
            </div>
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-700 rounded transition-colors disabled:opacity-50 font-medium"
            >
              {restarting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {t("scripts.restart_btn")}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1 pt-2">
          {draftScript && (
            <div
              onClick={() => selectScript(null)}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-ui transition-all border bg-primary/5 border-primary/20 text-primary font-medium ${!selectedScript ? "ring-1 ring-primary/30" : ""}`}
            >
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.4)]" />
              <Plus className="w-4 h-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="truncate block">{draftScript.name} (草稿)</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDraftScript(null);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive text-muted-foreground rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {loading && scripts.length === 0 ? (
            <div className="flex justify-center p-4">
              <Loader2 className="animate-spin w-4 h-4 text-muted-foreground" />
            </div>
          ) : scripts.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title={t("scripts.empty.title")}
              description={t("scripts.empty.desc")}
              action={{
                label: t("scripts.empty.create"),
                onClick: handleCreate,
                icon: Plus,
              }}
              animation="float"
            />
          ) : (
            scripts.map((script) => (
              <div
                key={script.name}
                onClick={() => selectScript(script.name)}
                className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-ui transition-all border relative ${
                  selectedScript === script.name
                    ? "bg-primary/10 border-primary/20 text-primary font-medium"
                    : "border-transparent hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                {/* Status Indicator with Pending State */}
                {(() => {
                  const isScriptActive = checkIsScriptActive(script.name);
                  const isContentModified = modifiedSinceStart.has(script.name);

                  // Pending if: content modified, or enabled state differs from active state
                  const isPending =
                    running &&
                    (isContentModified ||
                      (script.enabled && !isScriptActive) ||
                      (!script.enabled && isScriptActive));

                  return (
                    <div className="relative">
                      <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
                          script.enabled
                            ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                            : "bg-muted-foreground/30"
                        }`}
                      />
                      {isPending && (
                        <div
                          className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-yellow-500 border border-background"
                          title={
                            isContentModified
                              ? t("scripts.content_modified")
                              : t("common.pending_restart")
                          }
                        />
                      )}
                    </div>
                  );
                })()}

                <FileText
                  className={`w-4 h-4 flex-shrink-0 ${script.enabled ? "text-foreground" : "opacity-50"}`}
                />

                {editingScriptId === script.name ? (
                  <input
                    type="text"
                    className="flex-1 min-w-0 px-1 py-0.5 text-sm bg-background border border-primary/30 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmRename();
                      if (e.key === "Escape") setEditingScriptId(null);
                    }}
                    onBlur={confirmRename}
                  />
                ) : (
                  <div className="flex-1 min-w-0">
                    <Tooltip content={script.name} side="bottom">
                      <span
                        className={`truncate block ${script.enabled ? "text-foreground font-medium" : ""}`}
                        onDoubleClick={(e) => startRenaming(e, script.name)}
                      >
                        {script.name}
                      </span>
                    </Tooltip>
                  </div>
                )}

                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all shrink-0 absolute right-1.5 top-1/2 -translate-y-1/2 bg-background/90 backdrop-blur-sm border border-border/40 p-1 px-1.5 rounded-lg shadow-sm">
                  <div className="flex items-center bg-muted/20 rounded-md border border-border/20 overflow-hidden">
                    <Tooltip content={t("common.move_up")}>
                      <button
                        onClick={(e) => handleMove(e, script.name, "up")}
                        disabled={scripts.indexOf(script) === 0}
                        className="p-1 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                    </Tooltip>
                    <div className="w-[1px] h-3 bg-border/20" />
                    <Tooltip content={t("common.move_down")}>
                      <button
                        onClick={(e) => handleMove(e, script.name, "down")}
                        disabled={scripts.indexOf(script) === scripts.length - 1}
                        className="p-1 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </Tooltip>
                  </div>

                  <Tooltip content={script.enabled ? t("common.disable") : t("common.enable")}>
                    <button
                      onClick={(e) => handleToggle(e, script.name, script.enabled)}
                      className={`p-1 rounded hover:bg-muted/50 ${script.enabled ? "text-green-500" : "text-muted-foreground hover:text-primary"}`}
                    >
                      {script.enabled ? (
                        <ToggleRight className="w-4 h-4" />
                      ) : (
                        <ToggleLeft className="w-4 h-4" />
                      )}
                    </button>
                  </Tooltip>

                  <Tooltip content={t("common.delete")}>
                    <button
                      onClick={(e) => handleDelete(e, script.name)}
                      className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Removed bottom restart banner */}
      </div>

      {/* Editor Area */}
      <div className="flex-1 overflow-hidden transition-colors duration-300">
        <ScriptEditor key={selectedScript || "draft"} scriptName={selectedScript} />
      </div>
    </div>
  );
}
