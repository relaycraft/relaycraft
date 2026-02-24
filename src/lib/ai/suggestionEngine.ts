import type { TabType } from "../../stores/uiStore";
import type { Flow } from "../../types";
import type { Rule } from "../../types/rules";
import { Logger } from "../logger";

/**
 * The snapshot of the current application state used to generate suggestions.
 */
export interface SuggestionContext {
  activeTab: TabType;
  selectedFlow?: Flow | null;
  selectedRule?: Rule | null;
  input: string; // The user's current input in the command box
  running: boolean; // Proxy running status
  aiEnabled: boolean; // Whether AI features are enabled
}

/**
 * A single suggestion item to be displayed in the Command Center.
 */
export interface Suggestion {
  id: string;
  label: string; // The text shown to the user
  action: string; // The value to insert or command to run
  group: "ai" | "navigation" | "action"; // Visual grouping
  score: number; // Relevance score (0-100), used for sorting
  icon?: string;
  description?: string; // Optional secondary text
}

/**
 * Interface that all Suggestion Providers must implement.
 */
export interface SuggestionProvider {
  name: string;
  getSuggestions(
    context: SuggestionContext,
    t: (key: string, options?: any) => string,
  ): Suggestion[];
}

/**
 * Registry to manage providers across the application.
 */
class SuggestionEngineRegistry {
  private providers: SuggestionProvider[] = [];
  private FREQUENCY_KEY = "relaycraft_cmd_frequency";

  register(provider: SuggestionProvider) {
    const existingIndex = this.providers.findIndex((p) => p.name === provider.name);
    if (existingIndex >= 0) {
      this.providers[existingIndex] = provider;
      Logger.debug(`[SuggestionEngine] Replaced provider: ${provider.name}`);
    } else {
      this.providers.push(provider);
      Logger.debug(`[SuggestionEngine] Registered provider: ${provider.name}`);
    }
  }

  private getFrequencies(): Record<string, number> {
    try {
      const data = localStorage.getItem(this.FREQUENCY_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  recordUsage(action: string) {
    if (!action) return;
    try {
      const frequencies = this.getFrequencies();
      frequencies[action] = (frequencies[action] || 0) + 1;
      localStorage.setItem(this.FREQUENCY_KEY, JSON.stringify(frequencies));
    } catch (e) {
      console.error("Failed to record command usage", e);
    }
  }

  getAllSuggestions(
    context: SuggestionContext,
    t: (key: string, options?: any) => string,
  ): Suggestion[] {
    let allSuggestions: Suggestion[] = [];
    const frequencies = this.getFrequencies();

    for (const provider of this.providers) {
      try {
        const suggestions = provider.getSuggestions(context, t);
        allSuggestions = allSuggestions.concat(suggestions);
      } catch (error) {
        Logger.error(`[SuggestionEngine] Error in provider ${provider.name}`, error);
      }
    }

    // Global Processing:
    const query = context.input.toLowerCase().trim();

    if (query && query !== "/") {
      const isSlashSearch = query.startsWith("/");
      allSuggestions = allSuggestions.filter((s) => {
        if (isSlashSearch && !s.action.startsWith("/")) return false;

        return (
          s.label.toLowerCase().includes(query) ||
          s.action.toLowerCase().includes(query) ||
          (s.description && s.description.toLowerCase().includes(query))
        );
      });
    }

    // Add frequency weight to score (LFU-like boost)
    allSuggestions = allSuggestions.map((s) => {
      const freq = frequencies[s.action] || 0;
      // Boost score: +10 per use, capped at +500 to not overpower context-specific relevance
      const boost = Math.min(freq * 10, 500);
      return { ...s, score: s.score + boost };
    });

    // Sort by Score (Descending)
    allSuggestions.sort((a, b) => b.score - a.score);

    // Deduplicate by Label
    const unique = new Map<string, Suggestion>();
    for (const s of allSuggestions) {
      if (!unique.has(s.label)) {
        unique.set(s.label, s);
      } else {
        if (s.score > unique.get(s.label)!.score) {
          unique.set(s.label, s);
        }
      }
    }

    return Array.from(unique.values()).slice(0, 5); // Target limit of 5
  }
}

export const SuggestionEngine = new SuggestionEngineRegistry();
