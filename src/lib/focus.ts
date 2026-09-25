// 焦点流程核心领域逻辑（纯函数，不依赖 DOM / Svelte）。
//
// 模型：
//   - 开关位集 bits：第 k 位为 1 表示开关 k 处于“开”，初始全部为 0。
//   - 节点可见条件：若干“开关必须为某值”的合取。
//   - 状态 (focus, bits)：focus 为当前焦点节点下标；只有可见节点可承载焦点。
//   - 动作：Tab(0)、Shift+Tab(1)、激活(2)。激活可翻转一个开关。
//   - 动作合法：目标节点在“动作后的开关位集”下可见（翻转先发生，再判定目标）。

export type ActionKind = 0 | 1 | 2;

export const ACTIONS: readonly ActionKind[] = [0, 1, 2];

export const ACTION_LABEL: Record<ActionKind, string> = {
  0: 'Tab',
  1: 'Shift+Tab',
  2: '激活'
};

// 同长度最短路径的裁决顺序：Tab、Shift+Tab、激活。
export const ACTION_RANK: readonly ActionKind[] = [0, 1, 2];

export interface SwitchDecl {
  id: number;
  label?: string;
}

export interface Conjunct {
  switch: number;
  on: boolean;
}

export interface ActionDecl {
  // 缺省时目标为节点自身（激活留在原处是常见模式）。
  target?: string | null;
  // 翻转的开关。按模型只有 activate 允许声明；tab/shiftTab 上声明会被校验拒绝。
  toggle?: number | null;
}

export interface NodeDecl {
  id: string;
  label?: string;
  visible?: Conjunct[];
  tab?: ActionDecl | null;
  shiftTab?: ActionDecl | null;
  activate?: ActionDecl | null;
}

export interface GraphDecl {
  switches?: SwitchDecl[];
  nodes: NodeDecl[];
  entry: string;
  target: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface Graph {
  switches: SwitchDecl[];
  nodes: NodeDecl[];
  entry: number;
  target: number;
}

// --- 导入校验 ---------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(errors: string[], at: string, msg: string): void {
  errors.push(`${at}: ${msg}`);
}

/**
 * 校验并规范化导入声明。
 * 校验规则（任一不满足即拒绝，拒绝时不返回图——由调用方保证不覆盖当前图）：
 *   - 顶层为对象，nodes 为 2..40 个对象，id 为非空且唯一的字符串；
 *   - switches 为 0..8 个对象，id 为 0..7 的唯一整数；
 *   - entry / target 必须引用存在的节点且二者不同；
 *   - 入口在所有开关为关（bits=0）时必须可见；
 *   - 每个合取项引用存在的开关，on 必须为布尔；
 *   - 每个动作的 target 必须引用存在的节点，toggle 必须引用存在的开关。
 */
