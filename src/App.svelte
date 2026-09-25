<script lang="ts">
  import type { ActionKind, EdgeReason, Graph } from './lib/focus';
  import {
    ACTION_LABEL,
    analyze,
    commitImport,
    decodeBits,
    decodeFocus,
    edgeStatus,
    encode
  } from './lib/focus';
  import { SAMPLE_TEXT } from './lib/sample';
  import NodeCard from './lib/NodeCard.svelte';
  import { nodeLabelOf, switchLabelOf, REASON_TEXT } from './lib/format';

  const SAMPLE_TEXT_CONST = SAMPLE_TEXT;

  let importText = SAMPLE_TEXT_CONST;
  let importError: string[] | null = null;
  let graph: Graph = commitImport(SAMPLE_TEXT_CONST).graph!;
  let previousText = SAMPLE_TEXT_CONST;

  let witness: 'path' | 'trap' = 'path';
  let step = 0;
  let focus = graph.entry;
  let bits = 0;
  let playing = false;
  let history: { kind: ActionKind; from: number; bits: number }[] = [];

  $: result = analyze(graph);
  $: sequence = witness === 'path' ? result.path : result.trap;

  // 仅在“图对象本身”被替换时重置见证状态。
  let lastResetGraph: Graph | null = null;
  $: if (graph && lastResetGraph !== graph) {
    lastResetGraph = graph;
    resetView();
  }

  const currentState = () => encode(focus, bits);
  const winningNow = () => result.isWinning(currentState());

  function manualEdge(k: number) {
    return edgeStatus(graph, focus, bits, k as ActionKind);
  }

  function actionName(k: number): string {
    return ACTION_LABEL[k as ActionKind];
  }

  function toDecl(g: Graph) {
    return {
      switches: g.switches,
      nodes: g.nodes,
      entry: g.nodes[g.entry].id,
      target: g.nodes[g.target].id
    };
  }

  function adoptGraph(g: Graph, text: string) {
    previousText = JSON.stringify(toDecl(graph), null, 2);
    graph = g;
    importText = text;
    importError = null;
  }

  function doImport() {
    const r = commitImport(importText);
    if (!r.ok || !r.graph) {
      // 非法导入：只显示错误，不覆盖当前图。
      importError = r.errors;
      return;
    }
    adoptGraph(r.graph, JSON.stringify(toDecl(r.graph), null, 2));
  }

  function restorePrevious() {
    const r = commitImport(previousText);
    if (r.ok && r.graph) adoptGraph(r.graph, previousText);
  }

  function loadSample() {
    const r = commitImport(SAMPLE_TEXT_CONST);
    if (r.ok && r.graph) adoptGraph(r.graph, SAMPLE_TEXT_CONST);
  }

  function resetView() {
    focus = graph.entry;
    bits = 0;
    step = 0;
    history = [];
    playing = false;
  }

  function rebuildFrame(targetStep: number) {
    const seq = sequence ?? [];
    focus = graph.entry;
    bits = 0;
    history = [];
    for (let i = 0; i < targetStep && i < seq.length; i++) {
      const e = edgeStatus(graph, focus, bits, seq[i]);
      if (e.reason !== 'ok') break;
      history.push({ kind: seq[i], from: focus, bits });
      focus = e.target;
      bits = e.nextBits;
    }
    step = Math.min(targetStep, seq.length);
  }

  function selectWitness(mode: 'path' | 'trap') {
    witness = mode;
    stopPlay();
    rebuildFrame(0);
  }

  function goStep(delta: number) {
    const seq = sequence ?? [];
    const next = Math.max(0, Math.min(seq.length, step + delta));
    rebuildFrame(next);
  }

  function jumpStep(to: number) {
    stopPlay();
    rebuildFrame(to);
  }

  function walk(kindRaw: number) {
    const kind = kindRaw as ActionKind;
    const e = edgeStatus(graph, focus, bits, kind);
    if (e.reason !== 'ok') return;
    stopPlay();
    history.push({ kind, from: focus, bits });
    focus = e.target;
    bits = e.nextBits;
  }

  function back() {
    const h = history.pop();
    if (!h) return;
    stopPlay();
    focus = h.from;
    bits = h.bits;
  }

  // 自动逐键回放：独立计时器，状态变更或走到序列末端即停止。
  let timer: ReturnType<typeof setInterval> | null = null;
  function stopPlay() {
    playing = false;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }
  function togglePlay() {
    if (playing) {
      stopPlay();
      return;
    }
    if (sequence === null || step >= sequence.length) return;
    playing = true;
    timer = setInterval(() => {
      const seq = witness === 'path' ? result.path : result.trap;
      if (seq === null || step >= seq.length) {
        stopPlay();
        return;
      }
      goStep(step + 1);
      if (step >= seq.length) stopPlay();
    }, 700);
  }

  // 用函数延迟到模板渲染时求值：此时上面的反应式赋值（result/sequence）已执行。
  function plannedKindAt(): ActionKind | null {
    return sequence !== null && step < sequence.length && history.length === step
      ? sequence[step]
      : null;
  }

  const reasonOrder: EdgeReason[] = ['target-hidden-after-toggle', 'target-hidden', 'no-action'];

  function swOn(id: number): boolean {
    return ((bits >> id) & 1) === 1;
  }
