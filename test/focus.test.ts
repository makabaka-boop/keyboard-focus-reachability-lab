import { describe, it, expect } from 'vitest';
import type { ActionKind, GraphDecl } from '../src/lib/focus';
import {
  ACTION_LABEL,
  analyze,
  commitImport,
  edgeStatus,
  encode,
  isVisible,
  validateGraph
} from '../src/lib/focus';
import { SAMPLE_GRAPH } from '../src/lib/sample';
import { referenceAnalyze } from './reference';

function parse(decl: GraphDecl) {
  const r = validateGraph(decl);
  if (!r.ok || !r.graph) throw new Error(r.errors.join('; '));
  return r.graph;
}

function seqNames(seq: ActionKind[] | null): string {
  return seq === null ? '∅' : seq.map((k) => ACTION_LABEL[k]).join(' → ');
}

describe('示例图：切换后节点消失 + 最短路径 + 陷阱', () => {
  const graph = parse(SAMPLE_GRAPH);

  it('B 的激活翻转电源后目标（B 自身）消失，是失效边', () => {
    // bits=1（电源开），焦点 B；activate 翻转开关 0 后 B 不可见
    const e = edgeStatus(graph, 1, 1, 2);
    expect(e.reason).toBe('target-hidden-after-toggle');
    expect(e.toggled).toBe(0);
    expect(e.nextBits).toBe(0);
    expect(isVisible(graph.nodes[1], 0)).toBe(false);
  });

  it('C 想激活直达隐藏的 B：目标当前隐藏，不可走', () => {
    const e = edgeStatus(graph, 2, 0, 2);
    expect(e.reason).toBe('target-hidden');
  });

  it('最短路径为 激活 → Tab → Tab', () => {
    const r = analyze(graph);
    expect(r.path).toEqual([2, 0, 0]);
    expect(r.goalReachable).toBe(true);
  });

  it('最短陷阱前缀为单键 Shift+Tab', () => {
    const r = analyze(graph);
    expect(r.trap).toEqual([1]);
    // 走一遍陷阱前缀后确实再无法到达目标
    const e = edgeStatus(graph, graph.entry, 0, 1);
    expect(e.reason).toBe('ok');
    const s = encode(e.target, e.nextBits);
    expect(r.isWinning(s)).toBe(false);
    expect(r.isReachable(s)).toBe(true);
  });

  it('失效边被枚举用于界面高亮', () => {
    const r = analyze(graph);
    const reasons = r.invalidEdges.map((e) => e.reason);
    expect(reasons).toContain('target-hidden-after-toggle');
    expect(reasons).toContain('target-hidden');
  });
});

describe('翻转后“新出现”的节点：先翻转再判定，且翻转的边不算失效', () => {
  const decl: GraphDecl = {
    switches: [{ id: 0, label: 'p' }],
    nodes: [
      {
        id: 'E',
        activate: { target: null, toggle: 0 }, // 停留并打开 p
        tab: { target: 'X' } // X 隐藏 → 失效
      },
      { id: 'X', visible: [{ switch: 0, on: true }], tab: { target: 'G' } },
      { id: 'G', visible: [{ switch: 0, on: true }] }
    ],
    entry: 'E',
    target: 'G'
  };
  const graph = parse(decl);

  it('激活翻转后 E 仍可见（无可见条件），边合法', () => {
    const e = edgeStatus(graph, 0, 0, 2);
    expect(e.reason).toBe('ok');
    expect(e.target).toBe(0);
    expect(e.nextBits).toBe(1);
  });

  it('路径为 激活 → Tab → Tab', () => {
    expect(analyze(graph).path).toEqual([2, 0, 0]);
  });

  it('X 关闭开关时的自翻转边失效（切换后节点消失）', () => {
    // 给 X 加一个会关掉 p 的激活边
    const g2 = parse({
      ...decl,
      nodes: [
        decl.nodes[0],
        { ...decl.nodes[1], activate: { target: 'X', toggle: 0 } },
        decl.nodes[2]
      ]
    });
    const e = edgeStatus(g2, 1, 1, 2);
    expect(e.reason).toBe('target-hidden-after-toggle');
  });
});

