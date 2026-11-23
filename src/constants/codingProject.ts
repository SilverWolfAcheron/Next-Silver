import type { CodingProjectEcosystem, CodingProjectLanguage, CodingProjectPackageManager } from "../types/codingProject.ts";

export const PROJECT_LIMITS: Readonly<{
  depth: number;
  directories: number;
  entries: number;
  entriesPerDirectory: number;
  topLevel: number;
  rankedFiles: number;
  packages: number;
  warnings: number;
  manifestBytes: number;
  scripts: number;
  entrypoints: number;
  patterns: number;
  pathLength: number;
}> = {
  depth: 6,
  directories: 112,
  entries: 8_000,
  entriesPerDirectory: 1_200,
  topLevel: 36,
  rankedFiles: 42,
  packages: 20,
  warnings: 16,
  manifestBytes: 96 * 1024,
  scripts: 16,
  entrypoints: 12,
  patterns: 12,
  pathLength: 320,
};

export const PROJECT_DIRECTORY_IGNORES: ReadonlySet<string> = new Set([
  ".git", ".hg", ".svn", ".idea", ".cache", ".venv", ".tox", ".nox", ".next", ".nuxt", ".output",
  ".yarn", ".pnpm", ".gradle", ".angular", ".turbo", ".cargo", ".mypy_cache", ".pytest_cache",
  ".ruff_cache", ".ssh", ".aws", ".vscode", "node_modules", "vendor", "bower_components",
  "dist", "dist-cli", "out", "build", "target", "coverage", "__pycache__", "venv", "obj",
]);

export const PROJECT_DIRECTORY_PRIORITY: ReadonlySet<string> = new Set([
  "app", "apps", "src", "lib", "libexec", "packages", "crates", "cmd", "internal",
  "cli", "docs", "test", "tests", "src-tauri", "examples",
]);

export const PROJECT_MANIFESTS: ReadonlyMap<string, CodingProjectEcosystem> = new Map([
  ["package.json", "node"],
  ["cargo.toml", "cargo"],
  ["go.mod", "go"],
  ["pyproject.toml", "python"],
  ["setup.cfg", "python"],
  ["gemfile", "ruby"],
  ["pom.xml", "maven"],
  ["build.gradle", "gradle"],
  ["build.gradle.kts", "gradle"],
  ["cmakelists.txt", "cmake"],
  ["composer.json", "composer"],
  ["package.swift", "swift"],
]);

export const PROJECT_CONFIG_FILES: ReadonlySet<string> = new Set([
  "pnpm-workspace.yaml", "tsconfig.json", "jsconfig.json", "eslint.config.js",
  "eslint.config.mjs", "vite.config.ts", "vite.config.js", "vitest.config.ts",
  "jest.config.js", "jest.config.ts", "go.work", "requirements.txt", "makefile",
  "justfile", "tauri.conf.json", "settings.gradle", "settings.gradle.kts",
  "dockerfile", "compose.yaml", "docker-compose.yml", "tox.ini", "pytest.ini",
]);

export const PROJECT_SOURCE_LANGUAGES: ReadonlyMap<string, CodingProjectLanguage> = new Map([
  [".c", "C"], [".h", "C"],
  [".cc", "C++"], [".cpp", "C++"], [".cxx", "C++"], [".hpp", "C++"],
  [".cs", "C#"], [".go", "Go"], [".java", "Java"],
  [".js", "JavaScript"], [".mjs", "JavaScript"], [".cjs", "JavaScript"], [".jsx", "JavaScript"],
  [".kt", "Kotlin"], [".kts", "Kotlin"], [".php", "PHP"], [".py", "Python"],
  [".rb", "Ruby"], [".rs", "Rust"], [".swift", "Swift"],
  [".ts", "TypeScript"], [".mts", "TypeScript"], [".cts", "TypeScript"], [".tsx", "TypeScript"],
]);

export const PROJECT_LOCK_MANAGERS: readonly [string, CodingProjectPackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];