export function validateGraph(input: unknown): ValidationResult & { graph?: Graph } {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ['顶层必须是一个 JSON 对象'] };
  }

  const rawSwitches = input.switches ?? [];
  if (!Array.isArray(rawSwitches)) {
    fail(errors, 'switches', '必须是数组');
  }
  if (!Array.isArray(input.nodes)) {
    fail(errors, 'nodes', '必须是数组');
  }
  if (typeof input.entry !== 'string') {
    fail(errors, 'entry', '必须是节点 id 字符串');
  }
  if (typeof input.target !== 'string') {
    fail(errors, 'target', '必须是节点 id 字符串');
  }

  const nodes: NodeDecl[] = [];
  const nodeIds = new Set<string>();
  const switchIds = new Set<number>();
  const switches: SwitchDecl[] = [];

  if (Array.isArray(rawSwitches)) {
    if (rawSwitches.length > 8) {
      fail(errors, 'switches', `开关最多 8 个，实际 ${rawSwitches.length} 个`);
    }
    rawSwitches.forEach((s, i) => {
      const at = `switches[${i}]`;
      if (!isPlainObject(s)) {
        fail(errors, at, '必须是对象');
        return;
      }
      if (!Number.isInteger(s.id)) {
        fail(errors, at, 'id 必须是 0..7 的整数');
        return;
      }
      const id = s.id as number;
      if (id < 0 || id > 7) {
        fail(errors, at, `id ${id} 超出 0..7 范围`);
        return;
      }
      if (switchIds.has(id)) {
        fail(errors, at, `开关 id ${id} 重复`);
        return;
      }
      if (s.label !== undefined && typeof s.label !== 'string') {
        fail(errors, at, 'label 必须是字符串');
      }
      switchIds.add(id);
      switches.push({ id, label: typeof s.label === 'string' ? s.label : undefined });
    });
  }

  const parseAction = (raw: unknown, at: string, canToggle: boolean): ActionDecl | null => {
    if (raw === null || raw === undefined) return null;
    if (!isPlainObject(raw)) {
      fail(errors, at, '必须是对象或 null');
      return null;
    }
    const action: ActionDecl = {};
    if (raw.target === null) {
      action.target = null;
    } else if (raw.target === undefined) {
      action.target = undefined;
    } else if (typeof raw.target === 'string') {
      action.target = raw.target;
    } else {
      fail(errors, `${at}.target`, '必须是节点 id 字符串或 null');
    }
    if (raw.toggle !== undefined && raw.toggle !== null && !canToggle) {
      fail(errors, `${at}.toggle`, '只有“激活(activate)”动作可以翻转开关');
    }
    if (raw.toggle === null || raw.toggle === undefined) {
      action.toggle = raw.toggle === null ? null : undefined;
    } else if (Number.isInteger(raw.toggle)) {
      const t = raw.toggle as number;
      if (!switchIds.has(t)) {
        fail(errors, `${at}.toggle`, `引用了未声明的开关 ${t}`);
      }
      action.toggle = t;
    } else {
      fail(errors, `${at}.toggle`, '必须是开关 id 整数或 null');
    }
    return action;
  };

  if (Array.isArray(input.nodes)) {
    if (input.nodes.length < 2 || input.nodes.length > 40) {
      fail(errors, 'nodes', `节点数量必须在 2..40 之间，实际 ${input.nodes.length} 个`);
    }
    input.nodes.forEach((n, i) => {
      const at = `nodes[${i}]`;
      if (!isPlainObject(n)) {
        fail(errors, at, '必须是对象');
        return;
      }
      if (typeof n.id !== 'string' || n.id.trim() === '') {
        fail(errors, at, 'id 必须是非空字符串');
      } else if (nodeIds.has(n.id)) {
        fail(errors, at, `节点 id "${n.id}" 重复`);
      } else {
        nodeIds.add(n.id);
      }
      if (n.label !== undefined && typeof n.label !== 'string') {
        fail(errors, `${at}.label`, '必须是字符串');
      }
      if (n.visible !== undefined && !Array.isArray(n.visible)) {
        fail(errors, `${at}.visible`, '必须是合取项数组');
      }
      const cond: Conjunct[] = [];
      if (Array.isArray(n.visible)) {
        n.visible.forEach((c, j) => {
          const cat = `${at}.visible[${j}]`;
          if (!isPlainObject(c)) {
            fail(errors, cat, '必须是对象');
            return;
          }
          if (!Number.isInteger(c.switch)) {
            fail(errors, cat, 'switch 必须是开关 id 整数');
            return;
          }
          if (typeof c.on !== 'boolean') {
            fail(errors, cat, 'on 必须是布尔值');
            return;
          }
          if (!switchIds.has(c.switch as number)) {
            fail(errors, cat, `引用了未声明的开关 ${c.switch}`);
            return;
          }
          cond.push({ switch: c.switch as number, on: c.on });
        });
      }
      const node: NodeDecl = {
        id: n.id as string,
        label: typeof n.label === 'string' ? n.label : undefined,
        visible: cond
      };
      (['tab', 'shiftTab', 'activate'] as const).forEach((key) => {
        if (n[key] !== undefined) {
          const parsed = parseAction(n[key], `${at}.${key}`, key === 'activate');
          if (parsed) node[key] = parsed;
        }
      });
      nodes.push(node);
    });

    // 动作目标的存在性必须在全部 id 收集完后检查（允许前向引用）。
    nodes.forEach((node, i) => {
      (['tab', 'shiftTab', 'activate'] as const).forEach((key) => {
        const action = node[key];
        if (action && typeof action.target === 'string' && !nodeIds.has(action.target)) {
          fail(errors, `nodes[${i}].${key}.target`, `引用了不存在的节点 "${action.target}"`);
        }
      });
    });
  }

  let entry = -1;
  let target = -1;
  if (typeof input.entry === 'string') {
    const idx = nodes.findIndex((n) => n.id === input.entry);
    if (idx === -1) fail(errors, 'entry', `引用了不存在的节点 "${input.entry}"`);
    entry = idx;
  }
  if (typeof input.target === 'string') {
    const idx = nodes.findIndex((n) => n.id === input.target);
    if (idx === -1) fail(errors, 'target', `引用了不存在的节点 "${input.target}"`);
    target = idx;
  }
  if (entry !== -1 && target !== -1 && entry === target) {
    fail(errors, 'target', '入口与目标必须是不同的节点');
  }

  if (errors.length === 0 && entry !== -1) {
    if (!isVisible(nodes[entry], 0)) {
      fail(errors, 'entry', '入口节点在所有开关为关时不可见，初始状态无法获得焦点');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], graph: { switches, nodes, entry, target } };
}

