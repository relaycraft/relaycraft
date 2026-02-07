import { useState, useRef, useEffect, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * GlowCard - Premium Mouse-Following Glow Effect Component
 *
 * A wrapper component that adds a dynamic, mouse-following radial gradient glow effect
 * to its children. This creates a premium, interactive feel similar to high-end design
 * tools like Figma, Linear, and Framer.
 *
 * @component
 * @example
 * ```tsx
 * <GlowCard glowSize={300} glowOpacity={0.3}>
 *   <div className="p-4 bg-card rounded-lg">
 *     Your content here
 *   </div>
 * </GlowCard>
 * ```
 *
 * **Performance**: Uses GPU-accelerated CSS custom properties for smooth rendering.
 * Only tracks mouse position when hovering (not globally).
 *
 * **Future Integration**: This component is ready for use but not yet integrated.
 * Planned applications include:
 * - Composer response panel
 * - Traffic flow detail panel
 * - Rule editor cards
 * - Settings sections
 * - Modal dialogs
 *
 * @param {ReactNode} children - Content to wrap with glow effect
 * @param {string} [className] - Additional CSS classes
 * @param {string} [glowColor='rgba(59, 130, 246, 0.4)'] - Color of the glow (primary blue by default)
 * @param {number} [glowSize=200] - Radius of the glow effect in pixels
 * @param {number} [glowOpacity=0.6] - Opacity of the glow (0-1)
 */
interface GlowCardProps {
    children: ReactNode;
    className?: string;
    glowColor?: string;
    glowSize?: number;
    glowOpacity?: number;
}

export function GlowCard({
    children,
    className,
    glowColor = 'rgba(59, 130, 246, 0.4)', // primary color
    glowSize = 200,
    glowOpacity = 0.6
}: GlowCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
    const [isHovering, setIsHovering] = useState(false);

    useEffect(() => {
        const card = cardRef.current;
        if (!card) return;

        const handleMouseMove = (e: MouseEvent) => {
            const rect = card.getBoundingClientRect();
            setMousePosition({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            });
        };

        const handleMouseEnter = () => setIsHovering(true);
        const handleMouseLeave = () => setIsHovering(false);

        card.addEventListener('mousemove', handleMouseMove);
        card.addEventListener('mouseenter', handleMouseEnter);
        card.addEventListener('mouseleave', handleMouseLeave);

        return () => {
            card.removeEventListener('mousemove', handleMouseMove);
            card.removeEventListener('mouseenter', handleMouseEnter);
            card.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, []);

    return (
        <div
            ref={cardRef}
            className={cn('relative overflow-hidden', className)}
            style={{
                ['--mouse-x' as any]: `${mousePosition.x}px`,
                ['--mouse-y' as any]: `${mousePosition.y}px`,
            }}
        >
            {/* Glow Effect */}
            {isHovering && (
                <div
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300"
                    style={{
                        opacity: isHovering ? glowOpacity : 0,
                        background: `radial-gradient(${glowSize}px circle at var(--mouse-x) var(--mouse-y), ${glowColor}, transparent 80%)`
                    }}
                />
            )}

            {/* Content */}
            <div className="relative z-10">
                {children}
            </div>
        </div>
    );
}
