import { invoke } from "@tauri-apps/api/core";

export interface GatewayRoute {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  group: string;
  match: RouteMatchConfig;
  upstream: UpstreamTarget;
}

export interface RouteMatchConfig {
  path: string;
  host?: string;
  headers: HeaderMatch[];
  methods: string[];
}

export interface HeaderMatch {
  name: string;
  value: string;
}

export interface UpstreamTarget {
  url: string;
  stripPrefix: string;
  timeoutMs: number;
}

export interface GatewayGroup {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
}

export interface LoadRoutesResponse {
  routes: GatewayRoute[];
  groups: GatewayGroup[];
}

export async function loadAllRoutes(): Promise<LoadRoutesResponse> {
  const raw = await invoke<string>("load_all_gateway_routes");
  return JSON.parse(raw);
}

export async function saveRoute(route: GatewayRoute, groupId: string): Promise<GatewayRoute> {
  return invoke<GatewayRoute>("save_gateway_route", {
    route: { ...route, match: { ...route.match, host: route.match.host ?? null } },
    groupId,
  });
}

export async function deleteRoute(routeId: string): Promise<void> {
  return invoke<void>("delete_gateway_route", { routeId });
}

export async function loadGroups(): Promise<GatewayGroup[]> {
  const raw = await invoke<string>("load_gateway_groups");
  return JSON.parse(raw);
}

export async function saveGroups(groups: GatewayGroup[]): Promise<void> {
  return invoke<void>("save_gateway_groups", { groups });
}

export type EnvVars = Record<string, string>;

export async function loadEnv(profile: string): Promise<EnvVars> {
  return invoke<EnvVars>("load_gateway_env", { profile });
}

export async function saveEnv(profile: string, vars: EnvVars): Promise<void> {
  return invoke<void>("save_gateway_env", { profile, vars });
}

export async function listProfiles(): Promise<string[]> {
  return invoke<string[]>("list_gateway_env_profiles");
}

export async function getGatewayDirPath(): Promise<string> {
  return invoke<string>("get_gateway_dir_path");
}
