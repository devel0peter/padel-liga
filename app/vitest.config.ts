import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests don't load the Cloudflare plugin.
// The "~" alias matches tsconfig, for tests that import server modules
// (pairs.server.test.ts mocks the database and email modules).
export default defineConfig({
  resolve: { alias: { "~": new URL("./app", import.meta.url).pathname } },
  test: { include: ["app/**/*.test.ts"] },
});
