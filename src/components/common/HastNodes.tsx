import type { ElementContent } from "hast";
import type { ReactNode } from "react";

export function renderHastNodes(nodes: ElementContent[], keyPrefix: string = "n"): ReactNode[] {
  return nodes.map((node: ElementContent, index: number): ReactNode => {
    if (node.type === "text") {
      return node.value;
    }
    if (node.type === "element") {
      const rawClass: unknown = node.properties?.className;
      const className: string | undefined = Array.isArray(rawClass)
        ? rawClass.join(" ")
        : typeof rawClass === "string"
          ? rawClass
          : undefined;
      const key: string = `${keyPrefix}-${index}`;
      return (
        <span key={key} className={className}>
          {renderHastNodes(node.children, key)}
        </span>
      );
    }
    return null;
  });
}
