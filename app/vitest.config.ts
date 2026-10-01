import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests don't load the Cloudflare plugin.
export default defineConfig({
  test: { include: ["app/**/*.test.ts"] },
});
