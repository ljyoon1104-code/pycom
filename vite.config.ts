import { defineConfig } from "vite";
import { buildServiceWorker } from "./src/pwa/service-worker";

export default defineConfig({
  base: process.env.VITE_BASE ?? "./",
  plugins: [{
    name: "python-learning-service-worker",
    generateBundle(_, bundle) {
      const assets = Object.values(bundle).map(item => item.fileName).filter(name => name.startsWith("assets/"));
      this.emitFile({ type: "asset", fileName: "sw.js", source: buildServiceWorker(assets) });
    },
  }],
});
