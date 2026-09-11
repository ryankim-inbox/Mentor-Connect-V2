import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT / BASE_PATH are supplied by .replit-artifact/artifact.toml ([services.env])
// when Replit runs this app. Outside Replit — CI, a local `pnpm build`, a
// container image — nothing sets them, so only require what the current command
// actually needs:
//
//   vite build            no port involved; BASE_PATH falls back to "/"
//   vite dev / preview    a port is required, because we bind one
//
// Requiring PORT for `build` is what made `pnpm build` impossible to run
// outside Replit (docs/RELEASE_SLICES_NON_PYTHON.md, Slice 02).
function resolvePort(command: "build" | "serve"): number | undefined {
  const raw = process.env.PORT;

  if (command !== "serve") {
    return undefined;
  }

  if (!raw) {
    throw new Error(
      "PORT environment variable is required to serve but was not provided. " +
        "Set it explicitly, e.g. `PORT=5173 BASE_PATH=/ pnpm dev`.",
    );
  }

  const port = Number(raw);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: "${raw}"`);
  }

  return port;
}

// The SPA calls the API with relative paths (`/api/...`) plus
// `credentials: "include"`, so it must be same-origin with the backend. In
// deployment Replit's path router handles that: this app is mounted at "/" and
// the API Shield artifact owns "/api". Locally there is no such router, so dev
// and preview proxy /api to the Shield — never directly to the Python server.
const apiProxy = {
  "/api": {
    target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8080",
    changeOrigin: true,
    secure: false,
  },
} as const;

export default defineConfig(async ({ command }) => {
  const port = resolvePort(command);
  const basePath = process.env.BASE_PATH ?? "/";

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(
          import.meta.dirname,
          "..",
          "..",
          "attached_assets",
        ),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      // Must stay in sync with `publicDir` in
      // artifacts/peerbridge/.replit-artifact/artifact.toml.
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      manifest: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: apiProxy,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: apiProxy,
    },
  };
});
