import { AlignLeft, Save, Type } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/sessionStore";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../common/Button";
import { Input } from "../common/Input";
import { Modal } from "../common/Modal";
import { Textarea } from "../common/Textarea";

export function SaveSessionModal() {
  const { saveSessionModalOpen, setSaveSessionModalOpen } = useUIStore();
  const { saveSession, loading } = useSessionStore();
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (saveSessionModalOpen) {
      // Format: session-YYYY-MM-DD-HH-mm-ss
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const seconds = String(date.getSeconds()).padStart(2, "0");
      setName(`session-${year}-${month}-${day}-${hours}-${minutes}-${seconds}`);
      setDescription("");
    }
  }, [saveSessionModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    await saveSession(name, description);
    setSaveSessionModalOpen(false);
  };

  return (
    <Modal
      isOpen={saveSessionModalOpen}
      onClose={() => setSaveSessionModalOpen(false)}
      title={t("session.save.title")}
      className="max-w-md"
      icon={<Save className="w-4 h-4 text-primary" />}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="session-name"
            className="text-ui font-medium text-muted-foreground flex items-center gap-1.5 ml-0.5"
          >
            <Type className="w-3 h-3 opacity-70" />
            {t("session.save.name")} <span className="text-destructive/80">*</span>
          </label>
          <Input
            id="session-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("session.save.name_placeholder")}
            className="bg-muted/30 border-border/60 text-xs font-medium focus-visible:ring-primary/30"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="session-desc"
            className="text-ui font-medium text-muted-foreground flex items-center gap-1.5 ml-0.5"
          >
            <AlignLeft className="w-3 h-3 opacity-70" />
            {t("session.save.desc")}
          </label>
          <Textarea
            id="session-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("session.save.desc_placeholder")}
            rows={3}
            className="bg-muted/30 border-border/60 text-xs resize-none focus-visible:ring-primary/30"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border/40 mt-2 pt-4">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setSaveSessionModalOpen(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            type="submit"
            disabled={!name.trim() || loading}
            isLoading={loading}
            className="min-w-[80px]"
          >
            {loading ? (
              t("session.save.saving")
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                {t("session.save.save_btn")}
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