describe('不可达目标', () => {
  it('没有任何路径通向目标时 path 为 null，初始状态进入陷阱 []', () => {
    const graph = parse({
      switches: [],
      nodes: [
        { id: 'E', tab: { target: 'D' } },
        { id: 'D' },
        { id: 'G' }
      ],
      entry: 'E',
      target: 'G'
    });
    const r = analyze(graph);
    expect(r.path).toBeNull();
    expect(r.trap).toEqual([]);
    expect(r.isWinning(r.startState)).toBe(false);
  });
});

describe('同长度裁决顺序 Tab → Shift+Tab → 激活', () => {
  it('长度相同的两条路径选择以 Tab 开头的一条', () => {
    const graph = parse({
      switches: [],
      nodes: [
        {
          id: 'E',
          tab: { target: 'X1' },
          shiftTab: { target: 'Y1' },
          activate: { target: 'Z1' }
        },
        { id: 'X1', tab: { target: 'G' } },
        { id: 'Y1', tab: { target: 'G' } },
        { id: 'Z1', tab: { target: 'G' } },
        { id: 'G' }
      ],
      entry: 'E',
      target: 'G'
    });
    expect(analyze(graph).path).toEqual([0, 0]);
  });

  it('同长度的两个陷阱前缀选择按裁决顺序最先遇到的（Shift+Tab 早于激活）', () => {
    const graph = parse({
      switches: [],
      nodes: [
        {
          id: 'E',
          tab: { target: 'G' }, // 长度 1 直达目标
          shiftTab: { target: 'L' }, // 长度 1 陷阱
          activate: { target: 'M' } // 长度 1 陷阱
        },
        { id: 'G' },
        { id: 'L' },
        { id: 'M' }
      ],
      entry: 'E',
      target: 'G'
    });
    // 初始必胜（Tab 直达目标），最短陷阱前缀取 Shift+Tab 而非激活
    expect(analyze(graph).trap).toEqual([1]);
  });
});

describe('状态空间稍大时的计数与多开关合取', () => {
  it('2 开关 4 节点状态总数 16，入口可见', () => {
    const graph = parse({
      switches: [
        { id: 0 },
        { id: 1 }
      ],
      nodes: [
        {
          id: 'E',
          activate: { target: null, toggle: 0 },
          tab: { target: 'B' }
        },
        {
          id: 'B',
          visible: [
            { switch: 0, on: true },
            { switch: 1, on: false }
          ],
          activate: { target: 'B', toggle: 1 }
        },
        {
          id: 'C',
          visible: [
            { switch: 0, on: true },
            { switch: 1, on: true }
          ]
        },
        { id: 'G' }
      ],
      entry: 'E',
      target: 'G'
    });
    const r = analyze(graph);
    expect(r.totalStates).toBe(16);
    expect(r.path).toBeNull();
    // B 激活翻转开关 1 后 B 自身消失
    const e = edgeStatus(graph, 1, 1, 2);
    expect(e.reason).toBe('target-hidden-after-toggle');
  });
});

