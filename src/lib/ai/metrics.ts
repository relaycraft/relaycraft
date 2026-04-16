import { useAIStore } from "../../stores/aiStore";
import { Logger } from "../logger";

export type AIToolPathOutcome =
  | "tool_success"
  | "tool_empty"
  | "fallback_stream"
  | "fallback_json"
  | "tool_error";

interface AIToolPathEvent {
  feature: string;
  outcome: AIToolPathOutcome;
  detail?: string;
}

interface AIModelContext {
  provider: string;
  model: string;
}

interface OutcomeBucket {
  total: number;
  byOutcome: Record<AIToolPathOutcome, number>;
}

interface AIToolMetricsSummary {
  startedAt: number;
  total: number;
  byFeature: Record<string, OutcomeBucket>;
  byProvider: Record<string, Record<string, Record<string, OutcomeBucket>>>;
  recentFallbackEvents: FallbackEvent[];
}

interface FallbackEvent {
  feature: string;
  outcome: AIToolPathOutcome;
  detail: string;
  provider: string;
  model: string;
}

const EMPTY_OUTCOME_COUNTS: Record<AIToolPathOutcome, number> = {
  tool_success: 0,
  tool_empty: 0,
  fallback_stream: 0,
  fallback_json: 0,
  tool_error: 0,
};

const metricsState: AIToolMetricsSummary = {
  startedAt: Date.now(),
  total: 0,
  byFeature: {},
  byProvider: {},
  recentFallbackEvents: [],
};

const createOutcomeBucket = (): OutcomeBucket => ({
  total: 0,
  byOutcome: { ...EMPTY_OUTCOME_COUNTS },
});

const RECENT_FALLBACK_WINDOW = 120;
const FALLBACK_REASON_TOP_K = 5;

const buildTopReasons = (events: FallbackEvent[]): [string, number][] => {
  const reasonCounter = new Map<string, number>();
  for (const item of events) {
    const reason = item.detail || "unknown_reason";
    reasonCounter.set(reason, (reasonCounter.get(reason) || 0) + 1);
  }
  return [...reasonCounter.entries()].sort((a, b) => b[1] - a[1]).slice(0, FALLBACK_REASON_TOP_K);
};

const resolveAIContext = (): AIModelContext => {
  try {
    const settings = useAIStore.getState().settings;
    return {
      provider: settings?.provider || "unknown_provider",
      model: settings?.model || "unknown_model",
    };
  } catch (_error) {
    return {
      provider: "unknown_provider",
      model: "unknown_model",
    };
  }
};

/**
 * Lightweight observability for tool-first AI paths.
 * Logs are structured and can be aggregated from app logs later.
 */
export const trackAIToolPath = (event: AIToolPathEvent) => {
  const context = resolveAIContext();

  metricsState.total += 1;
  if (!metricsState.byFeature[event.feature]) {
    metricsState.byFeature[event.feature] = createOutcomeBucket();
  }
  metricsState.byFeature[event.feature].total += 1;
  metricsState.byFeature[event.feature].byOutcome[event.outcome] += 1;

  if (!metricsState.byProvider[context.provider]) {
    metricsState.byProvider[context.provider] = {};
  }
  if (!metricsState.byProvider[context.provider][context.model]) {
    metricsState.byProvider[context.provider][context.model] = {};
  }
  if (!metricsState.byProvider[context.provider][context.model][event.feature]) {
    metricsState.byProvider[context.provider][context.model][event.feature] = createOutcomeBucket();
  }
  const featureBucket = metricsState.byProvider[context.provider][context.model][event.feature];
  featureBucket.total += 1;
  featureBucket.byOutcome[event.outcome] += 1;

  if (
    (event.outcome === "fallback_json" ||
      event.outcome === "fallback_stream" ||
      event.outcome === "tool_error") &&
    event.detail
  ) {
    metricsState.recentFallbackEvents.push({
      feature: event.feature,
      outcome: event.outcome,
      detail: event.detail,
      provider: context.provider,
      model: context.model,
    });
    if (metricsState.recentFallbackEvents.length > RECENT_FALLBACK_WINDOW) {
      metricsState.recentFallbackEvents.shift();
    }
  }

  const logResult = Logger.info("[AI_METRIC] tool_path", {
    ...event,
    provider: context.provider,
    model: context.model,
  });
  if (logResult && typeof (logResult as Promise<void>).catch === "function") {
    (logResult as Promise<void>).catch(() => undefined);
  }
};

