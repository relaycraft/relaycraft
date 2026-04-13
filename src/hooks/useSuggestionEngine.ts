import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ComposerProvider } from "../lib/ai/providers/ComposerProvider";
import { NavigationProvider } from "../lib/ai/providers/NavigationProvider";
import { PluginProvider } from "../lib/ai/providers/PluginProvider";
import { RulesProvider } from "../lib/ai/providers/RulesProvider";
import { ScriptProvider } from "../lib/ai/providers/ScriptProvider";
import { TrafficProvider } from "../lib/ai/providers/TrafficProvider";
import { SuggestionEngine } from "../lib/ai/suggestionEngine";
import { useAIStore } from "../stores/aiStore";
import { useProxyStore } from "../stores/proxyStore";
import { useRuleStore } from "../stores/ruleStore";
import { useTrafficStore } from "../stores/trafficStore";
import { useUIStore } from "../stores/uiStore";

// Initialize providers once
const initProviders = () => {
  SuggestionEngine.register(new NavigationProvider());
  SuggestionEngine.register(new TrafficProvider());
  SuggestionEngine.register(new RulesProvider());
  SuggestionEngine.register(new ScriptProvider());
  SuggestionEngine.register(new ComposerProvider());
  SuggestionEngine.register(new PluginProvider());
};

// Auto-init on module load
initProviders();

export const useSuggestionEngine = () => {
  const { t } = useTranslation();
  const activeTab = useUIStore((s) => s.activeTab);
  const selectedFlow = useTrafficStore((s) => s.selectedFlow);
  const selectedRule = useRuleStore((s) => s.selectedRule);
  const aiEnabled = useAIStore((s) => s.settings.enabled);
  const running = useProxyStore((s) => s.running);

  const getSuggestions = useCallback(
    (input: string) => {
      return SuggestionEngine.getAllSuggestions(
        {
          activeTab,
          selectedFlow,
          selectedRule,
          input,
          running,
          aiEnabled,
        },
        t,
      );
    },
    [activeTab, selectedFlow, selectedRule, running, aiEnabled, t],
  );

  return { getSuggestions };
};
