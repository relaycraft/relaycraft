import { useCallback, useEffect, useRef, useState } from "react";

interface UseAutoScrollOptions {
  /** Whether auto-scroll is enabled */
  enabled: boolean;
  /** Threshold in pixels from bottom to consider "at bottom" */
  threshold?: number;
  /** Whether to pause when user scrolls up */
  pauseOnUserScroll?: boolean;
  /** Dependencies that trigger auto-scroll when changed (e.g., streaming content) */
  dependencies?: unknown[];
}

interface UseAutoScrollReturn {
  /** Ref to attach to the scrollable container */
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Whether auto-scroll is paused due to user interaction */
  isPaused: boolean;
  /** Manually trigger scroll to bottom */
  scrollToBottom: () => void;
  /** Resume auto-scroll after pause */
  resume: () => void;
  /** Pause auto-scroll */
  pause: () => void;
}

/**
 * A hook for intelligent auto-scrolling behavior.
 *
 * Features:
 * - Auto-scrolls to bottom when content changes
 * - Detects when user scrolls up and pauses auto-scroll
 * - Resumes auto-scroll when user scrolls to bottom
 * - Smooth scrolling animation
 *
 * @example
 * ```tsx
 * const { scrollRef, scrollToBottom } = useAutoScroll({
 *   enabled: isStreaming,
 *   pauseOnUserScroll: true,
 *   dependencies: [streamingContent],
 * });
 *
 * return (
 *   <div ref={scrollRef} className="overflow-y-auto">
 *     {content}
 *   </div>
 * );
 * ```
 */
export function useAutoScroll({
  enabled,
  threshold = 100,
  pauseOnUserScroll = true,
  dependencies = [],
}: UseAutoScrollOptions): UseAutoScrollReturn {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(0);
  const [isPaused, setIsPaused] = useState(false);

  // Scroll to bottom smoothly
  const scrollToBottom = useCallback(() => {
    if (!scrollRef.current || isPaused) return;

    const element = scrollRef.current;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: "smooth",
    });
  }, [isPaused]);

  // Resume auto-scroll
  const resume = useCallback(() => {
    setIsPaused(false);
  }, []);

  // Pause auto-scroll
  const pause = useCallback(() => {
    setIsPaused(true);
  }, []);

  // Handle user scroll events
  useEffect(() => {
    if (!(pauseOnUserScroll && scrollRef.current)) return;

    const handleScroll = () => {
      if (!scrollRef.current) return;

      const element = scrollRef.current;
      const currentScrollTop = element.scrollTop;
      const { scrollHeight, clientHeight } = element;
      const distanceFromBottom = scrollHeight - currentScrollTop - clientHeight;

      // Detect scroll direction
      const scrollingUp = currentScrollTop < lastScrollTopRef.current - 5;
      lastScrollTopRef.current = currentScrollTop;

      // If user scrolled up (intentionally), pause auto-scroll
      if (scrollingUp && enabled) {
        setIsPaused(true);
      }

      // If user scrolled to bottom, resume auto-scroll
      if (distanceFromBottom < threshold) {
        setIsPaused(false);
      }
    };

    const scrollElement = scrollRef.current;
    scrollElement.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [pauseOnUserScroll, enabled, threshold]);

  // Auto-scroll when dependencies change (content updates)
  useEffect(() => {
    if (!enabled || isPaused) return;

    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
      scrollToBottom();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isPaused, scrollToBottom, ...dependencies]);

  // Reset paused state when enabled changes
  useEffect(() => {
    if (!enabled) {
      setIsPaused(false);
    }
  }, [enabled]);

  return {
    scrollRef: scrollRef as React.RefObject<HTMLDivElement>,
    isPaused,
    scrollToBottom,
    resume,
    pause,
  };
}
