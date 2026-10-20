import type { JSX } from "solid-js";
import "./app.css";

export default function Layout(props: { children: JSX.Element }) {
  return <>{props.children}</>;
}
