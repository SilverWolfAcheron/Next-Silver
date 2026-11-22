import type { GitDiffFile, GitTreeNode } from "../types/git";

interface MutableDirectory {
  name: string;
  path: string;
  directories: Map<string, MutableDirectory>;
  files: GitTreeNode[];
  additions: number;
  deletions: number;
}

function finalizeDirectory(directory: MutableDirectory): GitTreeNode[] {
  const dirNodes: GitTreeNode[] = Array.from(directory.directories.values())
    .sort((left: MutableDirectory, right: MutableDirectory): number =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
    )
    .map((child: MutableDirectory): GitTreeNode => ({
      name: child.name,
      path: child.path,
      kind: "directory",
      children: finalizeDirectory(child),
      additions: child.additions,
      deletions: child.deletions,
    }));

  const fileNodes: GitTreeNode[] = [...directory.files].sort(
    (left: GitTreeNode, right: GitTreeNode): number =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
  );

  return [...dirNodes, ...fileNodes];
}

export function buildGitChangesTree(files: GitDiffFile[]): GitTreeNode[] {
  const root: MutableDirectory = {
    name: "",
    path: "",
    directories: new Map(),
    files: [],
    additions: 0,
    deletions: 0,
  };

  for (const file of files) {
    const parts: string[] = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current: MutableDirectory = root;
    current.additions += file.additions;
    current.deletions += file.deletions;

    for (let index: number = 0; index < parts.length - 1; index += 1) {
      const segment: string = parts[index];
      const nextPath: string = current.path ? `${current.path}/${segment}` : segment;
      let child: MutableDirectory | undefined = current.directories.get(segment);
      if (!child) {
        child = {
          name: segment,
          path: nextPath,
          directories: new Map(),
          files: [],
          additions: 0,
          deletions: 0,
        };
        current.directories.set(segment, child);
      }
      child.additions += file.additions;
      child.deletions += file.deletions;
      current = child;
    }

    const fileName: string = parts[parts.length - 1];
    current.files.push({
      name: fileName,
      path: file.path,
      kind: "file",
      file,
      additions: file.additions,
      deletions: file.deletions,
    });
  }

  return finalizeDirectory(root);
}
