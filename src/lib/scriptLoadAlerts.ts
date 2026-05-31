import i18n from "../i18n";
import { Logger } from "./logger";
import { notify } from "./notify";

export interface ScriptLoadFailure {
  path: string;
  name: string;
  error: string;
}

export interface ScriptLoadReport {
  loaded: string[];
  failed: ScriptLoadFailure[];
  loaded_count: number;
  failed_count: number;
}

/** Dedupe notifications within the same app session (engine restart clears report). */
let lastNotifiedSignature: string | null = null;

function buildFailureSignature(failed: ScriptLoadFailure[]): string {
  return failed.map((f) => `${f.name}:${f.error}`).join("|");
}

export async function fetchScriptLoadReport(port: number): Promise<ScriptLoadReport | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/_relay/scripts/load_status`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as ScriptLoadReport;
  } catch (error) {
    Logger.debug("Failed to fetch script load report:", error);
    return null;
  }
}

/**
 * Show in-app notification when one or more enabled scripts failed to load.
 * Safe to call after engine start/restart; no-ops when all scripts loaded.
 */
export async function notifyScriptLoadIssues(port: number, force = false): Promise<void> {
  const report = await fetchScriptLoadReport(port);
  if (!report?.failed?.length) {
    return;
  }

  const signature = buildFailureSignature(report.failed);
  if (!force && signature === lastNotifiedSignature) {
    return;
  }
  lastNotifiedSignature = signature;

  const failed = report.failed;
  const names = failed.map((f) => f.name).join(", ");

  if (failed.length === 1) {
    const item = failed[0];
    notify.warning(
      i18n.t("scripts.load_failed_single_msg", {
        name: item.name,
        error: item.error,
      }),
      i18n.t("scripts.load_failed_title"),
    );
    return;
  }

  notify.warning(
    i18n.t("scripts.load_failed_msg", {
      count: failed.length,
      names,
      detail: failed[0].error,
    }),
    i18n.t("scripts.load_failed_title"),
  );
}

/** Call when a new engine process is expected (e.g. after restart). */
export function resetScriptLoadAlertDedupe(): void {
  lastNotifiedSignature = null;
}
