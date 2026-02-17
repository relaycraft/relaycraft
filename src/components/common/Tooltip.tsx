import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: string | ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function Tooltip({ content, children, side = "top", className = "" }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let top = 0;
    let left = 0;

    // Calculate position based on side
    // Note: simplified calculation, for production might need more robust positioning logic (like floating-ui)
    switch (side) {
      case "top":
        top = rect.top - 8; // 8px default gap
        left = rect.left + rect.width / 2;
        break;
      case "bottom":
        top = rect.bottom + 8;
        left = rect.left + rect.width / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2;
        left = rect.left - 8;
        break;
      case "right":
        top = rect.top + rect.height / 2;
        left = rect.right + 8;
        break;
    }

    setCoords({ top, left });
    setIsVisible(true);
  };

  return (
    <div
      className={`relative flex items-center ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible &&
        createPortal(
          <div
            className="fixed z-[9999] px-3 py-1.5 text-ui font-bold text-popover-foreground bg-popover/95 backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-lg whitespace-nowrap pointer-events-none animate-in fade-in zoom-in-95 duration-200"
            style={{
              top: coords.top,
              left: coords.left,
              transform: `translate(${side === "left" || side === "right" ? (side === "left" ? "-100%, -50%" : "0, -50%") : `-50%, ${side === "top" ? "-100%" : "0"}`})`,
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </div>
  );
}
