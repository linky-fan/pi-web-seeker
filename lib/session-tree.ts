import type { SessionTreeNode } from "./types";

/**
 * Long linear sessions produce deeply nested tree chains that can make
 * JSON.stringify overflow. Keep branch points and leaves, but collapse the
 * uninteresting single-child nodes between them.
 */
export function compressSessionTree(nodes: SessionTreeNode[]): SessionTreeNode[] {
  function walk(node: SessionTreeNode): SessionTreeNode {
    let terminal = node;
    while (terminal.children.length === 1) {
      terminal = terminal.children[0];
    }

    if (terminal !== node) {
      return { ...node, children: [walk(terminal)] };
    }

    return { ...node, children: node.children.map(walk) };
  }

  return nodes.map(walk);
}
