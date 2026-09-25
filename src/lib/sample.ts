import type { GraphDecl } from './focus';

// 内置示例：开关“电源”。
//   入口 A：激活翻转电源（自身停留）；Tab→B；Shift+Tab→C
//   B：仅电源开时可见，Tab→目标 T；激活会把电源关掉，B 随即消失（失效边）
//   C：无法翻转电源，只能进入死角 D（Tab/Shift+Tab），激活想直达 B 也因 B 隐藏而失效
//   D：没有任何动作
//   T：目标，仅电源开时可见
// 最短序列：激活 → Tab → Tab；最短陷阱前缀：Shift+Tab（进入 C/D 后再无法通电）。
export const SAMPLE_GRAPH: GraphDecl = {
  switches: [{ id: 0, label: '电源' }],
  nodes: [
    {
      id: 'A',
      label: '入口表单',
      activate: { target: null, toggle: 0 },
      tab: { target: 'B' },
      shiftTab: { target: 'C' }
    },
    {
      id: 'B',
      label: '条件控件 B',
      visible: [{ switch: 0, on: true }],
      tab: { target: 'T' },
      activate: { target: 'B', toggle: 0 }
    },
    {
      id: 'C',
      label: '局部面板 C',
      tab: { target: 'D' },
      shiftTab: { target: 'D' },
      activate: { target: 'B' }
    },
    {
      id: 'D',
      label: '死角 D'
    },
    {
      id: 'T',
      label: '目标提交按钮',
      visible: [{ switch: 0, on: true }]
    }
  ],
  entry: 'A',
  target: 'T'
};

export const SAMPLE_TEXT = JSON.stringify(SAMPLE_GRAPH, null, 2);
