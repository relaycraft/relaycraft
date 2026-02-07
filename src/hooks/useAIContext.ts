import { useEffect, useRef } from 'react';
import { useRuleStore } from '../stores/ruleStore';
import { useScriptStore } from '../stores/scriptStore';
import { useProxyStore } from '../stores/proxyStore';
import { useAIStore } from '../stores/aiStore';

/**
 * Reactively syncs application state to the AI Context.
 * Should be mounted once at the App root.
 */
export const useAIContext = () => {
    const refreshContext = useAIStore(state => state.refreshContext);

    // Subscribe to store changes
    // We utilize the fact that zustand selectors trigger re-renders or subscription callbacks
    // However, to avoid excessive re-renders of the root component, we can use useEffect
    // dependent on specific versions or timestamps if available, or just leverage direct subscription.

    // For simplicity in V1, we just watch the stores' robust timestamps.
    const ruleUpdated = useRuleStore(s => s.rules);
    const scriptUpdated = useScriptStore(s => s.scripts);
    const configUpdated = useProxyStore(s => s.port); // Watch port as proxy associated config

    // Debounce ref
    const timeoutRef = useRef<number | null>(null);

    useEffect(() => {
        if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = window.setTimeout(() => {
            refreshContext();
        }, 1000); // 1-second debounce to avoid thrashing during typing or bulk updates

        return () => {
            if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
        };
    }, [ruleUpdated, scriptUpdated, configUpdated, refreshContext]);
};
