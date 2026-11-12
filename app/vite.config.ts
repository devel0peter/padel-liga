import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// The build's short commit hash, stored with feedback as the app version
// (lib/app-version.ts, spec 19). CI has GITHUB_SHA; elsewhere git, else none.
function appVersion(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // The end-to-end suite (e2e/server.ts) keeps its own local D1, apart
      // from the developer's .wrangler/state.
      persistState: process.env.E2E_PERSIST_DIR ? { path: process.env.E2E_PERSIST_DIR } : true,
    }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
