import { IDeferred, defer, wrapFunction, type INode } from 'markmap-common';
import { Toolbar } from 'markmap-toolbar';
import { defaultOptions, type Markmap } from 'markmap-view';
import {
  captureFoldState,
  collapseOutsidePath,
  restoreFoldState,
  type FoldSnapshot,
} from './focus-path';
import { deriveVSCodeOptions, type IMarkmapVSCodeOptions } from './options';

declare let mm: Markmap;

const vscode = acquireVsCodeApi();
let firstTime = true;
let root: INode | undefined;
let initialFoldState: FoldSnapshot | undefined;
let style: HTMLStyleElement;
let active: INode | undefined;
const activeNodeOptions: {
  placement?: 'center' | 'visible';
} = {};
let loading: IDeferred<void> | undefined;

const handlers = {
  async setData(data: {
    root?: INode;
    jsonOptions?: IMarkmapVSCodeOptions & {
      activeNode?: {
        placement?: 'center' | 'visible';
      };
    };
  }) {
    loading = defer();
    await mm.setData((root = data.root), {
      ...defaultOptions,
      ...deriveVSCodeOptions(data.jsonOptions),
    });
    initialFoldState = root && captureFoldState(root);
    activeNodeOptions.placement = data.jsonOptions?.activeNode?.placement;
    if (firstTime) {
      await mm.fit();
      firstTime = false;
    }
    loading.resolve();
  },
  async setCursor(options: { line: number; autoExpand?: boolean }) {
    await loading?.promise;
    const result = root && findActiveNode(options);
    if (!result) return;
    const { node, needRerender } = result;
    if (needRerender) await mm.renderData();
    highlightNode(node);
  },
  setCSS(data: string) {
    if (!style) {
      style = document.createElement('style');
      document.head.append(style);
    }
    style.textContent = data || '';
  },
  checkTheme,
  downloadSvg(path: string) {
    const content = new XMLSerializer().serializeToString(mm.svg.node());
    vscode.postMessage({ type: 'downloadSvg', data: { content, path } });
  },
  toggleNode(recursive: boolean) {
    if (!active) return;
    mm.toggleNode(active, recursive);
  },
  async focusPath() {
    if (!root || !active) return;
    collapseOutsidePath(root, active);
    await mm.setHighlight(active);
    await mm.centerNode(active, { bottom: 80 });
  },
  async resetView() {
    if (!root || !initialFoldState) return;
    restoreFoldState(root, initialFoldState);
    if (active) await mm.setHighlight(active);
    else await mm.renderData();
    await mm.fit();
  },
};
window.addEventListener('message', (e) => {
  const { type, data } = e.data;
  const handler = handlers[type];
  handler?.(data);
});
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement)?.closest('a');
  if (el) {
    const href = el.getAttribute('href');
    if (href.startsWith('#')) {
      const node = findHeading(href.slice(1));
      highlightNode(node);
    } else if (!href.includes('://')) {
      vscode.postMessage({
        type: 'openFile',
        data: href,
      });
    }
  }
});
vscode.postMessage({ type: 'refresh' });

const toolbar = new Toolbar();
toolbar.register({
  id: 'focusPath',
  title: 'Collapse all except the active path',
  content: createButton('Focus'),
  onClick: previewHandler('focusPath'),
});
toolbar.register({
  id: 'resetView',
  title: 'Restore the initial expansion state',
  content: createButton('Reset'),
  onClick: previewHandler('resetView'),
});
toolbar.register({
  id: 'editAsText',
  title: 'Edit as text',
  content: createButton('Edit'),
  onClick: clickHandler('editAsText'),
});
toolbar.register({
  id: 'export',
  title: 'Export',
  content: createButton('Export'),
  onClick: clickHandler('export'),
});
toolbar.setItems([
  'zoomIn',
  'zoomOut',
  'fit',
  'recurse',
  'focusPath',
  'resetView',
  'editAsText',
  'export',
]);

checkTheme();

setTimeout(() => {
  initialize(mm);
  toolbar.attach(mm);
  document.body.append(toolbar.el);
});

function initialize(mm: Markmap) {
  mm.renderData = wrapFunction(mm.renderData, async (fn, ...args) => {
    await fn.call(mm, ...args);
    mm.g
      .selectAll<SVGGElement, INode>(function () {
        const nodes = Array.from(this.childNodes) as Element[];
        return nodes.filter((el) => el.tagName === 'g') as SVGGElement[];
      })
      .on(
        'dblclick.focus',
        (e, d) => {
          const lines = d.payload?.lines as string | undefined;
          const line = +lines?.split(',')[0];
          if (!isNaN(line))
            vscode.postMessage({ type: 'setFocus', data: line });
        },
        true,
      );
  });
}

function checkTheme() {
  // https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content
  const isDark = ['vscode-dark', 'vscode-high-contrast'].some((cls) =>
    document.body.classList.contains(cls),
  );
  document.documentElement.classList[isDark ? 'add' : 'remove']('markmap-dark');
}

function createButton(text: string) {
  const el = document.createElement('div');
  el.className = 'btn-text';
  el.textContent = text;
  return el;
}

function clickHandler(type: string) {
  return () => {
    vscode.postMessage({ type });
  };
}

function previewHandler(type: 'focusPath' | 'resetView') {
  return () => handlers[type]();
}

function findHeading(id: string) {
  function dfs(node: INode) {
    if (!/^h\d$/.test(node.payload.tag as string)) return false;
    const normalizedId = node.content.trim().replace(/\W/g, '-').toLowerCase();
    if (normalizedId === id) {
      target = node;
      return true;
    }
    return node.children?.some(dfs);
  }
  let target: INode | undefined;
  dfs(root);
  return target;
}

function findActiveNode({
  line,
  autoExpand = true,
}: {
  line: number;
  autoExpand?: boolean;
}) {
  function dfs(node: INode, ancestors: INode[] = []) {
    const [start, end] =
      (node.payload?.lines as string)?.split(',').map((s) => +s) || [];
    if (start >= 0 && start <= line && line < end) {
      best = node;
      bestAncestors = ancestors;
    }
    ancestors = [...ancestors, node];
    node.children?.forEach((child) => {
      dfs(child, ancestors);
    });
  }
  let best: INode | undefined;
  let bestAncestors: INode[] = [];
  dfs(root);
  let needRerender = false;
  if (autoExpand) {
    bestAncestors.forEach((node) => {
      if (node.payload?.fold) {
        node.payload.fold = 0;
        needRerender = true;
      }
    });
  }
  return best && { node: best, needRerender };
}

async function highlightNode(node?: INode) {
  active = node;
  await mm.setHighlight(node);
  if (!node) return;
  await mm[
    activeNodeOptions.placement === 'center' ? 'centerNode' : 'ensureVisible'
  ](node, {
    bottom: 80,
  });
}
