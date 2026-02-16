import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  visible: boolean;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, visible, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ x, y });
  const [isPositioned, setIsPositioned] = useState(false);

  // Initial positioning and measurement
  useLayoutEffect(() => {
    if (visible && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      let newX = x;
      let newY = y;

      const padding = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Horizontal check
      if (newX + rect.width > viewportWidth - padding) {
        newX = Math.max(padding, x - rect.width);
      }

      // Vertical check
      if (newY + rect.height > viewportHeight - padding) {
        newY = Math.max(padding, y - rect.height);
      }

      setAdjustedPos({ x: newX, y: newY });
      setIsPositioned(true);
    } else if (!visible) {
      setIsPositioned(false);
    }
  }, [x, y, visible]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleScroll = () => {
      if (visible) onClose();
    };

    if (visible) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScroll, true);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  // Adding minor 2px offset so it doesn't overlap cursor perfectly
  const style: React.CSSProperties = {
    top: adjustedPos.y + 2,
    left: adjustedPos.x + 2,
    opacity: isPositioned ? 1 : 0,
    pointerEvents: isPositioned ? "auto" : "none",
    // CRITICAL: Ensure NO transitions on top/left to prevent "flying in"
    // Increased duration to 250ms and refined timing for a more "natural" feel
    transition: isPositioned ? "opacity 250ms cubic-bezier(0.4, 0, 0.2, 1)" : "none",
  };

  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 min-w-[180px] bg-popover/80 backdrop-blur-xl border border-border/50 rounded-lg shadow-xl p-1",
      )}
      style={style}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex flex-col gap-0.5">
        {items.map((item, index) =>
          item.separator ? (
            <div key={index} className="h-px bg-border/50 my-1" />
          ) : (
            <button
              type="button"
              key={index}
              onClick={() => {
                if (item.disabled) return;
                item.onClick?.();
                onClose();
              }}
              disabled={item.disabled}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-lg text-system transition-colors w-full text-left",
                item.disabled
                  ? "opacity-50 cursor-not-allowed"
                  : item.danger
                    ? "text-destructive hover:bg-destructive/10"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {item.icon && (
                <span
                  className={cn(
                    "w-4 h-4 flex items-center justify-center",
                    item.danger ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {item.icon}
                </span>
              )}
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="text-[10px] text-muted-foreground/50 font-medium ml-4 tracking-tight">
                  {item.shortcut}
                </span>
              )}
            </button>
          ),
        )}
      </div>
    </div>,
    document.body,
  );
}
