import { Play, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { explainPath } from "@/lib/traffic/explainPath";
import type { PathMetadata } from "@/types/flow";

interface PathSandboxProps {
  onResult: (data: PathMetadata) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
}

export function PathSandbox({ onResult, loading, setLoading }: PathSandboxProps) {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");

  const handleTry = async () => {
    if (!url.trim() || loading) return;
    setLoading(true);
    try {
      const result = await explainPath(method, url.trim());
      onResult(result);
    } catch {
      onResult({
        entry: "forward",
        rules_applied: [],
        outbound: { via_upstream_proxy: false, proxy_url: null },
        outcome: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 px-3 py-2 border-b border-border/50 bg-muted/10">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Search className="w-2.5 h-2.5 text-muted-foreground" />
        <span className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
          TRY_PATH
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="h-6 px-1.5 text-[10px] font-mono border border-border/50 rounded bg-background text-foreground outline-none focus:border-primary/50"
        >
          {["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleTry()}
          placeholder="https://example.com/api/users"
          className="flex-1 h-6 px-2 text-[10px] font-mono border border-border/50 rounded bg-background text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
        />
        <button
          type="button"
          onClick={handleTry}
          disabled={loading || !url.trim()}
          className="flex items-center gap-1 h-6 px-2 text-[10px] font-bold font-mono rounded bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 disabled:opacity-30 transition-colors"
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          RUN
        </button>
      </div>
    </div>
  );
}