describe('导入校验：非法导入不产出图', () => {
  it('拒绝各种非法输入', () => {
    const bad: [string, unknown][] = [
      ['不是对象', null],
      ['nodes 缺失', { switches: [], entry: 'A', target: 'B' }],
      ['节点少于 2', { nodes: [{ id: 'A' }], entry: 'A', target: 'A' }],
      ['节点超过 40', {
        nodes: Array.from({ length: 41 }, (_, i) => ({ id: `n${i}` })),
        entry: 'n0',
        target: 'n1'
      }],
      ['节点 id 重复', { nodes: [{ id: 'A' }, { id: 'A' }], entry: 'A', target: 'A' }],
      ['开关超过 8', {
        switches: [0, 1, 2, 3, 4, 5, 6, 7, 0].map((id) => ({ id })),
        nodes: [{ id: 'A' }, { id: 'B' }],
        entry: 'A',
        target: 'B'
      }],
      ['开关 id 越界', {
        switches: [{ id: 8 }],
        nodes: [{ id: 'A' }, { id: 'B' }],
        entry: 'A',
        target: 'B'
      }],
      ['入口目标相同', { nodes: [{ id: 'A' }, { id: 'B' }], entry: 'A', target: 'A' }],
      ['入口不存在', { nodes: [{ id: 'A' }, { id: 'B' }], entry: 'X', target: 'B' }],
      ['动作引用未知节点', {
        nodes: [{ id: 'A', tab: { target: 'X' } }, { id: 'B' }],
        entry: 'A',
        target: 'B'
      }],
      ['toggle 引用未知开关', {
        nodes: [{ id: 'A', activate: { target: null, toggle: 2 } }, { id: 'B' }],
        entry: 'A',
        target: 'B'
      }],
      ['可见条件引用未知开关', {
        nodes: [{ id: 'A' }, { id: 'B', visible: [{ switch: 0, on: true }] }],
        entry: 'A',
        target: 'B'
      }],
      ['on 非布尔', {
        switches: [{ id: 0 }],
        nodes: [{ id: 'A' }, { id: 'B', visible: [{ switch: 0, on: 'yes' }] }],
        entry: 'A',
        target: 'B'
      }],
      ['入口初始不可见', {
        switches: [{ id: 0 }],
        nodes: [
          { id: 'A', visible: [{ switch: 0, on: true }] },
          { id: 'B' }
        ],
        entry: 'A',
        target: 'B'
      }],
      ['Tab 上不允许翻转开关', {
        switches: [{ id: 0 }],
        nodes: [
          { id: 'A', tab: { target: 'B', toggle: 0 } },
          { id: 'B' }
        ],
        entry: 'A',
        target: 'B'
      }],
      ['Shift+Tab 上不允许翻转开关', {
        switches: [{ id: 0 }],
        nodes: [
          { id: 'A', shiftTab: { target: 'B', toggle: 0 } },
          { id: 'B' }
        ],
        entry: 'A',
        target: 'B'
      }]
    ];
    for (const [name, input] of bad) {
      const r = validateGraph(input);
      expect(r.ok, name).toBe(false);
      expect(r.errors.length, name).toBeGreaterThan(0);
      expect(r.graph, name).toBeUndefined();
    }
  });

  it('JSON 文本解析失败也不产出图', () => {
    const r = commitImport('{ not json ');
    expect(r.ok).toBe(false);
    expect(r.graph).toBeUndefined();
  });

  it('合法导入接受 2..40 节点、0..8 开关且未知字段被容忍', () => {
    const r = validateGraph({
      switches: [],
      extra: 123,
      nodes: [
        { id: 'A', note: 'x' },
        { id: 'B' }
      ],
      entry: 'A',
      target: 'B'
    });
    expect(r.ok).toBe(true);
    expect(r.graph!.nodes).toHaveLength(2);
  });
});

describe('非法导入不覆盖当前图（接缝语义）', () => {
  it('调用方保留旧图：坏文本被拒绝，好文本产生新图', () => {
    const current = parse(SAMPLE_GRAPH);
    const bad = commitImport('{"nodes": []}');
    expect(bad.ok).toBe(false);
    // 旧图仍然可分析，未被覆盖
    expect(analyze(current).path).toEqual([2, 0, 0]);
    const good = commitImport(JSON.stringify({
      switches: [],
      nodes: [{ id: 'A' }, { id: 'B' }],
      entry: 'A',
      target: 'B'
    }));
    expect(good.ok).toBe(true);
    expect(good.graph!.nodes[0].id).toBe('A');
  });
});

