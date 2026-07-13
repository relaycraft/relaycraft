import { AlertTriangle, Check, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import type { EnvVars, GatewayRoute } from "@/lib/gateway";
import {
  deleteRoute as apiDeleteRoute,
  saveRoute as apiSaveRoute,
  loadAllRoutes,
  loadEnv,
  saveEnv,
} from "@/lib/gateway";
import { explainPath } from "@/lib/traffic/explainPath";
import { cn } from "@/lib/utils";
import { useProxyStore } from "@/stores/proxyStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { PathMetadata } from "@/types/flow";

function emptyRoute(): GatewayRoute {
  return {
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    priority: 0,
    group: "default",
    match: { path: "", host: undefined, headers: [], methods: [] },
    upstream: { url: "", stripPrefix: "", timeoutMs: 30000 },
  };
}

function pathPrefix(pattern: string): string {
  const star = pattern.indexOf("*");
  return star >= 0 ? pattern.slice(0, star) : pattern;
}

/** Enabled routes whose paths collide (same path or overlapping prefixes). */
function findPathOverlaps(routes: GatewayRoute[]): Array<{ a: string; b: string }> {
  const enabled = routes.filter((r) => r.enabled && r.match.path);
  const overlaps: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const pa = enabled[i].match.path;
      const pb = enabled[j].match.path;
      if (pa === pb) {
        overlaps.push({ a: enabled[i].name || pa, b: enabled[j].name || pb });
        continue;
      }
      const pra = pathPrefix(pa);
      const prb = pathPrefix(pb);
      if (pra && prb && (pra.startsWith(prb) || prb.startsWith(pra))) {
        overlaps.push({ a: enabled[i].name || pa, b: enabled[j].name || pb });
      }
    }
  }
  return overlaps;
}

function hasLocalhostUpstream(routes: GatewayRoute[]): boolean {
  return routes.some((r) => r.enabled && /localhost|127\.0\.0\.1|::1/i.test(r.upstream.url));
}

