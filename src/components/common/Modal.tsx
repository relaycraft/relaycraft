import { AnimatePresence, motion, type Variants } from "framer-motion";
import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  /** Overrides the body wrapper classes (e.g. for tabs/custom scroll layouts). */
  bodyClassName?: string;
  icon?: ReactNode;
  /** Optional subtitle rendered under the title; caller owns its styling. */
  subtitle?: ReactNode;
  /** Fully replaces the default title/icon block (e.g. command-palette input row). */
  headerContent?: ReactNode;
  headerActions?: ReactNode;
  /** Hides the header close button (e.g. palettes dismissed via backdrop/Escape). */
  hideCloseButton?: boolean;
  /** "top" renders a command-palette style panel near the top instead of centered. */
  align?: "center" | "top";
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
  bodyClassName = "p-4 overflow-y-auto custom-scrollbar",
  icon,
  subtitle,
  headerContent,
  headerActions,
  hideCloseButton = false,
  align = "center",
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
        <div
          className={`fixed inset-0 z-(--z-modal) flex justify-center p-4 isolate ${
            align === "top" ? "items-start pt-[15vh]" : "items-center"
          }`}
        >
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
            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/40 bg-muted/5 shrink-0">
              {headerContent ?? (
                <div className="flex items-center gap-2 min-w-0">
                  {icon && <div className="flex-shrink-0">{icon}</div>}
                  <div className="flex flex-col min-w-0">
                    <h3 className="text-sm font-bold text-foreground/90 tracking-tight">{title}</h3>
                    {subtitle}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 shrink-0">
                {headerActions}
                {!hideCloseButton && (
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={preventDismiss}
                    aria-disabled={preventDismiss}
                    aria-label={
                      preventDismiss && preventDismissHint ? preventDismissHint : undefined
                    }
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
                )}
              </div>
            </div>

            {/* Body */}
            <div className={bodyClassName}>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
