import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "MundiPorra",
        short_name: "MundiPorra",
        description: "La porra del Mundial",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        theme_color: "#a91f32",
        background_color: "#faf7f7",
        icons: [
          {
            src: "/icons/mundiporra-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/icons/mundiporra-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/icons/mundiporra-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/avatars(?:\/|$)/],
        globPatterns: [
          "**/*.{js,css,html,woff,woff2}",
          "favicon.png",
          "apple-touch-icon.png",
          "icons/mundiporra-icon-{192,512}.png"
        ]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/avatars": { target: "http://127.0.0.1:3001", changeOrigin: true }
    }
  }
});
