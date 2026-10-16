import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run build` writes the finished site into ../static, which server.py serves.
// `npm run dev` runs a hot-reloading dev server on :5173 and forwards /api calls
// to server.py on :8000, so run `python server.py --no-browser` alongside it.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../static",
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
