export const CODING_PREFLIGHT_MAX_ARTIFACTS: number = 20;
export const CODING_PREFLIGHT_MAX_FILES: number = 120;
export const CODING_PREFLIGHT_MAX_PATCH_BYTES: number = 2 * 1024 * 1024;
export const CODING_PREFLIGHT_MAX_PATCH_LINES: number = 40_000;
export const CODING_PREFLIGHT_MAX_SNAPSHOT_BYTES: number = 6 * 1024 * 1024;
export const CODING_PREFLIGHT_BULK_FILE_COUNT: number = 20;
export const CODING_PREFLIGHT_MAX_PATH_CHARS: number = 512;
export const CODING_PREFLIGHT_HUNK_SEARCH_RADIUS: number = 80;
export const CODING_PREFLIGHT_HUNK_MAX_ANCHORS: number = 30;

export const CODING_PREFLIGHT_PROTECTED_SEGMENTS: ReadonlySet<string> = new Set([
  ".git", ".hg", ".svn", ".bzr", ".ssh", ".aws",
]);
export const CODING_PREFLIGHT_SECRET_FILE: RegExp = /^(?:\.env(?:\..+)?|\.npmrc|\.pypirc|\.netrc|_netrc|\.git-credentials|credentials(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)|.+\.(?:pem|key|p12|pfx|kdbx))$/iu;
export const CODING_PREFLIGHT_ENV_TEMPLATE: RegExp = /^\.env\.(?:example|sample|template|dist)$/iu;

export const CODING_PREFLIGHT_EXTRA_LOCKFILE: RegExp = /^(?:bun\.lockb?|composer\.lock|flake\.lock|gemfile\.lock|uv\.lock|pdm\.lock|poetry\.lock|yarn\.lock|pipfile\.lock|deno\.lock|gradle\.lockfile|pubspec\.lock)$/iu;
export const CODING_PREFLIGHT_EXECUTION_FILE: RegExp = /^(?:package\.json|cargo\.toml|build\.rs|pyproject\.toml|setup\.(?:py|cfg)|makefile|gnumakefile|justfile|taskfile\.ya?ml|dockerfile(?:\..+)?|(?:docker-)?compose\.ya?ml|(?:vite|vitest|jest|webpack|rollup|eslint|playwright|babel)\.config\.[cm]?[jt]s)$/iu;
export const CODING_PREFLIGHT_EXECUTION_PATH: RegExp = /(?:^|\/)(?:\.github\/workflows|\.circleci|\.husky|\.githooks)(?:\/|$)/iu;
