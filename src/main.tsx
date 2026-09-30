import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./chrome.css";
import { useApp } from "./domain/app-store";
import { applyTheme } from "./theme/themes";

applyTheme(useApp.getState().preferences.theme);
const unsubscribeTheme = useApp.subscribe((state, previous) => {
  if (state.preferences.theme !== previous.preferences.theme)
    applyTheme(state.preferences.theme);
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribeTheme);

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing.");
createRoot(root).render(<App />);
