import { builtinModules } from "module";
import { defineConfig } from "vite";
import { dependencies } from "./package.json";

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    browserField: false,
  },
  build: {
    emptyOutDir: true,
    target: "node20",
    outDir: "./dist",
    rollupOptions: {
      external: [...builtinModules, ...Object.keys(dependencies)],
    },
    lib: {
      entry: {
        "cli.js": "src/cli.ts",
      },
      fileName: (format, entryName) => entryName,
      formats: ["cjs"],
    },
  },
});
