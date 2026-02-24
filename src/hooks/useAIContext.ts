import { useEffect, useRef } from "react";
import { useAIStore } from "../stores/aiStore";
import { useProxyStore } from "../stores/proxyStore";
import { useRuleStore } from "../stores/ruleStore";
import { useScriptStore } from "../stores/scriptStore";

/**
 * Reactively syncs application state to the AI Context.
 * Syncs app state to AI Context. Mount once at App root.
 *
 * Subscribes to version numbers instead of full arrays to avoid
 * unnecessary re-renders on reference changes.
 */
export const useAIContext = () => {
  const refreshContext = useAIStore((state) => state.refreshContext);

  // Version numbers avoid re-renders on reference changes
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
    }, 1000); // 1s debounce

    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [refreshContext, _ruleVersion, _scriptVersion, _configUpdated]);
};
