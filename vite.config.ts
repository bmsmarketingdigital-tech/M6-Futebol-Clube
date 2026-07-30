import vinext from "vinext";
import { defineConfig } from "vite";
const LOCAL_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const desktopStatePath = process.env.BASEFORTE_STATE_DIR;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
    {
      binding: "DB",
      database_name: "baseforte-local",
      database_id: LOCAL_DATABASE_ID,
    },
  ],
  r2_buckets: [
    {
      binding: "FILES",
      bucket_name: "baseforte-arquivos-locais",
    },
  ],
  vars: {
    WHATSAPP_BRIDGE_URL: process.env.WHATSAPP_BRIDGE_URL ?? "",
    WHATSAPP_BRIDGE_TOKEN: process.env.WHATSAPP_BRIDGE_TOKEN ?? "",
  },
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    cacheDir: process.env.BASEFORTE_CACHE_DIR,
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        persistState: desktopStatePath
          ? { path: desktopStatePath }
          : undefined,
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
