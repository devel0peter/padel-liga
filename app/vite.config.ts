import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
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
