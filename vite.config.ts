import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "syntax",
              test: /[\\/]node_modules[\\/](highlight\.js|lowlight|devlop)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    watch: {
      ignored: ["**/src-tauri/**", "**/.silver-*.tmp"],
    },
  },
});
