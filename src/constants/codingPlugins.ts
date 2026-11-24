import type { CodingPluginCatalogEntry } from "../types/codingPlugins.ts";

export const CODING_PLUGIN_CATALOG: readonly CodingPluginCatalogEntry[] = [
  { id: "workspace", operations: ["overview", "find-symbol"] },
  { id: "verification", operations: ["inspect-checks"] },
];
