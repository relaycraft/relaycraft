import { motion } from "framer-motion";

interface Option {
  label: string | React.ReactNode;
  value: string;
}

interface SegmentedControlProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: "sm" | "md";
  name: string;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  className = "",
  size = "sm",
  name,
}: SegmentedControlProps) {
  const layoutId = `segmented-active-${name}`;
  return (
    <div
      className={`flex p-1 bg-muted/40 rounded-xl border border-border/40 relative ${className}`}
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            type="button"
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`
                            relative flex-1 flex items-center justify-center px-3 py-1.5 text-ui font-bold transition-colors z-10
                            ${isSelected ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
                            ${size === "sm" ? "h-7" : "h-9"}
                        `}
          >
            {isSelected && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 bg-white/10 rounded-lg shadow-sm border border-white/10 z-[-1]"
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
