import { defineConfig } from "vite";

// Relative base so the same build works on GitHub Pages
// (https://corwinjames.github.io/house-builder/) and on localhost.
export default defineConfig({
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  build: {
    // three.js is one chunk on purpose. The warning is not a regression.
    chunkSizeWarningLimit: 800,
  },
});
