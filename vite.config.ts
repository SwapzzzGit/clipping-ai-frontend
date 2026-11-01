import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs on :8000 (python backend/run.py); Vite proxies to it.
// Override with CLIPPER_BACKEND (env var or frontend/.env.local) if 8000 is taken.
export default defineConfig(({ mode }) => {
  const backend = loadEnv(mode, ".", "").CLIPPER_BACKEND || "http://127.0.0.1:8000";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": backend,
        "/media": backend,
      },
    },
  };
});
