import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site at https://eserergun.github.io/third-chair/
export default defineConfig({
  base: process.env.VITE_BASE ?? "/third-chair/",
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 20000,
  },
});