// --- 随机图对拍 -------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomValidDecl(rand: () => number): GraphDecl {
  const swCount = 1 + Math.floor(rand() * 4);
  const nCount = 2 + Math.floor(rand() * 7);
  const switches = Array.from({ length: swCount }, (_, i) => ({ id: i }));
  const ids = Array.from({ length: nCount }, (_, i) => `n${i}`);

  const condFor = (i: number) => {
    // 入口（下标 0）在 bits=0 必须可见，所以不给它“开”条件。
    const used = new Set<number>();
    const cond: { switch: number; on: boolean }[] = [];
    const terms = Math.floor(rand() * (swCount + 1));
    for (let k = 0; k < terms; k++) {
      const sid = Math.floor(rand() * swCount);
      if (used.has(sid)) continue;
      used.add(sid);
      const on = i === 0 ? false : rand() < 0.5;
      cond.push({ switch: sid, on });
    }
    return cond;
  };

  const nodes = ids.map((id, i) => {
    const node: GraphDecl['nodes'][number] = { id };
    const cond = condFor(i);
    if (cond.length) node.visible = cond;
    for (const key of ['tab', 'shiftTab', 'activate'] as const) {
      if (rand() < 0.8) {
        const target = rand() < 0.25 ? null : ids[Math.floor(rand() * nCount)];
        const toggle =
          key === 'activate' && rand() < 0.4
            ? Math.floor(rand() * swCount)
            : null;
        node[key] = { target, toggle };
      }
    }
    return node;
  });

  // 入口取下标 0，目标取另一个下标。
  const targetIdx = 1 + Math.floor(rand() * (nCount - 1));
  return { switches, nodes, entry: ids[0], target: ids[targetIdx] };
}

describe('随机图对拍：产品 BFS 与独立参考实现一致', () => {
  const cases = 400;
  let accepted = 0;

  for (let seed = 1; seed <= cases; seed++) {
    const rand = mulberry32(seed * 7919 + 13);
    const decl = randomValidDecl(rand);
    const vr = validateGraph(decl);
    if (!vr.ok || !vr.graph) continue;
    accepted++;
    const graph = vr.graph;
    const got = analyze(graph);
    const ref = referenceAnalyze(graph);

    it(`seed=${seed} 路径一致：${seqNames(got.path)}`, () => {
      expect(got.path).toEqual(ref.path);
    });
    it(`seed=${seed} 陷阱一致：${seqNames(got.trap)}`, () => {
      expect(got.trap).toEqual(ref.trap);
    });
    it(`seed=${seed} 可达/必胜集合一致`, () => {
      expect(got.reachableStates).toBe(ref.reachable.size);
      let win = 0;
      for (const s of ref.reachable) {
        expect(got.isReachable(s)).toBe(true);
        if (ref.winning.has(s)) win++;
      }
      expect(got.winningStates).toBe(win);
      for (const s of ref.reachable) {
        expect(got.isWinning(s)).toBe(ref.winning.has(s));
      }
    });
  }

  it(`随机用例被大量接受（实际 ${accepted}/${cases}）`, () => {
    expect(accepted).toBeGreaterThan(300);
  });
});

describe('最大规模性能与正确性（40 节点 × 8 开关 = 10240 状态）', () => {
  it('全连接随机图在毫秒级完成且与参考一致', () => {
    const rand = mulberry32(20240925);
    const swCount = 8;
    const nCount = 40;
    const ids = Array.from({ length: nCount }, (_, i) => `n${i}`);
    const nodes = ids.map((id, i) => ({
      id,
      // 入口初始必须可见
      ...(i === 0
        ? {}
        : { visible: [{ switch: Math.floor(rand() * swCount), on: rand() < 0.5 }] }),
      tab: { target: ids[Math.floor(rand() * nCount)], toggle: null },
      shiftTab: { target: ids[Math.floor(rand() * nCount)], toggle: null },
      activate: {
        target: rand() < 0.3 ? null : ids[Math.floor(rand() * nCount)],
        toggle: rand() < 0.5 ? Math.floor(rand() * swCount) : null
      }
    }));
    const decl: GraphDecl = {
      switches: Array.from({ length: swCount }, (_, i) => ({ id: i })),
      nodes,
      entry: 'n0',
      target: 'n39'
    };
    const graph = parse(decl);
    const t0 = Date.now();
    const got = analyze(graph);
    const ms = Date.now() - t0;
    const ref = referenceAnalyze(graph);
    expect(got.totalStates).toBe(10240);
    expect(got.path).toEqual(ref.path);
    expect(got.trap).toEqual(ref.trap);
    expect(ms).toBeLessThan(1000);
  });
});
