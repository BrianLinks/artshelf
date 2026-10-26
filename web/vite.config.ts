import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run web:dev` serves the UI on :5173 and forwards /api to the API on :3000, so cookies stay same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false },
});