export function GatewayView() {
  const { t } = useTranslation();
  const config = useSettingsStore((s) => s.config);
  const updateGatewayConfig = useSettingsStore((s) => s.updateGatewayConfig);
  const restartProxy = useProxyStore((s) => s.restartProxy);
  const ipAddress = useProxyStore((s) => s.ipAddress);

  const gateway = config.gateway ?? {
    enabled: false,
    port: 9080,
    active_profile: "default",
    listen_lan: false,
  };

  const [routes, setRoutes] = useState<GatewayRoute[]>([]);
  const [editing, setEditing] = useState<GatewayRoute | null>(null);
  const [envs, setEnvs] = useState<EnvVars>({});
  const [envDraftKey, setEnvDraftKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);

  const [tryMethod, setTryMethod] = useState("GET");
  const [tryUrl, setTryUrl] = useState("");
  const [tryLoading, setTryLoading] = useState(false);
  const [tryResult, setTryResult] = useState<PathMetadata | null>(null);

  const [portInput, setPortInput] = useState(String(gateway.port));

  useEffect(() => {
    setPortInput(String(gateway.port));
  }, [gateway.port]);

  const profile = gateway.active_profile || "default";

  const reload = useCallback(async () => {
    setError(null);
    try {
      const res = await loadAllRoutes();
      setRoutes(res.routes ?? []);
      const env = await loadEnv(profile);
      setEnvs(env ?? {});
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    reload();
  }, [reload]);

  const overlaps = useMemo(() => findPathOverlaps(routes), [routes]);
  const shareLocalhost = gateway.enabled && hasLocalhostUpstream(routes);
  const entryHost = gateway.listen_lan ? ipAddress || "0.0.0.0" : "127.0.0.1";
  const entryUrl = `http://${entryHost}:${gateway.port}`;

  const persistGateway = async (next: typeof gateway) => {
    setError(null);
    try {
      await updateGatewayConfig(next);
      setNeedsRestart(true);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    setError(null);
    try {
      await restartProxy();
      setNeedsRestart(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setRestarting(false);
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    setError(null);
    try {
      await apiSaveRoute(editing, editing.group || "default");
      setEditing(null);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await apiDeleteRoute(id);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSaveEnv = async () => {
    setError(null);
    try {
      await saveEnv(profile, envs);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAddEnvVar = () => {
    const key = envDraftKey.trim();
    if (!key || key in envs) return;
    setEnvs((prev) => ({ ...prev, [key]: "" }));
    setEnvDraftKey("");
  };

  const handleTryPath = async () => {
    if (!tryUrl.trim()) return;
    setTryLoading(true);
    setTryResult(null);
    setError(null);
    try {
      const result = await explainPath(tryMethod, tryUrl.trim(), "gateway");
      setTryResult(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setTryLoading(false);
    }
  };

  return (
    <div className="relative h-full flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/50 bg-muted/10 flex-shrink-0">
        <h2 className="text-base font-bold tracking-tight">{t("sidebar.gateway")}</h2>
        <Button size="sm" variant="quiet" onClick={reload} disabled={loading}>
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Service controls */}
        <section className="rounded-xl border border-border/50 bg-card/30 p-4 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("gateway.service")}
          </h3>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={gateway.enabled}
                onChange={(e) => persistGateway({ ...gateway, enabled: e.target.checked })}
              />
              {t("gateway.enabled")}
            </label>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t("gateway.port")}</span>
              <Input
                className="h-7 w-24 text-xs font-mono"
                value={portInput}
                onChange={(e) => {
                  if (/^\d*$/.test(e.target.value)) setPortInput(e.target.value);
                }}
                onBlur={() => {
                  let port = parseInt(portInput, 10);
                  if (Number.isNaN(port) || port < 1024 || port > 65535) port = 9080;
                  setPortInput(String(port));
                  if (port !== gateway.port) persistGateway({ ...gateway, port });
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={gateway.listen_lan}
                onChange={(e) => persistGateway({ ...gateway, listen_lan: e.target.checked })}
              />
              {t("gateway.listen_lan")}
            </label>
          </div>
          {gateway.enabled && (
            <p className="text-xs font-mono text-muted-foreground">
              {t("gateway.entry_url", { url: entryUrl })}
            </p>
          )}
          {gateway.listen_lan && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {t("gateway.listen_lan_hint")}
            </p>
          )}
          {shareLocalhost && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {t("gateway.share_localhost_hint")}
            </p>
          )}
          {needsRestart && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground flex-1">{t("gateway.restart_needed")}</p>
              <Button size="sm" onClick={handleRestart} disabled={restarting}>
                {restarting ? t("gateway.restarting") : t("gateway.restart")}
              </Button>
            </div>
          )}
        </section>

        {/* Try path */}
        <section className="rounded-xl border border-border/50 bg-card/30 p-4 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("gateway.try_path")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("gateway.try_path_desc")}</p>
          <div className="flex flex-wrap gap-2">
            <select
              className="h-8 rounded-md border border-border/50 bg-background px-2 text-xs font-mono"
              value={tryMethod}
              onChange={(e) => setTryMethod(e.target.value)}
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <Input
              className="h-8 flex-1 min-w-[12rem] text-xs font-mono"
              value={tryUrl}
              onChange={(e) => setTryUrl(e.target.value)}
              placeholder={t("gateway.try_path_placeholder")}
            />
            <Button size="sm" onClick={handleTryPath} disabled={tryLoading || !tryUrl.trim()}>
              {tryLoading ? t("gateway.trying") : t("gateway.run_try")}
            </Button>
          </div>
          {tryResult && (
            <div className="text-xs space-y-1 font-mono bg-muted/30 rounded-lg p-3">
              <div>
                <span className="text-muted-foreground">{t("flow.path.entry")}: </span>
                {t("flow.path.entry_gateway")}
              </div>
              <div>
                <span className="text-muted-foreground">{t("flow.path.rewrite")}: </span>
                {tryResult.gateway_route_name
                  ? `${tryResult.gateway_route_name}${
                      tryResult.resolved_upstream ? ` → ${tryResult.resolved_upstream}` : ""
                    }`
                  : t("gateway.try_no_route")}
              </div>
              <div>
                <span className="text-muted-foreground">{t("flow.path.intercept")}: </span>
                {tryResult.rules_applied.length > 0
                  ? tryResult.rules_applied.map((r) => `${r.name} (${r.type})`).join(", ")
                  : t("flow.path.intercept_none")}
              </div>
              <div>{t(`flow.path.outcome_${tryResult.outcome}`, tryResult.outcome)}</div>
            </div>
          )}
        </section>

        {/* Routes */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("gateway.routes")}
            </h3>
            <Button size="sm" variant="outline" onClick={() => setEditing(emptyRoute())}>
              <Plus className="w-3.5 h-3.5 mr-1" /> {t("gateway.add_route")}
            </Button>
          </div>

          {overlaps.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t("gateway.overlap_title")}
              </p>
              {overlaps.map((o) => (
                <p key={`${o.a}-${o.b}`}>{t("gateway.overlap_item", { a: o.a, b: o.b })}</p>
              ))}
            </div>
          )}

          {loading ? (
            <p className="text-xs text-muted-foreground">{t("gateway.loading")}</p>
          ) : routes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">{t("gateway.no_routes")}</p>
          ) : (
            <div className="space-y-2">
              {routes.map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/30 text-xs font-mono",
                    !r.enabled && "opacity-50",
                  )}
                >
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      r.enabled ? "bg-green-500" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="font-semibold text-foreground min-w-0 truncate flex-1">
                    {r.name || t("gateway.unnamed")}
                  </span>
                  <span className="text-muted-foreground truncate">{r.match.path}</span>
                  <span className="text-muted-foreground/70 hidden md:inline">
                    &rarr; {r.upstream.url}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button size="icon-sm" variant="quiet" onClick={() => setEditing({ ...r })}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="icon-sm" variant="quiet" onClick={() => handleDelete(r.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Env */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("gateway.env_title", { profile })}
            </h3>
            <Button size="sm" variant="outline" onClick={handleSaveEnv}>
              {t("gateway.save_env")}
            </Button>
          </div>
          <div className="space-y-2">
            {Object.entries(envs).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="font-mono font-semibold w-40 shrink-0 truncate" title={key}>
                  {key}
                </span>
                <Input
                  value={value}
                  onChange={(e) => setEnvs((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="h-7 text-xs font-mono flex-1"
                  placeholder={t("gateway.env_value")}
                />
                <Button
                  size="icon-sm"
                  variant="quiet"
                  onClick={() =>
                    setEnvs((prev) => {
                      const next = { ...prev };
                      delete next[key];
                      return next;
                    })
                  }
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input
              className="h-7 text-xs font-mono w-40"
              value={envDraftKey}
              onChange={(e) => setEnvDraftKey(e.target.value)}
              placeholder={t("gateway.env_key")}
            />
            <Button size="sm" variant="quiet" className="text-xs" onClick={handleAddEnvVar}>
              <Plus className="w-3 h-3 mr-1" /> {t("gateway.add_env")}
            </Button>
          </div>
        </section>
      </div>

      {editing && (
        <div className="absolute inset-0 z-20 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-card border border-border/50 rounded-xl p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-bold">
              {editing.name ? t("gateway.edit_route") : t("gateway.new_route")}
            </h3>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                {t("gateway.field_name")}
              </label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="text-xs"
                placeholder={t("gateway.field_name_ph")}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {t("gateway.field_path")}
                </label>
                <Input
                  value={editing.match.path}
                  onChange={(e) =>
                    setEditing({ ...editing, match: { ...editing.match, path: e.target.value } })
                  }
                  className="text-xs font-mono"
                  placeholder="/api/users/*"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {t("gateway.field_priority")}
                </label>
                <Input
                  type="number"
                  value={editing.priority}
                  onChange={(e) =>
                    setEditing({ ...editing, priority: parseInt(e.target.value, 10) || 0 })
                  }
                  className="text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                {t("gateway.field_host")}
              </label>
              <Input
                value={editing.match.host ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    match: { ...editing.match, host: e.target.value || undefined },
                  })
                }
                className="text-xs font-mono"
                placeholder="api.example.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {t("gateway.field_upstream")}
                </label>
                <Input
                  value={editing.upstream.url}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      upstream: { ...editing.upstream, url: e.target.value },
                    })
                  }
                  className="text-xs font-mono"
                  placeholder="http://${HOST:-localhost}:3001"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {t("gateway.field_strip")}
                </label>
                <Input
                  value={editing.upstream.stripPrefix}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      upstream: { ...editing.upstream, stripPrefix: e.target.value },
                    })
                  }
                  className="text-xs font-mono"
                  placeholder="/api/users"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                {t("gateway.field_group")}
              </label>
              <Input
                value={editing.group}
                onChange={(e) => setEditing({ ...editing, group: e.target.value })}
                className="text-xs font-mono"
                placeholder="default"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                {t("gateway.route_enabled")}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                {t("gateway.cancel")}
              </Button>
              <Button size="sm" onClick={handleSave}>
                <Check className="w-3.5 h-3.5 mr-1" /> {t("gateway.save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
