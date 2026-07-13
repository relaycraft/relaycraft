import { Check, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";

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

export function GatewayView() {
  const { t } = useTranslation();
  const [routes, setRoutes] = useState<GatewayRoute[]>([]);
  const [editing, setEditing] = useState<GatewayRoute | null>(null);
  const [envs, setEnvs] = useState<EnvVars>({});
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const res = await loadAllRoutes();
      setRoutes(res.routes ?? []);
      const env = await loadEnv("default");
      setEnvs(env ?? {});
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    const doLoad = async () => {
      try {
        const res = await loadAllRoutes();
        setRoutes(res.routes ?? []);
        const env = await loadEnv("default");
        setEnvs(env ?? {});
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    };
    doLoad();
  }, []);

  const handleSave = async () => {
    if (!editing) return;
    await apiSaveRoute(editing, editing.group || "default");
    setEditing(null);
    reload();
  };

  const handleDelete = async (id: string) => {
    await apiDeleteRoute(id);
    reload();
  };

  const handleSaveEnv = async () => {
    await saveEnv("default", envs);
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/50 bg-muted/10 flex-shrink-0">
        <h2 className="text-base font-bold tracking-tight">{t("sidebar.gateway")}</h2>
        <Button size="sm" variant="quiet" onClick={reload} disabled={loading}>
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Routes */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Routes
            </h3>
            <Button size="sm" variant="outline" onClick={() => setEditing(emptyRoute())}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </div>

          {loading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : routes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No routes defined.</p>
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
                    {r.name || "(unnamed)"}
                  </span>
                  <span className="text-muted-foreground truncate">{r.match.path}</span>
                  <span className="text-muted-foreground/70 hidden md:inline">
                    &rarr; {r.upstream.url}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button size="icon-sm" variant="quiet" onClick={() => setEditing({ ...r })}>
                      <Check className="w-3 h-3" />
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
              Environment Variables
            </h3>
            <Button size="sm" variant="outline" onClick={handleSaveEnv}>
              Save
            </Button>
          </div>
          <div className="space-y-2">
            {Object.entries(envs).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="font-mono font-semibold w-40 shrink-0">{key}</span>
                <Input
                  value={value}
                  onChange={(e) => setEnvs((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="h-7 text-xs font-mono flex-1"
                  placeholder="value"
                />
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="quiet"
            className="mt-2 text-xs"
            onClick={() => setEnvs((prev) => ({ ...prev, NEW_KEY: "" }))}
          >
            <Plus className="w-3 h-3 mr-1" /> Add variable
          </Button>
        </section>
      </div>

      {/* Route Editor Modal */}
      {editing && (
        <div className="absolute inset-0 z-20 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-card border border-border/50 rounded-xl p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-bold">{editing.name ? "Edit Route" : "New Route"}</h3>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                Name
              </label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="text-xs"
                placeholder="User Service"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Path
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
                  Priority
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
                Host (optional)
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
                  Upstream URL
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
                  placeholder="http://localhost:3001"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Strip Prefix
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
                Group
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
                Enabled
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave}>
                <Check className="w-3.5 h-3.5 mr-1" /> Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
