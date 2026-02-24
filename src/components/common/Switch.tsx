import type { ComponentProps } from "react";

interface SwitchProps extends Omit<ComponentProps<"button">, "onChange" | "checked"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  size?: "sm" | "md";
}

export function Switch({
  checked,
  onCheckedChange,
  size = "md",
  className = "",
  disabled = false,
  ...props
}: SwitchProps) {
  const isSm = size === "sm";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      {...props}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) {
          onCheckedChange(!checked);
        }
      }}
      className={`
                relative inline-flex flex-shrink-0 cursor-pointer rounded-full border transition-all duration-300 ease-in-out focus:outline-none group
                ${isSm ? "h-[16px] w-[30px]" : "h-[20px] w-[36px]"}
                ${
                  checked
                    ? "bg-primary border-primary shadow-[0_0_12px_rgba(var(--primary-rgb),0.2)]"
                    : "bg-muted/20 border-border/80 hover:border-muted-foreground/30"
                }
                ${disabled ? "opacity-40 cursor-not-allowed grayscale" : ""}
                ${className}
            `}
    >
      <span
        className={`
                    pointer-events-none absolute top-1/2 -translate-y-1/2 transform rounded-full shadow-sm
                    transition-all duration-300 ease-in-out
                    ${isSm ? "h-[12px] w-[12px]" : "h-[14px] w-[14px]"}
                    ${
                      checked
                        ? `bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)] ${isSm ? "left-[16px]" : "left-[19px]"}`
                        : `bg-muted-foreground/40 group-hover:bg-muted-foreground/60 left-[2px]`
                    }
                `}
      />
    </button>
  );
}