export const formatAIToolMetricsReport = (): string => {
  const features = Object.keys(metricsState.byFeature).sort();
  const uptimeMinutes = Math.max(1, Math.floor((Date.now() - metricsState.startedAt) / 60000));

  if (features.length === 0) {
    return [
      "AI Tool Metrics (local session)",
      "",
      "- Total events: 0",
      `- Session age: ${uptimeMinutes} min`,
      "- No tool-path events recorded yet.",
      "",
      "Tip: trigger AI assistants first, then run /ai-metrics again.",
    ].join("\n");
  }

  const lines: string[] = [
    "AI Tool Metrics (local session)",
    "",
    `- Total events: ${metricsState.total}`,
    `- Session age: ${uptimeMinutes} min`,
    "",
    "By provider/model/feature:",
  ];

  const providers = Object.keys(metricsState.byProvider).sort();
  for (const provider of providers) {
    const byModel = metricsState.byProvider[provider];
    const models = Object.keys(byModel).sort();
    for (const model of models) {
      const byFeature = byModel[model];
      const featureKeys = Object.keys(byFeature).sort();
      for (const feature of featureKeys) {
        const item = byFeature[feature];
        const success = item.byOutcome.tool_success;
        const fallback = item.byOutcome.fallback_stream + item.byOutcome.fallback_json;
        const error = item.byOutcome.tool_error;
        const denominator = success + fallback + error;
        const fallbackRate = denominator > 0 ? ((fallback / denominator) * 100).toFixed(1) : "0.0";
        lines.push(
          `- ${provider}/${model}/${feature}: total=${item.total}, success=${success}, fallback=${fallback}, error=${error}, fallback_rate=${fallbackRate}%`,
        );
      }
    }
  }

  lines.push("", "By feature:");

  for (const feature of features) {
    const item = metricsState.byFeature[feature];
    const success = item.byOutcome.tool_success;
    const fallback = item.byOutcome.fallback_stream + item.byOutcome.fallback_json;
    const error = item.byOutcome.tool_error;
    const denominator = success + fallback + error;
    const fallbackRate = denominator > 0 ? ((fallback / denominator) * 100).toFixed(1) : "0.0";

    lines.push(
      `- ${feature}: total=${item.total}, success=${success}, fallback=${fallback}, error=${error}, fallback_rate=${fallbackRate}%`,
    );
  }

  if (metricsState.recentFallbackEvents.length > 0) {
    const topReasons = buildTopReasons(metricsState.recentFallbackEvents);

    lines.push(
      "",
      `Top fallback reasons (recent ${metricsState.recentFallbackEvents.length} events):`,
    );
    for (const [reason, count] of topReasons) {
      lines.push(`- ${reason}: ${count}`);
    }

    const scopedEvents = new Map<string, FallbackEvent[]>();
    for (const item of metricsState.recentFallbackEvents) {
      const key = `${item.provider}/${item.model}`;
      if (!scopedEvents.has(key)) {
        scopedEvents.set(key, []);
      }
      scopedEvents.get(key)!.push(item);
    }

    lines.push("", "Top fallback reasons by provider/model:");
    for (const key of [...scopedEvents.keys()].sort()) {
      const scoped = scopedEvents.get(key) || [];
      const scopedTopReasons = buildTopReasons(scoped);
      lines.push(`- ${key} (recent ${scoped.length}):`);
      for (const [reason, count] of scopedTopReasons) {
        lines.push(`  - ${reason}: ${count}`);
      }
    }
  }

  return lines.join("\n");
};
