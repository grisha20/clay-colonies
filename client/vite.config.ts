import { defineConfig, searchForWorkspaceRoot } from "vite";

export default defineConfig({
  build: { target: "es2022", rollupOptions: { input: { main: "index.html", motion: "motion.html" } } },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())]
    }
  }
});
