import { beforeEach, describe, expect, it } from "vitest";
import { usePluginRuntimeStore } from "./pluginRuntimeStore";

describe("pluginRuntimeStore", () => {
  beforeEach(() => {
    usePluginRuntimeStore.getState().clearAll();
  });

  it("should mark a plugin as loaded", () => {
    usePluginRuntimeStore.getState().markLoaded("plugin-a");
    const result = usePluginRuntimeStore.getState().loadResults["plugin-a"];
    expect(result.status).toBe("loaded");
    expect(result.error).toBeUndefined();
    expect(result.at).toBeGreaterThan(0);
  });

  it("should mark a plugin as errored with message", () => {
    usePluginRuntimeStore.getState().markError("plugin-a", "boom");
    const result = usePluginRuntimeStore.getState().loadResults["plugin-a"];
    expect(result.status).toBe("error");
    expect(result.error).toBe("boom");
  });

  it("should overwrite a previous result on re-mark", () => {
    const store = usePluginRuntimeStore.getState();
    store.markError("plugin-a", "boom");
    store.markLoaded("plugin-a");
    const result = usePluginRuntimeStore.getState().loadResults["plugin-a"];
    expect(result.status).toBe("loaded");
    expect(result.error).toBeUndefined();
  });

  it("should clear a single plugin result", () => {
    const store = usePluginRuntimeStore.getState();
    store.markLoaded("plugin-a");
    store.markLoaded("plugin-b");
    store.clear("plugin-a");
    const { loadResults } = usePluginRuntimeStore.getState();
    expect(loadResults["plugin-a"]).toBeUndefined();
    expect(loadResults["plugin-b"]).toBeDefined();
  });

  it("should be a no-op when clearing an unknown plugin", () => {
    const store = usePluginRuntimeStore.getState();
    store.markLoaded("plugin-a");
    const before = usePluginRuntimeStore.getState().loadResults;
    store.clear("plugin-b");
    expect(usePluginRuntimeStore.getState().loadResults).toBe(before);
  });

  it("should clear all results", () => {
    const store = usePluginRuntimeStore.getState();
    store.markLoaded("plugin-a");
    store.markError("plugin-b", "boom");
    store.clearAll();
    expect(usePluginRuntimeStore.getState().loadResults).toEqual({});
  });
});
