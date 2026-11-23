export type CodingProjectFileKind = "instructions" | "documentation" | "configuration" | "manifest" | "entrypoint" | "test";

export type CodingProjectLanguage = "C" | "C#" | "C++" | "Go" | "Java" | "JavaScript" | "Kotlin" | "PHP" | "Python" | "Ruby" | "Rust" | "Swift" | "TypeScript";

export type CodingProjectEcosystem = "node" | "cargo" | "go" | "python" | "dotnet" | "cmake" | "gradle" | "maven" | "composer" | "ruby" | "swift";

export type CodingProjectScriptKind = "build" | "lint" | "test" | "typecheck" | "other";

export type CodingProjectPackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface CodingProjectScript {
  name: string;
  kind: CodingProjectScriptKind;
}

export interface CodingProjectPackage {
  root: string;
  manifest: string;
  ecosystem: CodingProjectEcosystem;
  name?: string;
  packageManager?: CodingProjectPackageManager;
  scripts?: CodingProjectScript[];
  workspacePatterns?: string[];
  workspaceRoot?: string;
  entrypoints?: string[];
}

export interface CodingProjectFile {
  path: string;
  kind: CodingProjectFileKind;
}

export interface CodingProjectLanguageCount {
  language: CodingProjectLanguage;
  files: number;
}

export interface CodingProjectTopLevel {
  path: string;
  kind: "directory" | "file";
}

export type CodingProjectWarningReason = "directory-limit" | "directory-unavailable" | "manifest-limit" | "manifest-unreadable" | "manifest-invalid";

export interface CodingProjectWarning {
  path: string;
  reason: CodingProjectWarningReason;
}

export interface CodingProject {
  directory: string;
  topLevel: CodingProjectTopLevel[];
  packages: CodingProjectPackage[];
  files: CodingProjectFile[];
  languages: CodingProjectLanguageCount[];
  warnings: CodingProjectWarning[];
  truncated: boolean;
}
