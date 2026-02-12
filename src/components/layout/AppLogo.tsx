import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

interface AppLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  animated?: boolean;
}

export function AppLogo({ size = 24, className, showText = false, animated = true }: AppLogoProps) {
  return (
    <div className={cn("flex items-center gap-2 group cursor-default", className)}>
      <div
        className="relative flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 128 128"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10 drop-shadow-sm transition-transform duration-500 ease-out group-hover:scale-110"
          style={{ shapeRendering: "geometricPrecision" }}
        >
          <defs>
            <linearGradient id="relaycraft-logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4F46E5" />
              <stop offset="100%" stopColor="#7C3AED" />
            </linearGradient>
          </defs>

          {/* Background Circle */}
          <path
            d="M 64 0 C 106 0 128 22 128 64 C 128 106 106 128 64 128 C 22 128 0 106 0 64 C 0 22 22 0 64 0 Z"
            fill="url(#relaycraft-logo-gradient)"
          />

          <g transform="translate(64, 64)">
            {/* Main R Structure */}
            <g
              stroke="white"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            >
              <line x1="-18" y1="-26" x2="-18" y2="-8" />
              <line x1="-18" y1="4" x2="-18" y2="26" />
              <path d="M -18,-26 L 0,-26 Q 18,-26 18,-12 Q 18,2 0,2 L -18,2" />
              <path d="M 0,2 Q 6,20 22,26" />
            </g>

            {/* Flowing Elements */}
            <g opacity="0.8">
              {/* The "Tunnel" Passing Line */}
              <motion.line
                x1="-28"
                y1="-2"
                x2="-8"
                y2="-2"
                stroke="white"
                strokeWidth="4"
                strokeLinecap="round"
                animate={
                  animated
                    ? {
                        x: [0, 5, 0],
                        opacity: [0.6, 1, 0.6],
                      }
                    : {}
                }
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />

              {/* Floating Packets / Accents */}
              <motion.line
                x1="24"
                y1="-18"
                x2="32"
                y2="-18"
                stroke="white"
                strokeWidth="4"
                strokeLinecap="round"
                animate={
                  animated
                    ? {
                        opacity: [0.4, 0.8, 0.4],
                      }
                    : {}
                }
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 0.5,
                }}
              />
              <motion.line
                x1="26"
                y1="8"
                x2="34"
                y2="8"
                stroke="white"
                strokeWidth="4"
                strokeLinecap="round"
                animate={
                  animated
                    ? {
                        opacity: [0.4, 0.8, 0.4],
                      }
                    : {}
                }
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 1,
                }}
              />

              {/* Optional: Add a small "packet" flowing through the gap */}
              {animated && (
                <motion.circle
                  r="2.5"
                  fill="white"
                  initial={{ x: -40, y: -2, opacity: 0 }}
                  animate={{
                    x: [-40, 40],
                    opacity: [0, 1, 1, 0],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "linear",
                    delay: 0.2,
                  }}
                />
              )}
            </g>
          </g>
        </svg>

        {/* Glow Effect */}
        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      </div>

      {showText && (
        <span className="font-semibold tracking-[-0.01em] text-foreground/90 text-system select-none">
          RelayCraft
        </span>
      )}
    </div>
  );
}
