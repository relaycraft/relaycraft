import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import React from 'react';

interface IconWrapperProps {
    icon: LucideIcon | React.ComponentType<any> | any;
    className?: string;
    active?: boolean;
    strokeWidth?: number;
    size?: number;
}

/**
 * IconWrapper - Adds a "Premium" look to icons by:
 * 1. Reducing stroke width for elegance.
 * 2. Adding a subtle "Ghost Glow" when active.
 * 3. Providing a consistent rendering container.
 */
export function IconWrapper({
    icon: Icon,
    className,
    active = false,
    strokeWidth = 1.6,
    size = 20
}: IconWrapperProps) {
    if (!Icon) return null;

    // Adaptive stroke width based on DPI for premium look on high-res screens
    const getAdaptiveStrokeWidth = (base: number) => {
        if (typeof window === 'undefined') return base;
        const dpr = window.devicePixelRatio || 1;
        // On high-DPI screens (Retina/4K), slightly thinner strokes look more refined
        if (dpr >= 2) return Math.max(1.2, base - 0.2);
        return base;
    };

    const finalStrokeWidth = getAdaptiveStrokeWidth(strokeWidth);

    // Helper to render the icon with correct props
    const renderIcon = (extraProps: any = {}) => {
        // SVG elements from plugins might need width/height instead of size
        const props = {
            size,
            width: size,
            height: size,
            strokeWidth: finalStrokeWidth,
            ...extraProps
        };

        if (typeof Icon === 'function') {
            return <Icon {...props} />;
        }

        // If it's a component or Lucide icon
        return <Icon {...props} />;
    };

    return (
        <div className={cn("relative flex items-center justify-center transition-all duration-300", className)}>
            {/* Ghost Background Glow (When Active) */}
            {active && (
                <div className="absolute text-primary/30 blur-[4px] animate-pulse pointer-events-none">
                    {renderIcon({ size: size + 2, width: size + 2, height: size + 2 })}
                </div>
            )}

            {/* Secondary Layer (Duotone-ish effect) */}
            <div className={cn(
                "relative z-10 transition-colors duration-300",
                active ? "text-foreground" : "text-muted-foreground/60"
            )}>
                {renderIcon()}
            </div>

            {/* Subtle Overlay for Active state depth */}
            {active && (
                <div className="absolute z-20 text-primary/10 opacity-50">
                    {renderIcon({ strokeWidth: strokeWidth + 0.2 })}
                </div>
            )}
        </div>
    );
}
