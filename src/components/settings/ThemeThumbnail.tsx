import { Check, Trash2 } from "lucide-react";
import type { Theme } from "../../stores/themeStore";

interface ThemeThumbnailProps {
  theme: Theme;
  isActive: boolean;
  onClick: () => void;
  onDelete?: () => void;
}

export const ThemeThumbnail: React.FC<ThemeThumbnailProps> = ({
  theme,
  isActive,
  onClick,
  onDelete,
}) => {
  // Get primary and background color for preview
  const bg = theme.colors["--color-background"];
  const primary = theme.colors["--color-primary"];
  const border = theme.colors["--color-border"];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group relative cursor-pointer rounded-xl border-2 transition-all p-2 bg-black/20 hover:bg-black/40 ${
        isActive ? "border-primary ring-2 ring-primary/20" : "border-transparent"
      }`}
    >
      {onDelete && (
        <div
          role="button"
          tabIndex={0}
          className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onDelete();
            }
          }}
        >
          <div className="p-1.5 bg-destructive/80 hover:bg-destructive text-white rounded-md shadow-sm backdrop-blur-sm">
            <Trash2 className="w-3 h-3" />
          </div>
        </div>
      )}

      <div
        className="w-full aspect-[4/3] rounded-lg overflow-hidden border shadow-sm transition-transform group-hover:scale-[1.02]"
        style={{ backgroundColor: bg, borderColor: border }}
      >
        {/* Mock UI layout in thumbnail */}
        <div className="p-1 space-y-1 opacity-60">
          <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: primary }}></div>
          <div className="flex gap-1">
            <div className="h-10 w-2 rounded-sm" style={{ backgroundColor: border }}></div>
            <div className="flex-1 space-y-1 pt-1">
              <div className="h-1 w-full rounded-full" style={{ backgroundColor: border }}></div>
              <div className="h-1 w-2/3 rounded-full" style={{ backgroundColor: border }}></div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between px-1">
        <span className="text-tiny font-medium opacity-80 truncate">{theme.name}</span>
        {isActive && (
          <div className="bg-primary rounded-full p-0.5">
            <Check className="w-2 h-2 text-primary-foreground" />
          </div>
        )}
      </div>
    </div>
  );
};
