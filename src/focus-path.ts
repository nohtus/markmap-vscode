import type { INode } from 'markmap-common';

export type FoldSnapshot = Map<string, number | undefined>;

export function captureFoldState(root: INode): FoldSnapshot {
  const snapshot: FoldSnapshot = new Map();
  walk(root, (node) => {
    snapshot.set(node.state.key, node.payload?.fold);
  });
  return snapshot;
}

export function restoreFoldState(root: INode, snapshot: FoldSnapshot): void {
  walk(root, (node) => {
    setFold(node, snapshot.get(node.state.key));
  });
}

/**
 * Keep the target and its ancestors visible while collapsing every branch
 * that diverges from that path. The target itself is collapsed so descendants
 * outside the path are hidden too.
 */
export function collapseOutsidePath(root: INode, target: INode): void {
  const targetPath = target.state.path;

  function visit(node: INode, parentIsOnPath = false): void {
    const isTarget = node === target;
    const isOnPath = isTarget || targetPath.startsWith(`${node.state.path}.`);

    if (isOnPath) {
      setFold(node, isTarget && node.children?.length ? 1 : 0);
      if (!isTarget) {
        node.children?.forEach((child) => visit(child, true));
      }
    } else if (parentIsOnPath && node.children?.length) {
      setFold(node, 1);
    }
  }

  visit(root);
}

/**
 * Toggle a node while guaranteeing that expansion reveals exactly one level.
 * Grandchildren remain hidden because every expandable child is folded first.
 */
export function toggleOneLevel(node: INode): void {
  if (node.payload?.fold) {
    setFold(node, 0);
    node.children?.forEach((child) => {
      if (child.children?.length) setFold(child, 1);
    });
  } else if (node.children?.length) {
    setFold(node, 1);
  }
}

function walk(node: INode, visit: (node: INode) => void): void {
  visit(node);
  node.children?.forEach((child) => walk(child, visit));
}

function setFold(node: INode, fold: number | undefined): void {
  const payload = { ...node.payload };
  if (fold == null) delete payload.fold;
  else payload.fold = fold;
  node.payload = payload;
}
