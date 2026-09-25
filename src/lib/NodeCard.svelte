<script lang="ts">
  import type { ActionKind, EdgeResult, Graph } from './focus';
  import { ACTIONS, ACTION_LABEL, edgeStatus, isVisible } from './focus';
  import { REASON_TEXT, describeCondition, describeAction } from './format';

  export let graph: Graph;
  export let index: number;
  export let bits: number;
  export let focused: boolean;
  export let plannedKind: ActionKind | null = null;
  export let isEntry = false;
  export let isTarget = false;
  export let onAction: (kind: ActionKind) => void = () => {};

  $: node = graph.nodes[index];
  $: visible = isVisible(node, bits);

  let statuses: Record<ActionKind, EdgeResult | null> = { 0: null, 1: null, 2: null };
  // 显式引用 visible / graph / index / bits 以建立响应式依赖。
  $: statuses = visible
    ? ({
        0: edgeStatus(graph, index, bits, 0),
        1: edgeStatus(graph, index, bits, 1),
        2: edgeStatus(graph, index, bits, 2)
      } as Record<ActionKind, EdgeResult>)
    : { 0: null, 1: null, 2: null };

  const swLabel = (id: number): string => graph.switches.find((s) => s.id === id)?.label ?? `开关#${id}`;
  const idToLabel = (id: string): string => {
    const i = graph.nodes.findIndex((n) => n.id === id);
    const n = graph.nodes[i];
    return n?.label ? `${n.label}（${n.id}）` : id;
  };

  function chipClass(kind: ActionKind): string {
    const e = statuses[kind];
    const cls = ['chip'];
    if (!e || e.reason === 'no-action') cls.push('chip-dead-def');
    else if (e.reason !== 'ok') cls.push('chip-dead');
    if (plannedKind === kind) cls.push('chip-planned');
    return cls.join(' ');
  }

  function isDisabled(kind: ActionKind): boolean {
    if (!focused || !visible) return true;
    const e = statuses[kind];
    return e === null || e.reason !== 'ok';
  }

  function titleFor(kind: ActionKind): string {
    const e = statuses[kind];
    return e && e.reason !== 'ok' ? REASON_TEXT[e.reason] : '';
  }

  function badReason(kind: ActionKind): string | null {
    const e = statuses[kind];
    return e && e.reason !== 'ok' ? REASON_TEXT[e.reason] : null;
  }
</script>

<section
  class="node"
  class:node-hidden={!visible}
  class:node-focus={focused && visible}
>
  <header>
    <span class="idx">{index}</span>
    <strong>{node.label ?? node.id}</strong>
    <span class="nid">{node.id}</span>
    {#if isEntry}<span class="tag tag-entry">入口</span>{/if}
    {#if isTarget}<span class="tag tag-target">目标</span>{/if}
  </header>
  <p class="cond" title={describeCondition(node, swLabel)}>
    可见条件：{describeCondition(node, swLabel)}
  </p>
  <ul class="actions">
    {#each ACTIONS as kind (kind)}
      {@const desc = describeAction(node, kind, {
        self: node.id,
        switch: swLabel,
        nodeById: idToLabel
      })}
      <li>
        <button
          type="button"
          class={chipClass(kind)}
          disabled={isDisabled(kind)}
          title={titleFor(kind)}
          on:click={() => onAction(kind)}
        >
          <span class="akey">{ACTION_LABEL[kind]}</span>
          {#if desc}
            <span class="adesc">{desc.targetText}</span>
            {#if desc.toggleText}<span class="atoggle">{desc.toggleText}</span>{/if}
          {/if}
          {#if badReason(kind)}
            <span class="abad">✕ {badReason(kind)}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</section>