</script>

<div class="page">
  <header class="topbar">
    <h1>焦点流程实验页</h1>
    <p class="subtitle">
      以（焦点节点 × 开关位集）为状态搜索最短按键序列，并定位“可达却再无法抵达目标”的最短陷阱前缀。
    </p>
  </header>

  <div class="status-bar"
       class:bar-good={winningNow()}
       class:bar-bad={!winningNow() && focus !== graph.target}>
    {#if focus === graph.target}
      ✅ 已到达目标 <strong>{nodeLabelOf(graph, graph.target)}</strong>
    {:else if winningNow()}
      ◎ 当前状态仍可抵达目标（{history.length} 步）
    {:else}
      ⚠ 焦点陷阱：该状态从入口可达，但目标再也无法抵达（{history.length} 步）
    {/if}
  </div>

  <main class="grid">
    <!-- 左：导入 -->
    <section class="panel panel-import">
      <h2>图导入（JSON）</h2>
      <textarea spellcheck="false" bind:value={importText} rows="18"></textarea>
      <div class="btn-row">
        <button type="button" class="primary" on:click={doImport}>导入并替换</button>
        <button type="button" on:click={restorePrevious} disabled={previousText === importText}>恢复上一版图</button>
        <button type="button" on:click={loadSample}>载入示例</button>
      </div>
      {#if importError}
        <div class="error-box">
          <strong>导入被拒绝，当前图未被覆盖：</strong>
          <ul>{#each importError as msg}<li>{msg}</li>{/each}</ul>
        </div>
      {/if}

      <h2>开关（共 {graph.switches.length} 个）</h2>
      <ul class="switches">
        {#each graph.switches as sw (sw.id)}
          <li class:on={swOn(sw.id)}>
            <span class="sw-dot"></span>
            {switchLabelOf(graph, sw.id)}
            <em>{swOn(sw.id) ? '开' : '关'}</em>
          </li>
        {:else}
          <li class="muted">（无开关）</li>
        {/each}
      </ul>
    </section>

    <!-- 中：节点画布 -->
    <section class="panel panel-canvas">
      <div class="canvas-head">
        <h2>节点（{graph.nodes.length}）</h2>
        <div class="manual">
          <span>手动按键（仅当前焦点节点可用）：</span>
          {#each [0, 1, 2] as k}
            <button
              type="button"
              class="key key-{k}"
              disabled={manualEdge(k).reason !== 'ok'}
              title={manualEdge(k).reason !== 'ok' ? REASON_TEXT[manualEdge(k).reason] : ''}
              on:click={() => walk(k)}
            >
              {actionName(k)}
            </button>
          {/each}
          <button type="button" class="ghost" on:click={back} disabled={history.length === 0}>↶ 退一步</button>
          <button type="button" class="ghost" on:click={resetView}>⟲ 重置</button>
        </div>
      </div>

      <div class="nodes">
        {#each graph.nodes as n, i (n.id)}
          <NodeCard
            {graph}
            index={i}
            {bits}
            focused={focus === i}
            plannedKind={focus === i ? plannedKindAt() : null}
            isEntry={graph.entry === i}
            isTarget={graph.target === i}
            onAction={walk}
          />
        {/each}
      </div>
    </section>

    <!-- 右：搜索结果与回放 -->
    <section class="panel panel-result">
      <h2>搜索结果</h2>
      <dl class="stats">
        <div><dt>状态总数</dt><dd>{result.totalStates}</dd></div>
        <div><dt>入口可达</dt><dd>{result.reachableStates}</dd></div>
        <div><dt>其中必胜</dt><dd>{result.winningStates}</dd></div>
      </dl>

      <div class="tabs">
        <button type="button" class:active={witness === 'path'} on:click={() => selectWitness('path')}>
          最短路径 {result.path === null ? '（不存在）' : `（${result.path.length} 键）`}
        </button>
        <button type="button" class:active={witness === 'trap'} on:click={() => selectWitness('trap')}>
          最短陷阱 {result.trap === null ? '（不存在）' : `（${result.trap.length} 键）`}
        </button>
      </div>

      {#if sequence === null}
        <p class="muted">
          {witness === 'path'
            ? '从初始状态无法到达目标：最短路径为空。'
            : '从入口可达的每个状态都能抵达目标，不存在陷阱前缀。'}
        </p>
      {:else}
        <ol class="seq">
          {#each sequence as kind, i (i)}
            <li class:done={i < step} class:current={i === step}>
              <button type="button" on:click={() => jumpStep(i)}>{i + 1}. {ACTION_LABEL[kind]}</button>
            </li>
          {/each}
          <li class="end" class:current={step === sequence.length}>
            <button type="button" on:click={() => jumpStep(sequence.length)}>
              {witness === 'path' ? '到达目标' : '进入陷阱'}
            </button>
          </li>
        </ol>
        <div class="player">
          <button type="button" class="ghost" on:click={() => goStep(-1)} disabled={step === 0}>上一键</button>
          <button type="button" class="primary" on:click={togglePlay}>
            {playing ? '暂停' : '逐键回放'}
          </button>
          <button type="button" class="ghost" on:click={() => goStep(1)} disabled={step === sequence.length}>下一键</button>
          <button type="button" class="ghost" on:click={() => jumpStep(0)}>复位</button>
        </div>
        <p class="muted">第 {step} / {sequence.length} 键 · 当前焦点 {nodeLabelOf(graph, focus)}</p>
      {/if}

      <h2>失效边高亮</h2>
      {#if result.invalidEdges.length === 0}
        <p class="muted">可达范围内没有失效边。</p>
      {:else}
        <ul class="dead-list">
          {#each reasonOrder as reason}
            {#each result.invalidEdges.filter((e) => e.reason === reason) as e (e.from + ':' + e.bits + ':' + e.kind)}
              <li class="dead dead-{e.reason}" class:dead-hot={e.from === focus && e.bits === bits}>
                <span class="dead-from">{nodeLabelOf(graph, e.from)}</span>
                <span class="dead-key">{ACTION_LABEL[e.kind]}</span>
                <span class="dead-why">✕ {REASON_TEXT[e.reason]}</span>
                <span class="dead-bits">位集 {e.bits.toString(2).padStart(graph.switches.length, '0')}</span>
              </li>
            {/each}
          {/each}
        </ul>
      {/if}
    </section>
  </main>

  <footer class="foot">
    裁决规则：同长度按键序列按 <code>Tab → Shift+Tab → 激活</code> 排序取最先发现者。
    当前状态：focus={decodeFocus(currentState())}, bits={decodeBits(currentState()).toString(2)}
  </footer>
</div>
