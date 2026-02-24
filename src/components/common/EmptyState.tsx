import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./Button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
    isLoading?: boolean;
  };
  className?: string;
  titleClassName?: string;
  variant?: "default" | "vibrant" | "minimal";
  animation?: "pulse" | "float" | "radar";
  status?: "default" | "destructive";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  titleClassName,
  variant = "default",
  animation = "float",
  status = "default",
}: EmptyStateProps) {
  const isDestructive = status === "destructive";

  const renderIcon = () => {
    switch (animation) {
      case "radar":
        // Using CSS animations for GPU acceleration
        return (
          <div className="relative w-32 h-32 mx-auto mb-8">
            <div
              className="absolute inset-0 bg-primary/20 rounded-full animate-radar-ping"
              style={{ animationDelay: "0s" }}
            />
            <div
              className="absolute inset-0 bg-primary/20 rounded-full animate-radar-ping"
              style={{ animationDelay: "0.5s" }}
            />
            <div className="relative z-10 w-full h-full bg-background border-2 border-primary/20 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)]">
              <div className="relative">
                <Icon className="w-10 h-10 text-primary" />
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
              </div>
            </div>
          </div>
        );
      case "pulse":
        return (
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div
              className={cn(
                "absolute inset-0 rounded-full animate-ping opacity-20",
                isDestructive ? "bg-destructive/20" : "bg-primary/20",
              )}
            />
            <div
              className={cn(
                "relative w-full h-full rounded-full flex items-center justify-center border",
                isDestructive
                  ? "bg-destructive/5 border-destructive/10"
                  : "bg-primary/5 border-primary/10",
              )}
            >
              <Icon
                className={cn("w-9 h-9", isDestructive ? "text-destructive" : "text-primary/60")}
              />
            </div>
          </div>
        );
      default: // float - using CSS animation for GPU acceleration
        return (
          <div
            className={cn(
              "w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/5 shadow-inner animate-float",
              isDestructive ? "bg-destructive/10" : "bg-muted/30",
            )}
          >
            <Icon
              className={cn(
                "w-10 h-10",
                isDestructive ? "text-destructive" : "text-muted-foreground/40",
              )}
            />
          </div>
        );
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center h-full p-8 text-center animate-in fade-in duration-500",
        variant === "vibrant" && "bg-gradient-to-b from-primary/5 to-transparent",
        variant === "minimal" && "opacity-80 p-4",
        className,
      )}
    >
      {renderIcon()}

      <div className="max-w-md w-full animate-in fade-in-0 slide-in-from-bottom-2 duration-300 delay-200">
        <h3
          className={cn(
            "text-sm font-bold tracking-tight mb-2",
            isDestructive ? "text-destructive" : "text-foreground",
            titleClassName,
          )}
        >
          {title}
        </h3>

        {description && (
          <div className="text-xs text-muted-foreground leading-relaxed mb-6">{description}</div>
        )}

        {action && (
          <Button
            onClick={action.onClick}
            isLoading={action.isLoading}
            className="rounded-xl px-6 h-9 shadow-md shadow-primary/10 transition-all active:scale-95"
          >
            {action.icon && !action.isLoading && <action.icon className="w-3.5 h-3.5 mr-2" />}
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
