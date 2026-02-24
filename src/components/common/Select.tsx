import { Check, ChevronDown } from "lucide-react";
import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils";

interface SelectOption {
  value: string;
  label: string;
  triggerLabel?: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<ComponentProps<"select">, "onChange"> {
  containerClassName?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  align?: "left" | "right";
  options?: SelectOption[];
}

export const Select = ({
  className = "",
  containerClassName = "",
  children,
  value,
  defaultValue,
  onChange,
  placeholder,
  disabled,
  align = "left",
  options: propOptions,
}: SelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract options from props OR children
  const options =
    propOptions ||
    Children.map(children, (child) => {
      if (isValidElement(child) && child.type === "option") {
        const optionChild = child as ReactElement<
          ComponentProps<"option"> & { "data-trigger-label"?: string }
        >;
        return {
          value: optionChild.props.value?.toString() || "",
          label: optionChild.props.children?.toString() || "",
          triggerLabel: optionChild.props["data-trigger-label"] || undefined,
          disabled: optionChild.props.disabled,
        };
      }
      return null;
    })?.filter(Boolean) ||
    [];

  const selectedValue = value !== undefined ? value : defaultValue;
  const selectedOption = options.find((opt) => opt.value === selectedValue);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (val: string) => {
    if (disabled) return;
    if (onChange) {
      onChange(val);
    }
    setIsOpen(false);
  };

  return (
    <div className={`relative inline-block ${containerClassName}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex h-8 items-center justify-between w-full px-3 py-1 pr-8 bg-background hover:bg-muted/30 border border-border hover:border-border/80 rounded-lg text-ui font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm",
          className,
        )}
      >
        <span className="truncate text-left flex-1">
          {selectedOption
            ? selectedOption.triggerLabel || selectedOption.label
            : placeholder || "Select..."}
        </span>
        <ChevronDown
          className={cn(
            "absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground transition-transform duration-200",
            isOpen ? "rotate-180" : "",
          )}
        />
      </button>

      {isOpen && !disabled && (
        <div
          className={cn(
            "absolute z-50 mt-1 min-w-full w-max max-w-[300px] bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200",
            align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
          )}
        >
          <div className="p-1.5 space-y-0.5">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                onClick={() => handleSelect(option.value)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  option.value === selectedValue
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className="truncate text-left">{option.label}</span>
                {option.value === selectedValue && <Check className="w-3 h-3 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
