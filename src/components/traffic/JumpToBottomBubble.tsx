import { AnimatePresence, motion } from "framer-motion";
import type { TFunction } from "i18next";

interface JumpToBottomBubbleProps {
  visible: boolean;
  newRequestsCount: number;
  t: TFunction;
  onClick: () => void;
}

export function JumpToBottomBubble({
  visible,
  newRequestsCount,
  t,
  onClick,
}: JumpToBottomBubbleProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 4 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
        >
          <button
            onClick={onClick}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/90 hover:bg-muted text-muted-foreground border border-white/5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all text-xs font-medium backdrop-blur-xl ring-1 ring-white/5"
          >
            <div className="flex items-center gap-1.5">
              <div className="px-1 min-w-[14px] h-3.5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-micro font-bold">
                {newRequestsCount > 99 ? "99+" : newRequestsCount}
              </div>
              <span>{t("traffic.new_requests", "New Requests")}</span>
            </div>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
