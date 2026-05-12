import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getDisplayableUpdateNotes } from "../../lib/updateReleaseNotes";
import { cn } from "../../lib/utils";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";
import { AppLogo } from "../layout/AppLogo";

interface UpdateAvailableModalProps {
  isOpen: boolean;
  version: string;
  body?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isLoading?: boolean;
}

export function UpdateAvailableModal({
  isOpen,
  version,
  body,
  onClose,
  onConfirm,
  isLoading,
}: UpdateAvailableModalProps) {
  const { t } = useTranslation();
  const displayNotes = getDisplayableUpdateNotes(body, version);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !isLoading) {
        e.preventDefault();
        onConfirm().catch(() => {});
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onConfirm]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("settings.about.update_available.title")}
      className="max-w-[440px]"
      preventDismiss={!!isLoading}
      preventDismissHint={isLoading ? t("settings.about.update_modal_cannot_close") : undefined}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "p-3 rounded-xl shrink-0 ring-1 ring-inset shadow-sm",
              "bg-blue-500/10 text-blue-500 ring-blue-500/10",
            )}
          >
            <div className="p-1 bg-primary/10 rounded-lg">
              <AppLogo size={24} />
            </div>
          </div>
          <div className="flex-1 min-w-0 pt-1 space-y-2">
            <h4 className="text-sm font-bold text-foreground/90 leading-snug">
              {t("settings.about.update_available.version_line", { version })}
            </h4>
            {displayNotes ? (
              <div className="text-ui text-muted-foreground leading-relaxed max-h-36 overflow-y-auto rounded-lg border border-border/30 bg-muted/10 px-3 py-2 whitespace-pre-wrap custom-scrollbar">
                {displayNotes}
              </div>
            ) : null}
            <p className="text-ui text-muted-foreground leading-relaxed">
              {t("settings.about.update_available.install_prompt")}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isLoading}
            className="min-w-[96px] h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {t("common.no")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              onConfirm().catch(() => {});
            }}
            isLoading={isLoading}
            className="min-w-[96px] h-8 px-3 text-xs font-bold shadow-sm"
          >
            {t("common.yes")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
