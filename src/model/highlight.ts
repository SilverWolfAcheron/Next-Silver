import type { Element, ElementContent, Root } from "hast";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cmake from "highlight.js/lib/languages/cmake";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import groovy from "highlight.js/lib/languages/groovy";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

export const MAX_HIGHLIGHT_CHARS = 250_000;

const lowlight = createLowlight({
  bash,
  c,
  cmake,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  dos,
  go,
  graphql,
  groovy,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  nginx,
  php,
  plaintext,
  powershell,
  properties,
  protobuf,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
});

const EXACT_FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  "cmakelists.txt": "cmake",
  "cargo.lock": "ini",
  "go.mod": "go",
  "go.work": "go",
  "nginx.conf": "nginx",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  vagrantfile: "ruby",
  ".editorconfig": "ini",
  ".gitconfig": "ini",
  ".gitmodules": "ini",
  ".npmrc": "ini",
  ".yarnrc": "ini",
  ".pypirc": "ini",
  ".flake8": "ini",
  ".pylintrc": "ini",
  ".ini": "ini",
  ".env": "ini",
  ".eslintrc": "json",
  ".prettierrc": "json",
  ".babelrc": "json",
  ".swcrc": "json",
  ".jshintrc": "json",
  ".bashrc": "bash",
  ".bash_profile": "bash",
  ".zshrc": "bash",
  ".zprofile": "bash",
  ".profile": "bash",
  ".kshrc": "bash",
};

const EXTENSION_MAP: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  "c++": "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  "h++": "cpp",
  inl: "cpp",
  ipp: "cpp",
  py: "python",
  pyi: "python",
  pyw: "python",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  mkd: "markdown",
  json: "json",
  jsonc: "json",
  json5: "json",
  webmanifest: "json",
  arb: "json",
  geojson: "json",
  yaml: "yaml",
  yml: "yaml",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  cs: "csharp",
  csx: "csharp",
  ini: "ini",
  toml: "ini",
  env: "ini",
  inf: "ini",
  reg: "ini",
  service: "ini",
  socket: "ini",
  timer: "ini",
  desktop: "ini",
  properties: "properties",
  xml: "xml",
  html: "xml",
  htm: "xml",
  xhtml: "xml",
  svg: "xml",
  xaml: "xml",
  csproj: "xml",
  fsproj: "xml",
  vbproj: "xml",
  vcxproj: "xml",
  props: "xml",
  targets: "xml",
  plist: "xml",
  manifest: "xml",
  xsd: "xml",
  xsl: "xml",
  xslt: "xml",
  rss: "xml",
  atom: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ksh: "bash",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "dos",
  cmd: "dos",
  sql: "sql",
  mk: "makefile",
  mak: "makefile",
  cmake: "cmake",
  diff: "diff",
  patch: "diff",
  proto: "protobuf",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  rb: "ruby",
  gemspec: "ruby",
  php: "php",
  phtml: "php",
  swift: "swift",
  groovy: "groovy",
  gradle: "groovy",
  dockerfile: "dockerfile",
};

const AMBIGUOUS_CONFIG_EXTS = new Set(["config", "conf", "cfg"]);

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Shell",
  c: "C",
  cmake: "CMake",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  dockerfile: "Dockerfile",
  dos: "Batch",
  go: "Go",
  graphql: "GraphQL",
  groovy: "Groovy",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  less: "Less",
  lua: "Lua",
  makefile: "Makefile",
  markdown: "Markdown",
  nginx: "Nginx",
  php: "PHP",
  plaintext: "Text",
  powershell: "PowerShell",
  properties: "Properties",
  protobuf: "Protobuf",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  scss: "SCSS",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

function sniffConfigLanguage(source?: string): string {
  const trimmed = source?.trimStart() ?? "";
  if (trimmed.startsWith("<")) return "xml";
  if (trimmed.startsWith("{")) return "json";
  return "ini";
}

function sniffShebang(source?: string): string | null {
  if (!source?.startsWith("#!")) return null;
  const firstLine = source.slice(0, 128).split("\n", 1)[0].toLowerCase();
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
  const base = path.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  if (!base) return sniffShebang(source);

  const exact = EXACT_FILENAMES[base];
  if (exact) return exact;
  if (base === "config" || base === ".config") return sniffConfigLanguage(source);
  if (base.startsWith(".env.")) return "ini";
  if (base.startsWith("dockerfile.")) return "dockerfile";

  const dot = base.lastIndexOf(".");
  if (dot > 0 && dot < base.length - 1) {
    const ext = base.slice(dot + 1);
    if (AMBIGUOUS_CONFIG_EXTS.has(ext)) {
      return sniffConfigLanguage(source);
    }
    const mapped = EXTENSION_MAP[ext];
    if (mapped) return mapped;
  }

  return sniffShebang(source);
}

