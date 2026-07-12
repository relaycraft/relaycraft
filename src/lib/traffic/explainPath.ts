import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { PathMetadata } from "../../types/flow";
import { getBackendPort } from "./portState";

export async function explainPath(
  method: string,
  url: string,
  entry: string = "forward",
): Promise<PathMetadata> {
  const apiUrl = `http://127.0.0.1:${getBackendPort()}/_relay/explain_path`;
  const res = await tauriFetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, url, entry }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`explain_path failed: ${res.status} ${text}`);
  }
  return res.json();
}
