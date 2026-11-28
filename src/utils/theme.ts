import { syncWindowTheme } from "../services/desktopClient";
import type { RgbTuple } from "../types/common";

function parseHexColor(value: string, fallback: RgbTuple): RgbTuple {
  const hex: string = value.trim().replace(/^#/u, "");
  if (!/^[0-9a-fA-F]{6}$/u.test(hex)) return fallback;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

export function pushWindowTheme(root: HTMLElement, dark: boolean): void {
  const styles: CSSStyleDeclaration = window.getComputedStyle(root);
  const bg: RgbTuple = parseHexColor(
    styles.getPropertyValue("--color-canvas"),
    dark ? [0x24, 0x1f, 0x19] : [0xef, 0xe6, 0xd5]
  );
  const fg: RgbTuple = parseHexColor(
    styles.getPropertyValue("--color-label"),
    dark ? [0xf3, 0xea, 0xd8] : [0x2c, 0x24, 0x1b]
  );
  const border: RgbTuple = parseHexColor(
    styles.getPropertyValue("--color-fill"),
    dark ? [0x44, 0x3b, 0x2f] : [0xd9, 0xcc, 0xb4]
  );
  syncWindowTheme({ dark, bg, fg, border });
}
