import { Ban } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ActionBlock() {
  const { t } = useTranslation();

  return (
    <div className="p-8 bg-rule-block-soft rounded-xl border border-rule-block-soft flex flex-col items-center justify-center text-center gap-3">
      <div className="w-12 h-12 rounded-full bg-rule-block-soft flex items-center justify-center text-rule-block mb-1">
        <Ban className="w-6 h-6" />
      </div>
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-1">
          {t("rules.editor.core.types.block_label")}
        </h4>
        <p className="text-xs text-muted-foreground max-w-[280px]">
          {t("rules.editor.core.types.block_desc")}
        </p>
      </div>
    </div>
  );
}
