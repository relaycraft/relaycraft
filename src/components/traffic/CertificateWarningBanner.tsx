import { motion } from "framer-motion";
import type { TFunction } from "i18next";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "../common/Button";

interface CertificateWarningBannerProps {
  visible: boolean;
  t: TFunction;
  onFixNow: () => void;
  onDismiss: () => void;
}

export function CertificateWarningBanner({
  visible,
  t,
  onFixNow,
  onDismiss,
}: CertificateWarningBannerProps) {
  if (!visible) return null;

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between group overflow-hidden"
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-amber-500 leading-tight">
            {t("traffic.security.untrusted_title")}
          </p>
          <p className="text-ui text-amber-500/80 leading-tight mt-0.5">
            {t("traffic.security.untrusted_desc")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-ui px-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 border border-amber-500/30 font-bold"
          onClick={onFixNow}
        >
          {t("traffic.security.fix_now")}
        </Button>
        <button
          onClick={onDismiss}
          className="p-1 hover:bg-amber-500/10 rounded-md text-amber-500/40 hover:text-amber-500 transition-colors"
          title={t("common.dismiss", "Dismiss")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
