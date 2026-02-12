import { useEffect, useRef } from "react";
import { useAIStore } from "../stores/aiStore";
import { useProxyStore } from "../stores/proxyStore";
import { useRuleStore } from "../stores/ruleStore";
import { useScriptStore } from "../stores/scriptStore";

/**
 * Reactively syncs application state to the AI Context.
 * Should be mounted once at the App root.
 *
 * Performance optimization: Subscribe to version numbers instead of full arrays
 * to avoid unnecessary re-renders when array contents change but length doesn't.
 */
export const useAIContext = () => {
  const refreshContext = useAIStore((state) => state.refreshContext);

  // Subscribe to version numbers instead of full arrays for better performance
  // This avoids re-renders when the array reference changes but semantic content is same
  const _ruleVersion = useRuleStore((s) => s.version);
  const _scriptVersion = useScriptStore((s) => s.version);
  const _configUpdated = useProxyStore((s) => s.port); // Watch port as proxy associated config

  // Debounce ref
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    // Reactive dependencies to trigger refresh
    [_ruleVersion, _scriptVersion, _configUpdated].forEach(() => {});

    timeoutRef.current = window.setTimeout(() => {
      refreshContext();
    }, 1000); // 1-second debounce to avoid thrashing during typing or bulk updates

    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [refreshContext, _ruleVersion, _scriptVersion, _configUpdated]);
};
