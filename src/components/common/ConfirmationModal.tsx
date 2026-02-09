import { AlertCircle, AlertTriangle, CheckCircle, Info, type LucideIcon } from "lucide-react";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Button } from "./Button";
import { Modal } from "./Modal";

export type ConfirmationVariant = "info" | "success" | "warning" | "danger";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmationVariant;
  onCancel?: () => void;
  isLoading?: boolean;
  className?: string;
  customIcon?: React.ReactNode;
}

const variantStyles: Record<
  ConfirmationVariant,
  {
    icon: LucideIcon;
    iconColor: string;
    buttonVariant: "default" | "destructive" | "outline" | "secondary";
    accentColor: string;
  }
> = {
  info: {
    icon: Info,
    iconColor: "text-blue-500",
    buttonVariant: "default",
    accentColor: "blue",
  },
  success: {
    icon: CheckCircle,
    iconColor: "text-green-500",
    buttonVariant: "default",
    accentColor: "green",
  },
  warning: {
    icon: AlertTriangle,
    iconColor: "text-orange-500",
    buttonVariant: "destructive",
    accentColor: "orange",
  },
  danger: {
    icon: AlertCircle,
    iconColor: "text-red-500",
    buttonVariant: "destructive",
    accentColor: "red",
  },
};

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "info",
  onCancel,
  isLoading,
  className,
  customIcon,
}: ConfirmationModalProps) {
  const { t } = useTranslation();
  const style = variantStyles[variant];
  const IconComponent = style.icon;

  // Handle Enter key for confirmation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !isLoading) {
        e.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onConfirm, isLoading]);

  const finalConfirmLabel = confirmLabel || t("confirmation_modal.confirm");
  const finalCancelLabel = cancelLabel || t("confirmation_modal.cancel");

  const headerTitle = React.useMemo(() => {
    switch (variant) {
      case "danger":
        return t("common.warning");
      case "warning":
        return t("common.warning");
      case "success":
        return t("common.success");
      default:
        return t("common.confirm");
    }
  }, [variant, t]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={headerTitle}
      className={cn("max-w-[440px]", className)}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "p-3 rounded-2xl shrink-0 ring-1 ring-inset shadow-sm",
              variant === "info" && "bg-blue-500/10 text-blue-500 ring-blue-500/10",
              variant === "success" && "bg-green-500/10 text-green-500 ring-green-500/10",
              variant === "warning" && "bg-orange-500/10 text-orange-500 ring-orange-500/10",
              variant === "danger" && "bg-red-500/10 text-red-500 ring-red-500/10",
            )}
          >
            {customIcon ? customIcon : <IconComponent className="w-6 h-6" />}
          </div>
          <div className="flex-1 pt-1">
            <h4 className="text-[14px] font-bold text-foreground/90 mb-1.5">{title}</h4>
            <p className="text-system text-muted-foreground leading-relaxed whitespace-pre-line">
              {message}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel || onClose}
            disabled={isLoading}
            className="text-muted-foreground hover:text-foreground font-medium px-4"
          >
            {finalCancelLabel}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onConfirm}
            isLoading={isLoading}
            className="font-bold min-w-[90px] shadow-sm"
          >
            {finalConfirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
