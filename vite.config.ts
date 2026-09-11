import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { buildServiceWorker } from "./src/pwa/service-worker";

const packageVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

export default defineConfig({
  // All app resources are same-origin. Avoid Vary: Origin in the preview cache,
  // which otherwise distinguishes module requests from precache requests.
  preview: { cors: false },
  base: process.env.VITE_BASE ?? "./",
  define: { __APP_VERSION__: JSON.stringify(packageVersion) },
  plugins: [{
    name: "python-learning-service-worker",
    generateBundle(_, bundle) {
      const assets = Object.values(bundle).map(item => item.fileName).filter(name => name.startsWith("assets/"));
      this.emitFile({ type: "asset", fileName: "sw.js", source: buildServiceWorker(assets) });
    },
  }],
});
