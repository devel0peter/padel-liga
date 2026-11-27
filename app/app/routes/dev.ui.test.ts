// The building blocks' gallery (D181, #418) is for local development only:
// its loader answers 404 in any other build (production, CI's build).
import { afterEach, describe, expect, it, vi } from "vitest";

import { loader } from "./dev.ui";

afterEach(() => {
  vi.unstubAllEnvs();
});

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("/dev/ui", () => {
  it("answers 404 outside development", () => {
    vi.stubEnv("DEV", false);
    const thrown = thrownBy(loader);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });

  it("renders in development", () => {
    vi.stubEnv("DEV", true);
    expect(loader()).toBeNull();
  });
});
