import { useEffect } from "react";
import type { AppearanceState } from "../agent-core/types";
import { useRuntimeStore } from "../stores/runtimeStore";
import type { RuntimeStore } from "../types/stores";
import { pushWindowTheme } from "../utils/theme";

export function useThemeSync(): void {
  const theme: AppearanceState["theme"] = useRuntimeStore(
    (s: RuntimeStore): AppearanceState["theme"] => s.state.appearance.theme
  );

  useEffect((): (() => void) | undefined => {
    const root: HTMLElement = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      pushWindowTheme(root, true);
      return;
    }
    if (theme === "light") {
      root.classList.remove("dark");
      pushWindowTheme(root, false);
      return;
    }

    const mq: MediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
    root.classList.toggle("dark", mq.matches);
    pushWindowTheme(root, mq.matches);
    const onChange = (event: MediaQueryListEvent): void => {
      root.classList.toggle("dark", event.matches);
      pushWindowTheme(root, event.matches);
    };
    mq.addEventListener("change", onChange);
    return (): void => mq.removeEventListener("change", onChange);
  }, [theme]);
}
