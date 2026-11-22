import {
  AMBIGUOUS_CONFIG_EXTS,
  EXACT_FILENAMES,
  EXTENSION_MAP,
  LANGUAGE_LABELS,
} from "../../constants/syntax";

function sniffConfigLanguage(source?: string): string {
  const trimmed: string = source?.trimStart() ?? "";
  if (trimmed.startsWith("<")) return "xml";
  if (trimmed.startsWith("{")) return "json";
  return "ini";
}

function sniffShebang(source?: string): string | null {
  if (!source?.startsWith("#!")) return null;
  const firstLine: string = source.slice(0, 128).split("\n", 1)[0].toLowerCase();
  if (firstLine.includes("python")) return "python";
  if (firstLine.includes("node") || firstLine.includes("deno") || firstLine.includes("bun")) return "javascript";
  if (firstLine.includes("pwsh") || firstLine.includes("powershell")) return "powershell";
  if (firstLine.includes("ruby")) return "ruby";
  if (firstLine.includes("php")) return "php";
  if (firstLine.includes("bash") || firstLine.includes("zsh") || /\bsh\b/.test(firstLine)) return "bash";
  return null;
}

export function detectLanguage(path: string | undefined, source?: string): string | null {
  if (!path) return sniffShebang(source);
  const base: string = path.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  if (!base) return sniffShebang(source);

  const exact: string = EXACT_FILENAMES[base];
  if (exact) return exact;
  if (base === "config" || base === ".config") return sniffConfigLanguage(source);
  if (base.startsWith(".env.")) return "ini";
  if (base.startsWith("dockerfile.")) return "dockerfile";

  const dot: number = base.lastIndexOf(".");
  if (dot > 0 && dot < base.length - 1) {
    const ext: string = base.slice(dot + 1);
    if (AMBIGUOUS_CONFIG_EXTS.has(ext)) {
      return sniffConfigLanguage(source);
    }
    const mapped: string = EXTENSION_MAP[ext];
    if (mapped) return mapped;
  }

  return sniffShebang(source);
}

export function languageLabel(language: string | null, path?: string): string | null {
  if (!language) return null;
  if (path) {
    const lower: string = path.toLowerCase();
    if (lower.endsWith(".toml")) return "TOML";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "HTML";
    if (lower.endsWith(".svg")) return "SVG";
    if (lower.endsWith(".tsx")) return "TSX";
    if (lower.endsWith(".jsx")) return "JSX";
    if (lower.endsWith(".config")) {
      return language === "xml" ? "Config (XML)" : language === "json" ? "Config (JSON)" : "Config";
    }
  }
  return LANGUAGE_LABELS[language] ?? language.toUpperCase();
}
