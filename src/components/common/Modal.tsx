import { AnimatePresence, motion, type Variants } from "framer-motion";
import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  headerActions?: ReactNode;
  /** When true, backdrop click, Escape, and header close are disabled (e.g. during a blocking operation). */
  preventDismiss?: boolean;
  /** Native tooltip / aria-label when `preventDismiss` is true (e.g. why the window cannot be closed). */
  preventDismissHint?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  className = "max-w-lg",
  icon,
  headerActions,
  preventDismiss = false,
  preventDismissHint,
}: ModalProps) {
  // Handle Escape key
  useEffect(() => {
    if (!isOpen || preventDismiss) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, preventDismiss]);

  // Backdrop animation
  const backdropVariants: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.2 } },
    exit: { opacity: 0, transition: { duration: 0.2 } },
  };

  // Modal slide/scale animation
  const modalVariants: Variants = {
    hidden: { opacity: 0, scale: 0.95, y: 10 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: {
        type: "spring",
        stiffness: 300,
        damping: 25,
        duration: 0.3,
      },
    },
    exit: {
      opacity: 0,
      scale: 0.95,
      y: 10,
      transition: { duration: 0.2 },
    },
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 isolate">
          {/* Backdrop */}
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "absolute inset-0 bg-black/40 backdrop-blur-[2px]",
              preventDismiss ? "cursor-default" : "cursor-pointer",
            )}
            onClick={preventDismiss ? undefined : onClose}
            aria-hidden="true"
          />

          {/* Modal Content */}
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`relaycraft-dialog relative w-full ${className} bg-background/95 backdrop-blur-xl border border-border/40 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-muted/5 shrink-0">
              <div className="flex items-center gap-2">
                {icon && <div className="flex-shrink-0">{icon}</div>}
                <h3 className="text-sm font-bold text-foreground/90 tracking-tight">{title}</h3>
              </div>
              <div className="flex items-center gap-2">
                {headerActions}
                <button
                  type="button"
                  onClick={onClose}
                  disabled={preventDismiss}
                  aria-disabled={preventDismiss}
                  aria-label={preventDismiss && preventDismissHint ? preventDismissHint : undefined}
                  title={preventDismiss && preventDismissHint ? preventDismissHint : undefined}
                  className={cn(
                    "p-1 text-muted-foreground/60 rounded-lg transition-all",
                    preventDismiss
                      ? "opacity-40 cursor-not-allowed"
                      : "hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-4 overflow-y-auto custom-scrollbar">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
