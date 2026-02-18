import logo from "../../assets/logo.svg";
import { cn } from "../../lib/utils";

interface AppLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
}

export function AppLogo({ size = 24, className, showText = false }: AppLogoProps) {
  return (
    <div className={cn("flex items-center gap-2 group cursor-default", className)}>
      <div
        className="relative flex items-center justify-center shrink-0 aspect-square"
        style={{ width: size, height: size }}
      >
        <img
          src={logo}
          alt="RelayCraft Logo"
          className="relative z-10 transition-transform duration-500 ease-out group-hover:scale-110 object-contain will-change-transform"
          style={{ width: "100%", height: "100%" }}
        />

        {/* Glow Effect */}
        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none will-change-[opacity]" />
      </div>

      {showText && (
        <span className="font-semibold tracking-[-0.01em] text-foreground/90 text-ui select-none">
          RelayCraft
        </span>
      )}
    </div>
  );
}
