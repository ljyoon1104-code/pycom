import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const packageVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(packageVersion) },
  test: { include: ["src/**/*.test.ts"] },
});