export function languageLabel(language: string | null, path?: string): string | null {
  if (!language) return null;
  if (path) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".toml")) return "TOML";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "HTML";
    if (lower.endsWith(".svg")) return "SVG";
    if (lower.endsWith(".tsx")) return "TSX";
    if (lower.endsWith(".jsx")) return "JSX";
    if (lower.endsWith(".config")) return language === "xml" ? "Config (XML)" : language === "json" ? "Config (JSON)" : "Config";
  }
  return LANGUAGE_LABELS[language] ?? language.toUpperCase();
}

const CODE_LANGUAGES = new Set([
  "c",
  "cpp",
  "csharp",
  "go",
  "graphql",
  "groovy",
  "java",
  "javascript",
  "kotlin",
  "lua",
  "php",
  "protobuf",
  "python",
  "ruby",
  "rust",
  "swift",
  "typescript",
]);

const WALKABLE_WRAPPERS = new Set([
  "hljs-class",
  "hljs-function",
  "hljs-params",
  "hljs-subst",
]);

const CONTROL_KEYWORDS = new Set([
  "as",
  "await",
  "break",
  "case",
  "catch",
  "continue",
  "default",
  "defer",
  "do",
  "elif",
  "else",
  "except",
  "export",
  "fallthrough",
  "finally",
  "for",
  "from",
  "go",
  "goto",
  "if",
  "import",
  "loop",
  "match",
  "package",
  "pass",
  "raise",
  "range",
  "return",
  "select",
  "switch",
  "throw",
  "try",
  "use",
  "while",
  "with",
  "yield",
]);