/** 解析 JSON 文本并校验；非法导入返回错误信息且不产出图。 */
export function commitImport(text: string): ValidationResult & { graph?: Graph } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${(e as Error).message}`] };
  }
  return validateGraph(parsed);
}

// --- 状态与动作 -------------------------------------------------------------

/** 节点在给定开关位集下是否可见（可见条件为各开关值的合取）。 */
export function isVisible(node: NodeDecl, bits: number): boolean {
  const cond = node.visible;
  if (!cond) return true;
  for (const c of cond) {
    const has = ((bits >> c.switch) & 1) === 1;
    if (has !== c.on) return false;
  }
  return true;
}

export type EdgeReason =
  | 'ok'
  | 'no-action' // 该动作未定义
  | 'target-hidden' // 普通动作：目标当前不可见
  | 'target-hidden-after-toggle' // 激活翻转后目标（可能是新节点）消失
  | 'source-hidden'; // 当前焦点节点本身不可见（不应出现在合法状态中）

export interface EdgeResult {
  reason: EdgeReason;
  target: number;
  nextBits: number;
  toggled: number | null;
}

function resolveAction(node: NodeDecl, kind: ActionKind): ActionDecl | null {
  const raw =
    kind === 0 ? node.tab : kind === 1 ? node.shiftTab : node.activate;
  return raw === undefined ? null : raw;
}

/**
 * 评估从 (focus, bits) 出发的某条动作边。
 * 激活的翻转先于可见性判定：若翻转后目标隐藏，则该动作不可走。
 */
export function edgeStatus(
  graph: Graph,
  focus: number,
  bits: number,
  kind: ActionKind
): EdgeResult {
  const node = graph.nodes[focus];
  if (!node || !isVisible(node, bits)) {
    return { reason: 'source-hidden', target: focus, nextBits: bits, toggled: null };
  }
  const action = resolveAction(node, kind);
  if (!action) {
    return { reason: 'no-action', target: focus, nextBits: bits, toggled: null };
  }
  const target = action.target == null ? focus : graph.nodes.findIndex((n) => n.id === action.target);
  const toggled = action.toggle ?? null;
  const nextBits = toggled === null ? bits : bits ^ (1 << toggled);
  if (!isVisible(graph.nodes[target], nextBits)) {
    return {
      reason: toggled === null ? 'target-hidden' : 'target-hidden-after-toggle',
      target,
      nextBits,
      toggled
    };
  }
  return { reason: 'ok', target, nextBits, toggled };
}

// --- 状态搜索 ---------------------------------------------------------------

export interface InvalidEdge {
  from: number;
  bits: number;
  kind: ActionKind;
  reason: Exclude<EdgeReason, 'ok' | 'source-hidden'>;
  target: number;
  nextBits: number;
  toggled: number | null;
}

export interface AnalysisResult {
  startState: number;
  totalStates: number;
  reachableStates: number;
  /** 可达状态中能到达目标的状态数（含目标状态本身）。 */
  winningStates: number;
  /** 从初始状态到目标的最短动作序列；不可达为 null。 */
  path: ActionKind[] | null;
  /** 最短陷阱前缀：走到一个从入口可达却再无法到目标的状态；初始即困为 []。 */
  trap: ActionKind[] | null;
  /** 在初始可达范围内出现过的失效边（切换后节点消失等），供界面高亮。 */
  invalidEdges: InvalidEdge[];
  /** 目标状态是否本身可达的快速判定标志。 */
  goalReachable: boolean;
  isWinning(state: number): boolean;
  isReachable(state: number): boolean;
}

export const encode = (focus: number, bits: number): number => (bits << 8) | focus;
export const decodeFocus = (state: number): number => state & 0xff;
export const decodeBits = (state: number): number => state >> 8;

/**
 * 对状态空间 (focus, bits) 做搜索：
 *   1. 前向 BFS 求入口→目标最短序列（按动作裁决顺序扩展）；
 *   2. 从所有目标状态反向求“必胜状态”（存在合法动作即可，边由 edgeStatus 判定）；
 *   3. 从初始状态前向 BFS 求首个非必胜状态，即最短陷阱前缀；
 *   4. 枚举初始可达范围内的失效边。
 */
export function analyze(graph: Graph): AnalysisResult {
  const N = graph.nodes.length;
  const S = 1 << graph.switches.length;
  const totalStates = N * S;
  // 编码为 (bits << 8) | focus，数组按编码容量分配（上限 256*256 = 65536）。
  const cap = S << 8;
  const startState = encode(graph.entry, 0);

  // 逆邻接表：rev[s'] 列出所有经过某条合法动作后能到达 s' 的来源状态。
  // 反向固定点判定“存在一条出边即胜”，故只收录合法边。
  const rev: number[][] = Array.from({ length: cap }, () => [] as number[]);

  for (let bits = 0; bits < S; bits++) {
    for (let focus = 0; focus < N; focus++) {
      const s = encode(focus, bits);
      for (const kind of ACTIONS) {
        const e = edgeStatus(graph, focus, bits, kind);
        if (e.reason === 'ok') {
          rev[encode(e.target, e.nextBits)].push(s);
        }
      }
    }
  }

  // --- 1. 前向 BFS：初始 → 任一目标状态（跑完整张可达图，供 4 使用） ---
  const parent = new Int32Array(cap).fill(-2); // -2 未访问
  const parentKind = new Int8Array(cap).fill(-1);
  const queue: number[] = [startState];
  parent[startState] = -1;
  let head = 0;
  let goalState = -1;
  const reachable = new Uint8Array(cap);
  reachable[startState] = 1;

  // FIFO 且按 Tab、Shift+Tab、激活扩展，首个被发现的目标状态即对应
  // “最短且按动作顺序裁决”的序列。
  while (head < queue.length) {
    const s = queue[head++];
    const focus = decodeFocus(s);
    const bits = decodeBits(s);
    if (focus === graph.target && goalState === -1) goalState = s;
    for (const kind of ACTION_RANK) {
      const e = edgeStatus(graph, focus, bits, kind);
      if (e.reason !== 'ok') continue;
      const ns = encode(e.target, e.nextBits);
      if (parent[ns] === -2) {
        parent[ns] = s;
        parentKind[ns] = kind;
        reachable[ns] = 1;
        queue.push(ns);
      }
    }
  }
  const reachableStates = queue.length;

  let path: ActionKind[] | null = null;
  if (goalState !== -1) {
    path = [];
    let cur = goalState;
    while (cur !== startState) {
      path.unshift(parentKind[cur] as ActionKind);
      cur = parent[cur];
    }
  }

  // --- 2. 反向固定点：必胜状态（可到达某目标状态） ---
  const winning = new Uint8Array(cap);
  const winQueue: number[] = [];
  for (let bits = 0; bits < S; bits++) {
    const s = encode(graph.target, bits);
    if (!winning[s]) {
      winning[s] = 1;
      winQueue.push(s);
    }
  }
  let wHead = 0;
  while (wHead < winQueue.length) {
    const s = winQueue[wHead++];
    for (const p of rev[s]) {
      if (!winning[p]) {
        winning[p] = 1;
        winQueue.push(p);
      }
    }
  }

  // --- 3. 从初始出发找首个非必胜可达状态（最短陷阱前缀） ---
  let trap: ActionKind[] | null = null;
  if (!winning[startState]) {
    trap = [];
  } else {
    const tParent = new Int32Array(cap).fill(-2);
    const tKind = new Int8Array(cap).fill(-1);
    const tQueue: number[] = [startState];
    tParent[startState] = -1;
    let tHead = 0;
    let trapState = -1;
    while (tHead < tQueue.length) {
      const s = tQueue[tHead++];
      const focus = decodeFocus(s);
      const bits = decodeBits(s);
      for (const kind of ACTION_RANK) {
        const e = edgeStatus(graph, focus, bits, kind);
        if (e.reason !== 'ok') continue;
        const ns = encode(e.target, e.nextBits);
        if (tParent[ns] !== -2) continue;
        tParent[ns] = s;
        tKind[ns] = kind;
        if (!winning[ns]) {
          trapState = ns;
          break;
        }
        tQueue.push(ns);
      }
      if (trapState !== -1) break;
    }
    if (trapState !== -1) {
      trap = [];
      let cur = trapState;
      while (cur !== startState) {
        trap.unshift(tKind[cur] as ActionKind);
        cur = tParent[cur];
      }
    }
  }

  // --- 4. 枚举初始可达范围内的失效边（界面高亮用） ---
  const seen = new Set<string>();
  const invalidEdges: InvalidEdge[] = [];
  for (const s of queue) {
    const focus = decodeFocus(s);
    const bits = decodeBits(s);
    for (const kind of ACTION_RANK) {
      const e = edgeStatus(graph, focus, bits, kind);
      if (e.reason === 'target-hidden' || e.reason === 'target-hidden-after-toggle' || e.reason === 'no-action') {
        const key = `${s}:${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        invalidEdges.push({
          from: focus,
          bits,
          kind,
          reason: e.reason,
          target: e.target,
          nextBits: e.nextBits,
          toggled: e.toggled
        });
      }
    }
  }

  let winningStates = 0;
  for (const s of queue) if (winning[s]) winningStates++;

  return {
    startState,
    totalStates,
    reachableStates,
    winningStates,
    path,
    trap,
    invalidEdges,
    goalReachable: goalState !== -1,
    isWinning: (s: number) => winning[s] === 1,
    isReachable: (s: number) => reachable[s] === 1
  };
}
