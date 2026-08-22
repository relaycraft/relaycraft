/**
 * Plugin bridge contract — mirrors `src-tauri/src/plugins/registry.rs`,
 * which is the single source of truth. The registry is fetched once via the
 * `get_plugin_api_contract` Tauri command and cached at module level, since
 * the contract does not change at runtime.
 */

import { invoke } from "@tauri-apps/api/core";

/** API domain of a bridge command. */
export type ApiDomain = "host" | "engine";

/** Declarative spec for a single `plugin_call` bridge command. */
export interface BridgeCommandSpec {
  /** Command name as sent by the plugin, e.g. "traffic_list_flows". */
  command: string;
  domain: ApiDomain;
  /** Required manifest permission; absent means no permission needed. */
  permission?: string;
  /** Frontend API surface this command backs, e.g. "traffic.listFlows". */
  api_surface: string;
  /** Whether invocations are written to the audit log. */
  audited: boolean;
  /** If set, this command is an alias of another registered command. */
  alias_of?: string;
}

/**
 * Declarative spec for a host-emitted event that plugins may subscribe to
 * via `api.events.on`.
 */
export interface PluginEventSpec {
  /** Event name as emitted by the host, e.g. "rules-changed". */
  event: string;
  domain: ApiDomain;
  /** Human-readable description of the event payload. */
  payload: string;
  /** What the event means and when it is emitted. */
  description: string;
}

/** Full plugin API contract: bridge commands plus subscribable host events. */
export interface PluginApiContract {
  commands: BridgeCommandSpec[];
  events: PluginEventSpec[];
}

/**
 * Fetch the full plugin API contract from the host.
 * Result is memoized for the lifetime of the renderer process.
 */
let cachedContract: Promise<PluginApiContract> | null = null;

export function getPluginApiContract(): Promise<PluginApiContract> {
  if (!cachedContract) {
    cachedContract = invoke<PluginApiContract>("get_plugin_api_contract");
  }
  return cachedContract;
}

/**
 * Per-domain metadata describing stability guarantees, for use by upcoming
 * permission/contract views. Not user-visible copy.
 */
export const API_DOMAIN_META: Record<
  ApiDomain,
  {
    /** i18n key placeholders for a future label/description. */
    labelKey: string;
    descriptionKey: string;
    stability: string;
  }
> = {
  host: {
    labelKey: "plugins.contract.domain.host",
    descriptionKey: "plugins.contract.domain.hostDesc",
    stability:
      "Stable host contract. Engine-independent (storage, runtime info, AI, stats, outbound HTTP).",
  },
  engine: {
    labelKey: "plugins.contract.domain.engine",
    descriptionKey: "plugins.contract.domain.engineDesc",
    stability:
      "Stable API shape backed by the current proxy engine; the implementation layer is swapped when the engine changes.",
  },
};
