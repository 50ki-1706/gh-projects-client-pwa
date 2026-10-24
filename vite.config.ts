import { defineConfig } from "vite";
import { voidPlugin } from "void";
import solidPlugin from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [voidPlugin(), solidPlugin({ ssr: false })],
});
