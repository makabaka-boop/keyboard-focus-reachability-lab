// SSR 冒烟：不依赖浏览器，把 Svelte 组件做 TS 预处理后以 SSR 模式编译，
// 用最小 CJS 加载器渲染 NodeCard，并断言示例节点的动作/条件文案可见。
// App.svelte 仅验证可成功完成 SSR 编译（完整渲染由 dev/build 管线保证）。
import { describe, it, expect } from 'vitest';
import { compile } from 'svelte/compiler';
import { transformSync } from 'esbuild';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SAMPLE_GRAPH } from '../src/lib/sample';
import { validateGraph, encode } from '../src/lib/focus';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 用 TS 官方转译器擦类型而不做树摇。转译器会省略“脚本中未以值位置使用”
// 的命名导入——这些标识符可能只在 Svelte 模板中使用，因此先注入 void 引用。
function transpileScript(code: string, moduleKind: ts.ModuleKind): string {
  const imported: string[] = [];
  const namedRe = /import\s+(type\s+)?\{([^}]+)\}\s+from/g;
  let m: RegExpExecArray | null;
  while ((m = namedRe.exec(code))) {
    if (m[1]) continue; // 整组为 type-only 导入，擦除后不应保留
    for (const part of m[2].split(',')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('type ')) continue; // 单个 `type X` 说明符
      const name = trimmed.split(/\s+as\s+/)[0]?.trim();
      if (name) imported.push(name);
    }
  }
  // 默认导入（组件互导会用到）：import NodeCard from '...' 或 import X, {..} from '...'
  const defaultRe = /import\s+([A-Za-z_$][\w$]*)\s*(?:,|\s+from)/g;
  while ((m = defaultRe.exec(code))) imported.push(m[1]);
  const preserve = imported.length ? `\n;${imported.map((n) => `void ${n};`).join('')}\n` : '';
  return ts.transpileModule(code + preserve, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: moduleKind,
      isolatedModules: true,
      esModuleInterop: true
    }
  }).outputText;
}

function preprocessComponent(source: string): string {
  return source
    .replace(/<script lang="ts">([\s\S]*?)<\/script>/g, (_m, code) => {
      return `<script>${transpileScript(code, ts.ModuleKind.ESNext)}</script>`;
    })
    .replace(/<script context="module" lang="ts">([\s\S]*?)<\/script>/g, (_m, code) => {
      return `<script context="module">${transpileScript(code, ts.ModuleKind.ESNext)}</script>`;
    });
}

function compileSSR(rel: string) {
  const absPath = join(root, rel);
  const source = preprocessComponent(readFileSync(absPath, 'utf-8'));
  return compile(source, { filename: absPath, generate: 'ssr' });
}

const cache = new Map<string, Record<string, unknown>>();
const tsCache = new Map<string, Record<string, unknown>>();

function makeRequire(importerAbs: string, rootRequire: NodeRequire): (spec: string) => unknown {
  const localRequire = (spec: string): unknown => {
    if (spec.startsWith('.')) {
      const base = join(dirname(importerAbs), spec);
      if (spec.endsWith('.svelte')) return loadSvelte(base, rootRequire);
      if (spec.endsWith('.css')) return {};
      for (const cand of spec.endsWith('.ts')
        ? [base]
        : [`${base}.ts`, join(base, 'index.ts')]) {
        let exists = false;
        try {
          readFileSync(cand);
          exists = true;
        } catch {
          // 文件不存在，尝试下一候选
        }
        if (exists) return loadTsCjs(cand, rootRequire);
      }
      throw new Error(`无法解析 ${spec}（自 ${importerAbs}）`);
    }
    return rootRequire(spec);
  };
  return localRequire;
}

function loadTsCjs(absPath: string, rootRequire: NodeRequire): Record<string, unknown> {
  const hit = tsCache.get(absPath);
  if (hit) return hit;
  const code = transpileScript(readFileSync(absPath, 'utf-8'), ts.ModuleKind.CommonJS);
  const mod = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', 'require', code)(
    mod,
    mod.exports,
    makeRequire(absPath, rootRequire)
  );
  tsCache.set(absPath, mod.exports);
  return mod.exports;
}

function loadSvelte(absPath: string, rootRequire: NodeRequire): Record<string, unknown> {
  const hit = cache.get(absPath);
  if (hit) return hit;
  const source = preprocessComponent(readFileSync(absPath, 'utf-8'));
  const compiled = compile(source, { filename: absPath, generate: 'ssr' });
  const { code: cjs } = transformSync(compiled.js.code, {
    loader: 'js',
    format: 'cjs',
    target: 'es2022'
  });

  const mod = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', 'require', cjs)(
    mod,
    mod.exports,
    makeRequire(absPath, rootRequire)
  );
  cache.set(absPath, mod.exports);
  return mod.exports;
}

describe('NodeCard SSR 渲染冒烟', () => {
  const graph = validateGraph(SAMPLE_GRAPH).graph!;

  it('示例入口节点渲染出三个动作、翻转说明与入口标签', () => {
    const rootRequire = createRequire(import.meta.url);
    const exportsMap = loadSvelte(join(root, 'src', 'lib', 'NodeCard.svelte'), rootRequire);
    const NodeCard = (exportsMap.default ?? exportsMap) as {
      render: (props: Record<string, unknown>) => { html: string };
    };

    const html = NodeCard.render({
      graph,
      index: 0,
      bits: 0,
      focused: true,
      plannedKind: 2,
      isEntry: true,
      isTarget: false,
      onAction: () => {}
    }).html;

    expect(html).toContain('入口表单');
    expect(html).toContain('入口');
    expect(html).toContain('Tab');
    expect(html).toContain('Shift+Tab');
    expect(html).toContain('激活');
    expect(html).toContain('翻转'); // 激活翻转电源
    expect(html).toContain('电源');
  });

  it('隐藏节点（B 在 bits=0）渲染出失效原因', () => {
    const rootRequire = createRequire(import.meta.url);
    const exportsMap = loadSvelte(join(root, 'src', 'lib', 'NodeCard.svelte'), rootRequire);
    const NodeCard = (exportsMap.default ?? exportsMap) as {
      render: (props: Record<string, unknown>) => { html: string };
    };
    const html = NodeCard.render({
      graph,
      index: 1,
      bits: 0,
      focused: false,
      plannedKind: null,
      isEntry: false,
      isTarget: false,
      onAction: () => {}
    }).html;
    expect(html).toContain('条件控件 B');
    expect(html).toContain('电源 = 开');
  });

  it('状态编码示例：入口 + bits=0 即初始状态', () => {
    expect(encode(graph.entry, 0)).toBe(graph.entry);
  });
});

describe('App 服务端完整渲染冒烟', () => {
  it('示例图初始页面包含路径、陷阱、回放与失效边文案', () => {
    const rootRequire = createRequire(import.meta.url);
    const exportsMap = loadSvelte(join(root, 'src', 'App.svelte'), rootRequire);
    const App = (exportsMap.default ?? exportsMap) as {
      render: () => { html: string };
    };
    const { html } = App.render();
    for (const text of [
      '焦点流程实验页',
      '入口表单',
      '目标提交按钮',
      '逐键回放',
      '失效边高亮',
      '翻转开关后目标节点消失',
      '最短路径'
    ]) {
      expect(html, `页面应包含「${text}」`).toContain(text);
    }
  });
});

describe('App SSR 可编译性', () => {
  it('App.svelte 能在 SSR 模式下编译通过', () => {
    const out = compileSSR('src/App.svelte');
    expect(out.js.code).toContain('render');
  });
});
