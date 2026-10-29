import { defineConfig } from "vite";
import { voidPlugin } from "void";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [voidPlugin(), react()],
});
