import { defineConfig } from "vite";
import { buildServiceWorker } from "./src/pwa/service-worker";

export default defineConfig({
  // All app resources are same-origin. Avoid Vary: Origin in the preview cache,
  // which otherwise distinguishes module requests from precache requests.
  preview: { cors: false },
  base: process.env.VITE_BASE ?? "./",
  plugins: [{
    name: "python-learning-service-worker",
    generateBundle(_, bundle) {
      const assets = Object.values(bundle).map(item => item.fileName).filter(name => name.startsWith("assets/"));
      this.emitFile({ type: "asset", fileName: "sw.js", source: buildServiceWorker(assets) });
    },
  }],
});
