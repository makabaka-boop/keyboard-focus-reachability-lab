import type { ActionKind, Graph } from '../src/lib/focus';
import { edgeStatus, encode } from '../src/lib/focus';

// 独立参考实现：与产品代码 analyze 不同的数据结构与搜索组织方式
// （Map/Set + 迭代固定点），只共用状态转移原语 edgeStatus。
export interface ReferenceResult {
  path: ActionKind[] | null;
  trap: ActionKind[] | null;
  reachable: Set<number>;
  winning: Set<number>;
}

export function referenceAnalyze(graph: Graph): ReferenceResult {
  const N = graph.nodes.length;
  const S = 1 << graph.switches.length;
  const rank: ActionKind[] = [0, 1, 2];
  const start = encode(graph.entry, 0);

  const succ = new Map<number, [number, ActionKind][]>();
  for (let focus = 0; focus < N; focus++) {
    for (let bits = 0; bits < S; bits++) {
      const s = encode(focus, bits);
      const out: [number, ActionKind][] = [];
      for (const kind of rank) {
        const e = edgeStatus(graph, focus, bits, kind);
        if (e.reason === 'ok') out.push([encode(e.target, e.nextBits), kind]);
      }
      succ.set(s, out);
    }
  }

  // 独立前向 BFS（Map 记录父节点与动作），裁决顺序同样是 Tab、Shift+Tab、激活。
  const parent = new Map<number, { p: number; kind: ActionKind }>();
  parent.set(start, { p: -1, kind: 0 });
  const fifo = [start];
  for (let i = 0; i < fifo.length; i++) {
    const s = fifo[i];
    for (const [ns, kind] of succ.get(s)!) {
      if (!parent.has(ns)) {
        parent.set(ns, { p: s, kind });
        fifo.push(ns);
      }
    }
  }
  const reachable = new Set(fifo);

  const goalStates = fifo.filter((s) => (s & 0xff) === graph.target);
  let path: ActionKind[] | null = null;
  if (goalStates.length > 0) {
    // BFS 按序入队，第一个目标即字典序最短；为稳妥起见取全部目标中序列字典序最小。
    const candidates: ActionKind[][] = [];
    for (const g of goalStates) {
      const seq: ActionKind[] = [];
      let cur = g;
      while (cur !== start) {
        const pr = parent.get(cur)!;
        seq.unshift(pr.kind);
        cur = pr.p;
      }
      candidates.push(seq);
    }
    candidates.sort(compareSeq);
    path = candidates[0];
  }

  // 独立“必胜”计算：W = 目标状态 ∪ 前驱(W)，迭代至不动点。
  const winning = new Set<number>();
  for (let bits = 0; bits < S; bits++) winning.add((bits << 8) | graph.target);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [s, out] of succ) {
      if (!winning.has(s)) {
        if (out.some(([ns]) => winning.has(ns))) {
          winning.add(s);
          changed = true;
        }
      }
    }
  }

  // 独立陷阱 BFS：从初始状态找首个非必胜可达状态。
  let trap: ActionKind[] | null = null;
  if (!winning.has(start)) {
    trap = [];
  } else {
    const tp = new Map<number, { p: number; kind: ActionKind }>();
    tp.set(start, { p: -1, kind: 0 });
    const tq = [start];
    outer: for (let i = 0; i < tq.length; i++) {
      const s = tq[i];
      for (const [ns, kind] of succ.get(s)!) {
        if (tp.has(ns)) continue;
        tp.set(ns, { p: s, kind });
        if (!winning.has(ns)) {
          const seq: ActionKind[] = [];
          let cur = ns;
          while (cur !== start) {
            const pr = tp.get(cur)!;
            seq.unshift(pr.kind);
            cur = pr.p;
          }
          trap = seq;
          break outer;
        }
        tq.push(ns);
      }
    }
  }

  return { path, trap, reachable, winning };
}

function compareSeq(a: ActionKind[], b: ActionKind[]): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
