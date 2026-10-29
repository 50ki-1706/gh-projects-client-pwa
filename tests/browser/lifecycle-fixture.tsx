// Dev-only entry: never imported by the production client or worker.
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import "material/styles/base";
import App from "../../src/client/App";
import "../../src/client/app.css";

let root: Root | undefined;
const fixture = {
  mount(strict = false) {
    if (root) throw new Error("Unmount the fixture before mounting");
    root = createRoot(document.getElementById("app")!);
    root.render(
      strict ? (
        <StrictMode>
          <App />
        </StrictMode>
      ) : (
        <App />
      ),
    );
  },
  unmount() {
    root?.unmount();
    root = undefined;
  },
};
declare global {
  interface Window {
    lifecycleFixture: typeof fixture;
  }
}
window.lifecycleFixture = fixture;