const CONST_DECLARATION_KEYWORDS = new Set(["const", "constexpr", "final", "readonly", "static"]);
const CODE_TOKEN_RE =
  /([A-Za-z_$][A-Za-z0-9_$]*)|(\d+(?:\.\d+)?)|(::|->)|([{}()[\],;.:]+)|([=+\-*/<>!&|^~?%@#\\]+)|(\s+|[^A-Za-z0-9_${}()[\],;.:=+\-*/<>!&|^~?%@#\\\s]+)/gu;

const SUBST_DELIMITERS: ReadonlyArray<readonly [string, string]> = [
  ["${", "}"],
  ["#{", "}"],
  ["\\(", ")"],
  ["{", "}"],
];

const RUST_FORMAT_RE = /(\{\{|\}\})|\{([A-Za-z_][A-Za-z0-9_]*|[0-9]+)?(:[^"{}\s]*)?\}/gu;
const STRING_ESCAPE_RE = /(\\(?:\r\n|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[0-7]{1,3}|.))|(%(?:[-+#0]*(?:\*|\d+)?(?:\.(?:\*|\d+))?[vTtbcdoqxXUeEfFgGspw%]))/gu;
const PRINTF_LANGUAGES = new Set(["c", "cpp", "go", "java", "python"]);
const JSX_EXPR_RE = /\{([^{}]+)\}/gu;

function getClasses(node: Element): string[] {
  const raw: unknown = node.properties?.className;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(/\s+/u).filter(Boolean);
  return [];
}

function getPlainText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(getPlainText).join("");
  return "";
}

function isAllCapsConstant(ident: string): boolean {
  return ident.length >= 2 && /^[A-Z][A-Z0-9_]+$/u.test(ident) && /[A-Z].*[A-Z_]/u.test(ident);
}

function isPascalType(ident: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/u.test(ident) && /[a-z]/u.test(ident);
}

function isWalkableElement(node: Element): boolean {
  const classes = getClasses(node);
  return classes.length > 0 && classes.every((cls) => WALKABLE_WRAPPERS.has(cls));
}

function collectDeclaredConstants(nodes: ElementContent[], language: string): Set<string> {
  const constants = new Set<string>();
  const flat: Array<{ kind: "keyword" | "ident" | "symbol" | "other"; value: string; inParams: boolean }> = [];

  function collectFlat(list: ElementContent[], inParams: boolean) {
    for (const node of list) {
      if (node.type === "text") {
        CODE_TOKEN_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = CODE_TOKEN_RE.exec(node.value)) !== null) {
          const [raw, ident, num, arrowOrScope, punct, op] = match;
          if (ident) flat.push({ kind: "ident", value: ident, inParams });
          else if (num) flat.push({ kind: "other", value: num, inParams });
          else if (arrowOrScope || punct || op) flat.push({ kind: "symbol", value: raw, inParams });
          else if (raw.includes("\n")) flat.push({ kind: "other", value: "\n", inParams });
        }
      } else if (node.type === "element") {
        const classes = getClasses(node);
        const text = getPlainText(node).trim();
        if (classes.includes("hljs-keyword") || (classes.includes("hljs-type") && CONST_DECLARATION_KEYWORDS.has(text))) {
          flat.push({ kind: "keyword", value: text, inParams });
        } else if (classes.includes("hljs-variable")) {
          if (classes.includes("constant_") && text) constants.add(text);
          else if (text) flat.push({ kind: "ident", value: text, inParams });
        } else if (isWalkableElement(node)) {
          collectFlat(node.children, inParams || classes.includes("hljs-params"));
        } else {
          flat.push({ kind: "other", value: text, inParams });
        }
      }
    }
  }

  collectFlat(nodes, false);

  for (let i = 0; i < flat.length; i += 1) {
    const tok = flat[i];
    if (tok.inParams || tok.kind !== "keyword" || !CONST_DECLARATION_KEYWORDS.has(tok.value)) continue;
    if (tok.value === "static" && (language === "java" || language === "csharp" || language === "cpp" || language === "c")) {
      continue;
    }

    const next = flat[i + 1];
    if (!next) continue;

    // Go `const ( A = 1 \n B = 2 )` block
    if (language === "go" && tok.value === "const" && next.kind === "symbol" && next.value.startsWith("(")) {
      let depth = 0;
      let expectLineIdent = true;
      for (let j = i + 1; j < flat.length; j += 1) {
        const cur = flat[j];
        if (cur.kind === "symbol") {
          for (const ch of cur.value) {
            if (ch === "(") depth += 1;
            else if (ch === ")") depth -= 1;
          }
          if (depth <= 0) {
            i = j;
            break;
          }
        } else if (cur.kind === "other" && cur.value === "\n") {
          expectLineIdent = true;
        } else if (expectLineIdent && cur.kind === "ident") {
          constants.add(cur.value);
          expectLineIdent = false;
        }
      }
      continue;
    }

    // Standard declaration: scan ahead up to `=`, `;`, or newline (skipping type/modifier tokens)
    let candidate: string | null = null;
    for (let j = i + 1; j < Math.min(flat.length, i + 10); j += 1) {
      const cur = flat[j];
      if (cur.kind === "other" && cur.value === "\n") break;
      if (cur.kind === "symbol" && (cur.value.includes(";") || cur.value.includes("{") || cur.value.includes(")"))) break;
      if (cur.kind === "symbol" && cur.value === "=") {
        if (candidate) constants.add(candidate);
        break;
      }
      if (cur.kind === "symbol" && cur.value === ":" && (language === "rust" || language === "typescript")) {
        if (candidate) constants.add(candidate);
        break;
      }
      if (cur.kind === "ident") {
        if (language === "go" || language === "rust" || language === "typescript" || language === "javascript") {
          candidate = candidate ?? cur.value;
        } else {
          candidate = cur.value;
        }
      }
    }
  }

  return constants;
}

function firstNonSpaceChar(nodes: ElementContent[], startIndex: number): string {
  for (let i = startIndex; i < nodes.length; i += 1) {
    const text = getPlainText(nodes[i]);
    const trimmed = text.trimStart();
    if (trimmed) return trimmed[0];
  }
  return "";
}

function enhanceCodeHast(root: Root, language: string): Root {
  if (!CODE_LANGUAGES.has(language)) return root;

  const children = root.children as ElementContent[];
  const constants = collectDeclaredConstants(children, language);
  let prevToken = "";

  function makeSpan(className: string[], value: string): Element {
    return {
      type: "element",
      tagName: "span",
      properties: { className },
      children: [{ type: "text", value }],
    };
  }

  function tokenizeText(value: string, followingChar: string): ElementContent[] {
    const out: ElementContent[] = [];
    const tokens: Array<{ raw: string; kind: "ident" | "num" | "scope" | "punct" | "op" | "other" }> = [];
    CODE_TOKEN_RE.lastIndex = 0;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = CODE_TOKEN_RE.exec(value)) !== null) {
      if (match.index > cursor) {
        tokens.push({ raw: value.slice(cursor, match.index), kind: "other" });
      }
      const [raw, ident, num, scope, punct, op] = match;
      if (ident) tokens.push({ raw, kind: "ident" });
      else if (num) tokens.push({ raw, kind: "num" });
      else if (scope) tokens.push({ raw, kind: "scope" });
      else if (punct) tokens.push({ raw, kind: "punct" });
      else if (op) tokens.push({ raw, kind: "op" });
      else tokens.push({ raw, kind: "other" });
      cursor = match.index + raw.length;
    }
    if (cursor < value.length) {
      tokens.push({ raw: value.slice(cursor), kind: "other" });
    }

    function nextNonSpaceToken(from: number): string {
      for (let i = from; i < tokens.length; i += 1) {
        const trimmed = tokens[i].raw.trim();
        if (trimmed) return trimmed;
      }
      return followingChar;
    }

    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i];
      if (tok.kind === "other") {
        out.push({ type: "text", value: tok.raw });
        const trimmed = tok.raw.trim();
        if (trimmed) prevToken = trimmed;
        continue;
      }
      if (tok.kind === "num") {
        out.push(makeSpan(["hljs-number"], tok.raw));
        prevToken = tok.raw;
        continue;
      }
      if (tok.kind === "punct") {
        out.push(makeSpan(["hljs-punctuation"], tok.raw));
        prevToken = tok.raw[tok.raw.length - 1];
        continue;
      }
      if (tok.kind === "scope") {
        out.push(makeSpan(["hljs-punctuation"], tok.raw));
        prevToken = tok.raw;
        continue;
      }
      if (tok.kind === "op") {
        out.push(makeSpan(["hljs-operator"], tok.raw));
        prevToken = tok.raw;
        continue;
      }

      const ident = tok.raw;
      const next = nextNonSpaceToken(i + 1);
      const isCall = next.startsWith("(");
      const isNamespace = next === "::";
      const isMember = prevToken === "." || prevToken === "->";

      if (isCall) {
        out.push(makeSpan(["hljs-title", "function_", "invoke__"], ident));
      } else if (isNamespace) {
        out.push(makeSpan(["hljs-type"], ident));
      } else if (!isMember && (constants.has(ident) || isAllCapsConstant(ident))) {
        out.push(makeSpan(["hljs-variable", "constant_"], ident));
      } else if (isMember) {
        out.push(makeSpan(constants.has(ident) ? ["hljs-variable", "constant_"] : ["hljs-property"], ident));
      } else if (isPascalType(ident)) {
        out.push(makeSpan(["hljs-type"], ident));
      } else if (/^[A-Z]$/u.test(ident) && (prevToken === "<" || prevToken === ":" || prevToken === "->" || prevToken === "&" || prevToken === ",")) {
        out.push(makeSpan(["hljs-type"], ident));
      } else {
        out.push(makeSpan(["hljs-variable"], ident));
      }
      prevToken = ident;
    }

    return out;
  }

  function tokenizeStringText(value: string): ElementContent[] {
    if (!value) return [];

    if (language === "rust" && value.includes("{")) {
      const out: ElementContent[] = [];
      let lastIndex = 0;
      RUST_FORMAT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = RUST_FORMAT_RE.exec(value)) !== null) {
        if (match.index > lastIndex) {
          out.push(...tokenizeStringEscapes(value.slice(lastIndex, match.index)));
        }
        const [full, escapedBrace, ident, spec] = match;
        if (escapedBrace) {
          out.push(makeSpan(["hljs-char", "escape_"], escapedBrace));
        } else {
          out.push(makeSpan(["hljs-template-tag"], "{"));
          if (ident) {
            if (/^[0-9]+$/u.test(ident)) {
              out.push(makeSpan(["hljs-number"], ident));
            } else if (constants.has(ident) || isAllCapsConstant(ident)) {
              out.push(makeSpan(["hljs-variable", "constant_"], ident));
            } else {
              out.push(makeSpan(["hljs-variable"], ident));
            }
          }
          if (spec) {
            out.push(makeSpan(["hljs-meta"], spec));
          }
          out.push(makeSpan(["hljs-template-tag"], "}"));
        }
        lastIndex = match.index + full.length;
      }
      if (lastIndex === 0) return tokenizeStringEscapes(value);
      if (lastIndex < value.length) {
        out.push(...tokenizeStringEscapes(value.slice(lastIndex)));
      }
      return out;
    }

    return tokenizeStringEscapes(value);
  }

  function tokenizeStringEscapes(value: string): ElementContent[] {
    if (!value || (!value.includes("\\") && !(PRINTF_LANGUAGES.has(language) && value.includes("%")))) {
      return [{ type: "text", value }];
    }
    const allowPrintf = PRINTF_LANGUAGES.has(language);
    const out: ElementContent[] = [];
    let lastIndex = 0;
    STRING_ESCAPE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STRING_ESCAPE_RE.exec(value)) !== null) {
      const [full, esc, verb] = match;
      if (verb && !allowPrintf) continue;
      if (match.index > lastIndex) {
        out.push({ type: "text", value: value.slice(lastIndex, match.index) });
      }
      out.push(makeSpan(["hljs-char", "escape_"], esc ?? full));
      lastIndex = match.index + full.length;
    }
    if (lastIndex === 0) return [{ type: "text", value }];
    if (lastIndex < value.length) {
      out.push({ type: "text", value: value.slice(lastIndex) });
    }
    return out;
  }

  function splitFormatSpec(nodes: ElementContent[]): { expr: ElementContent[]; spec: string } {
    if (language !== "python" && language !== "csharp") {
      return { expr: nodes, spec: "" };
    }
    const fullText = nodes.map(getPlainText).join("");
    let depth = 0;
    let splitAt = -1;
    let sawQuestion = false;
    for (let i = 0; i < fullText.length; i += 1) {
      const ch = fullText[i];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
      else if (depth === 0 && ch === "?") sawQuestion = true;
      else if (depth === 0 && ch === ":" && fullText[i + 1] !== "=" && !sawQuestion) {
        splitAt = i;
        break;
      }
    }
    if (splitAt < 0) return { expr: nodes, spec: "" };

    const expr: ElementContent[] = [];
    let remaining = splitAt;
    for (const child of nodes) {
      if (remaining <= 0) break;
      const len = getPlainText(child).length;
      if (len <= remaining) {
        expr.push(child);
        remaining -= len;
      } else if (child.type === "text") {
        expr.push({ type: "text", value: child.value.slice(0, remaining) });
        remaining = 0;
      } else {
        expr.push({ type: "text", value: getPlainText(child).slice(0, remaining) });
        remaining = 0;
      }
    }
    return { expr, spec: fullText.slice(splitAt) };
  }

  function transformSubst(node: Element): Element {
    const savedPrev = prevToken;
    prevToken = "";
    const inner = [...node.children];
    let openDelim = "";
    let closeDelim = "";

    const first = inner[0];
    const last = inner[inner.length - 1];
    if (first?.type === "text" && last?.type === "text") {
      for (const [open, close] of SUBST_DELIMITERS) {
        const canSplitSingle = inner.length === 1
          ? first.value.length >= open.length + close.length && first.value.startsWith(open) && first.value.endsWith(close)
          : first.value.startsWith(open) && last.value.endsWith(close);
        if (canSplitSingle) {
          openDelim = open;
          closeDelim = close;
          if (inner.length === 1) {
            const middle = first.value.slice(open.length, first.value.length - close.length);
            inner.splice(0, 1, ...(middle ? [{ type: "text" as const, value: middle }] : []));
          } else {
            const trimmedFirst = first.value.slice(open.length);
            const trimmedLast = last.value.slice(0, last.value.length - close.length);
            inner[0] = { type: "text", value: trimmedFirst };
            inner[inner.length - 1] = { type: "text", value: trimmedLast };
            if (!trimmedLast) inner.pop();
            if (!trimmedFirst) inner.shift();
          }
          break;
        }
      }
    }

    const { expr, spec } = splitFormatSpec(inner);
    const transformed: ElementContent[] = [];
    if (openDelim) transformed.push(makeSpan(["hljs-template-tag"], openDelim));
    transformed.push(...transform(expr));
    if (spec) transformed.push(makeSpan(["hljs-meta"], spec));
    if (closeDelim) transformed.push(makeSpan(["hljs-template-tag"], closeDelim));

    prevToken = savedPrev;
    return {
      ...node,
      children: transformed,
    };
  }

  function transformString(node: Element): Element {
    const childrenOut: ElementContent[] = [];
    for (const child of node.children) {
      if (child.type === "text") {
        childrenOut.push(...tokenizeStringText(child.value));
      } else if (child.type === "element") {
        const classes = getClasses(child);
        if (classes.includes("hljs-subst")) {
          childrenOut.push(transformSubst(child));
        } else if (classes.includes("hljs-variable") && !classes.includes("constant_")) {
          const bare = getPlainText(child).replace(/^\$\{?|\}$/gu, "");
          if (constants.has(bare) || isAllCapsConstant(bare)) {
            childrenOut.push({
              ...child,
              properties: { ...child.properties, className: [...classes, "constant_"] },
            });
          } else {
            childrenOut.push(child);
          }
        } else {
          childrenOut.push(child);
        }
      } else {
        childrenOut.push(child);
      }
    }
    return {
      ...node,
      children: childrenOut,
    };
  }

  function transformJsxXml(node: Element): Element {
    const out: ElementContent[] = [];
    for (const child of node.children) {
      if (child.type === "text" && child.value.includes("{")) {
        let lastIndex = 0;
        JSX_EXPR_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = JSX_EXPR_RE.exec(child.value)) !== null) {
          if (match.index > lastIndex) {
            out.push({ type: "text", value: child.value.slice(lastIndex, match.index) });
          }
          const savedPrev = prevToken;
          prevToken = "";
          out.push(makeSpan(["hljs-template-tag"], "{"));
          out.push(...tokenizeText(match[1], "}"));
          out.push(makeSpan(["hljs-template-tag"], "}"));
          prevToken = savedPrev;
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex === 0) out.push(child);
        else if (lastIndex < child.value.length) out.push({ type: "text", value: child.value.slice(lastIndex) });
      } else if (child.type === "element" && getClasses(child).includes("xml")) {
        out.push(transformJsxXml(child));
      } else {
        out.push(child);
      }
    }
    return { ...node, children: out };
  }

  function transform(list: ElementContent[]): ElementContent[] {
    const result: ElementContent[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const node = list[i];
      if (node.type === "text") {
        const following = firstNonSpaceChar(list, i + 1);
        result.push(...tokenizeText(node.value, following));
      } else if (node.type === "element") {
        const classes = getClasses(node);
        const text = getPlainText(node).trim();

        if (classes.includes("hljs-keyword") && CONTROL_KEYWORDS.has(text) && !classes.includes("control_")) {
          result.push({
            ...node,
            properties: { ...node.properties, className: [...classes, "control_"] },
          });
          prevToken = text;
        } else if (
          classes.includes("hljs-variable") &&
          !classes.includes("language_") &&
          !classes.includes("constant_") &&
          (constants.has(text) || isAllCapsConstant(text))
        ) {
          result.push({
            ...node,
            properties: { ...node.properties, className: [...classes, "constant_"] },
          });
          prevToken = text;
        } else if (classes.includes("hljs-string")) {
          result.push(transformString(node));
          prevToken = text;
        } else if (classes.includes("hljs-subst")) {
          result.push(transformSubst(node));
          prevToken = text;
        } else if ((language === "typescript" || language === "javascript") && classes.includes("xml")) {
          result.push(transformJsxXml(node));
          prevToken = text;
        } else if (isWalkableElement(node)) {
          result.push({
            ...node,
            children: transform(node.children),
          });
        } else {
          result.push(node);
          if (text && !classes.includes("hljs-comment")) {
            prevToken = text;
          }
        }
      } else {
        result.push(node);
      }
    }
    return result;
  }

  return {
    ...root,
    children: transform(children),
  };
}

export interface HighlightedDocument {
  language: string;
  label: string;
  root: Root;
}

export function highlightSource(source: string, path?: string): HighlightedDocument | null {
  if (!source || source.length > MAX_HIGHLIGHT_CHARS) return null;
  const language = detectLanguage(path, source);
  if (!language || !lowlight.registered(language)) return null;
  try {
    const root = enhanceCodeHast(lowlight.highlight(language, source), language);
    return {
      language,
      label: languageLabel(language, path) ?? language,
      root,
    };
  } catch {
    return null;
  }
}
