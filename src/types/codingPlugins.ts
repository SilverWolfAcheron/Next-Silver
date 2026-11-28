import type { CheckAvailability } from "./check.ts";
import type { CodingProject } from "./codingProject.ts";
import type { CodingSymbolResult } from "./codingSymbols.ts";

export type CodingPluginCatalogEntry =
  | { id: "workspace"; operations: readonly ("overview" | "find-symbol")[] }
  | { id: "verification"; operations: readonly "inspect-checks"[] };

type CodingPluginOutput =
  | { plugin: "workspace"; operation: "overview"; output: CodingProject }
  | { plugin: "workspace"; operation: "find-symbol"; output: CodingSymbolResult }
  | { plugin: "verification"; operation: "inspect-checks"; output: CheckAvailability[] };

export type CodingPluginResult = { plugins: readonly CodingPluginCatalogEntry[] } | CodingPluginOutput;
