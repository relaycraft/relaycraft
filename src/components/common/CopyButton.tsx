import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Tooltip } from "./Tooltip";

interface CopyButtonProps {
  text: string;
  className?: string;
  iconSize?: number;
  showLabel?: boolean;
  label?: string;
  variant?: "ghost" | "secondary" | "default" | "quiet";
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

export function CopyButton({
  text,
  className,
  iconSize = 14,
  showLabel = false,
  label,
  variant = "default",
  tooltipSide = "top",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

  // Default label logic
  const displayLabel = label || t("common.copy");

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const variantClasses = {
    default: "hover:bg-muted/50",
    ghost: "hover:bg-transparent hover:text-primary p-0",
    secondary:
      "bg-background/80 backdrop-blur rounded-lg border border-border/40 hover:bg-background h-8 w-8 justify-center",
    quiet:
      "border border-white/5 bg-transparent hover:bg-white/5 hover:border-white/20 h-8 w-8 justify-center transition-all duration-200",
  };

  return (
    <Tooltip content={copied ? t("common.copied") : displayLabel} side={tooltipSide}>
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          "group inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-muted-foreground transition-all relative",
          variantClasses[variant],
          className,
        )}
      >
        <div className="relative">
          <Copy
            size={iconSize}
            className={cn("transition-all scale-100", copied && "scale-0 opacity-0")}
          />
          <Check
            size={iconSize}
            className={cn(
              "text-green-500 absolute top-0 left-0 transition-all scale-0 opacity-0",
              copied && "scale-100 opacity-100",
            )}
          />
        </div>
        {showLabel && (
          <span className="text-xs font-medium">{copied ? t("common.copied") : displayLabel}</span>
        )}
      </button>
    </Tooltip>
  );
}
