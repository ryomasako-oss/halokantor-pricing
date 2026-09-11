import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@shared": path.resolve(__dirname, "shared"), "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: false },
  test: { environment: "node", include: ["shared/**/*.test.ts", "server/**/*.test.ts", "src/**/*.test.ts"] },
} as any);
