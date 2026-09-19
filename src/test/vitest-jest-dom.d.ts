import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  // jest-dom 7 still augments the Vitest 4 `Assertion<T>` shape.
  // Vitest 5 uses `Assertion<Return, Received>`.
  interface Assertion<R = void> extends TestingLibraryMatchers<unknown, R> {}
}
