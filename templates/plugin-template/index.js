/*
 * RelayCraft Template Plugin — entry point.
 *
 * Runtime contract (no build step, no imports):
 * - globalThis.RelayCraft = { api, components, icons }
 *     api        — the scoped PluginAPI (see docs/plugin-development.md)
 *     components — shared host UI components (Button, Input, Tabs, ...)
 *     icons      — 47 curated lucide icon components
 * - globalThis.React — the app's own React instance. Compose UI with
 *   React.createElement (there is no JSX/bundler in the plugin runtime).
 *
 * This file demonstrates: registerPage, i18n.t, storage get/set, and toast.
 */

const { api, icons } = globalThis.RelayCraft;
const React = globalThis.React;
const { useEffect, useState } = React;

// Storage key for the demo counter. Keys must match [a-zA-Z0-9-_].
const COUNTER_KEY = "demo-counter";

// Simple inline styles — the template avoids depending on host CSS classes.
const styles = {
  page: { padding: 24, maxWidth: 480 },
  title: { display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 600 },
  hint: { opacity: 0.6, fontSize: 13, marginTop: 4 },
  row: { display: "flex", alignItems: "center", gap: 12, marginTop: 16 },
  count: { fontSize: 24, fontWeight: 700, minWidth: 48, textAlign: "center" },
  button: {
    padding: "6px 14px",
    borderRadius: 8,
    border: "1px solid rgba(128,128,128,0.4)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
};

function TemplatePage() {
  const t = api.i18n.t;
  const [count, setCount] = useState(null);

  // Load the persisted counter once on mount (requires storage:read).
  useEffect(() => {
    let cancelled = false;
    api.storage
      .get(COUNTER_KEY)
      .then((value) => {
        if (!cancelled) setCount(value === null ? 0 : Number(value) || 0);
      })
      .catch((err) => api.log.error("Failed to load counter", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the new value, then confirm with a toast (requires storage:write).
  const save = (next) => {
    setCount(next);
    api.storage
      .set(COUNTER_KEY, String(next))
      .then(() => api.ui.toast(t("counter.saved", { value: next }), "success"))
      .catch((err) => api.ui.toast(String(err), "error"));
  };

  const Sparkles = icons.Sparkles;

  return React.createElement(
    "div",
    { style: styles.page },
    React.createElement(
      "div",
      { style: styles.title },
      React.createElement(Sparkles, { className: "w-5 h-5" }),
      t("greeting"),
    ),
    React.createElement("p", { style: styles.hint }, t("counter.hint")),
    React.createElement(
      "div",
      { style: styles.row },
      React.createElement(
        "button",
        { type: "button", style: styles.button, onClick: () => save(0) },
        t("counter.reset"),
      ),
      React.createElement("span", { style: styles.count }, count === null ? "…" : String(count)),
      React.createElement(
        "button",
        { type: "button", style: styles.button, onClick: () => save((count ?? 0) + 1) },
        t("counter.increment"),
      ),
    ),
  );
}

// Register the page. `nameKey` is translated through this plugin's i18n
// namespace ("template" — see capabilities.i18n in plugin.yaml).
api.ui.registerPage({
  id: "template-page",
  name: "Template",
  nameKey: "page.title",
  route: "/plugin/template",
  component: TemplatePage,
  icon: icons.Sparkles,
});

api.log.info("Template plugin loaded");
