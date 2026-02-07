import { useEffect } from 'react';

/**
 * useGlobalScrollbar
 * A global hook to manage "scrolling" state for all scrollable elements in the app.
 * Uses capture-phase listener to detect any scroll event and toggles a CSS class.
 */
export function useGlobalScrollbar() {
    useEffect(() => {
        const timers = new Map<HTMLElement, any>();

        const handleScroll = (e: Event) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;

            // Add scrolling class
            target.classList.add('is-scrolling');

            // Clear existing timer for this element
            if (timers.has(target)) {
                clearTimeout(timers.get(target));
            }

            // Remove class after delay
            const timer = setTimeout(() => {
                target.classList.remove('is-scrolling');
                timers.delete(target);
            }, 1500);

            timers.set(target, timer);
        };

        // Listen for all scroll events in the capture phase
        window.addEventListener('scroll', handleScroll, { capture: true, passive: true });

        return () => {
            window.removeEventListener('scroll', handleScroll, { capture: true });
            timers.forEach(timer => clearTimeout(timer));
            timers.clear();
        };
    }, []);
}
