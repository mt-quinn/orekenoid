import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "127.0.0.1", port: 8080 },
  preview: { host: "127.0.0.1", port: 8080 },
  build: {
    target: "es2022",
    // Two pages: the game, and the world inspector at /worldmap.html. The inspector is a
    // development instrument, but it is built alongside so `npm run preview` can serve it.
    rollupOptions: { input: { main: "index.html", worldmap: "worldmap.html" } },
  },
});
