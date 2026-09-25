import type { NodeDecl, ActionKind, EdgeReason } from './focus';
import { ACTION_LABEL } from './focus';

export function switchLabelOf(graph: { switches: { id: number; label?: string }[] }, id: number): string {
  const sw = graph.switches.find((s) => s.id === id);
  return sw?.label ?? `开关#${id}`;
}

export function nodeLabelOf(graph: { nodes: NodeDecl[] }, index: number): string {
  const n = graph.nodes[index];
  if (!n) return '?';
  return n.label ? `${n.label}（${n.id}）` : n.id;
}

export function describeCondition(node: NodeDecl, swLabel: (id: number) => string): string {
  if (!node.visible || node.visible.length === 0) return '始终可见';
  return node.visible.map((c) => `${swLabel(c.switch)} = ${c.on ? '开' : '关'}`).join(' 且 ');
}

const ACTION_KEY: Record<ActionKind, 'tab' | 'shiftTab' | 'activate'> = {
  0: 'tab',
  1: 'shiftTab',
  2: 'activate'
};

export interface ActionLabels {
  self: string;
  nodeById: (id: string) => string;
  switch: (id: number) => string;
}

export function describeAction(
  node: NodeDecl,
  kind: ActionKind,
  labels: ActionLabels
): { targetText: string; toggleText: string | null } | null {
  const action = node[ACTION_KEY[kind]];
  if (action === undefined) return null;
  if (action === null) return { targetText: '（未定义）', toggleText: null };
  const targetText = action.target == null ? `停留于 ${labels.self}` : `→ ${labels.nodeById(action.target)}`;
  const toggleText =
    action.toggle == null ? null : `翻转 ${labels.switch(action.toggle)}`;
  return { targetText, toggleText };
}

export const REASON_TEXT: Record<EdgeReason, string> = {
  ok: '可走',
  'no-action': '该动作未定义',
  'target-hidden': '目标节点当前隐藏',
  'target-hidden-after-toggle': '翻转开关后目标节点消失',
  'source-hidden': '当前节点不可见'
};

export { ACTION_LABEL };
