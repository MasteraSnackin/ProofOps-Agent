import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { proofopsApiPlugin } from "./server/proofops-api";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), proofopsApiPlugin(env)],
    server: {
      host: "127.0.0.1",
    },
    preview: {
      host: "127.0.0.1",
    },
  };
});
