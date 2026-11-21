import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { buffer: "buffer/" } },
  define: { "process.env": {}, global: "globalThis" },
  // the client reads the program's own map.txt / stations.txt (one source of truth)
  server: { fs: { allow: [".."] }, port: 5173 },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  optimizeDeps: { include: ["buffer"], esbuildOptions: { target: "es2022", define: { global: "globalThis" } } },
});
