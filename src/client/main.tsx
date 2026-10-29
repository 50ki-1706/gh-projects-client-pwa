import { createRoot } from "react-dom/client";
import "material/styles/base";
import App from "./App";
import "./app.css";

createRoot(document.getElementById("app")!).render(<App />);
