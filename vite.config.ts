import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { proofopsApiPlugin } from "./server/proofops-api.js";

const serverEnvPrefixes = ["ATTIO_", "TAVILY_", "GOOGLE_", "GEMINI_", "SUPERLINKED_", "SIE_", "SLNG_", "N8N_", "PROOFOPS_"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), serverEnvPrefixes);

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
