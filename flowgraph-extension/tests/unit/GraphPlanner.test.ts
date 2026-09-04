import { describe, expect, it } from 'vitest';
import { planGraph, readyNodes, downstreamOf } from '../../src/runtime/GraphPlanner';

describe('GraphPlanner', () => {
  const nodes = [
    { id: 'a', kind: 'prompt' },
    { id: 'b', kind: 't2i' },
    { id: 'c', kind: 'i2v' },
    { id: 'd', kind: 'download' },
  ];

  it('plans a linear chain in topological order', () => {
    const edges = [
      { id: 'e1', source: 'a', sourceHandle: 'prompt', target: 'b', targetHandle: 'prompt' },
      { id: 'e2', source: 'b', sourceHandle: 'image', target: 'c', targetHandle: 'image' },
      { id: 'e3', source: 'c', sourceHandle: 'video', target: 'd', targetHandle: 'media' },
    ];
    const plan = planGraph(nodes, edges);
    expect(plan.cycles).toEqual([]);
    expect(plan.order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('detects cycles', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'a' },
    ];
    const plan = planGraph(nodes.slice(0, 2), edges);
    expect(plan.cycles.length).toBeGreaterThan(0);
    expect(plan.order.length).toBeLessThan(nodes.slice(0, 2).length);
  });

  it('keeps independent branches in a valid order', () => {
    const branchNodes = [...nodes, { id: 'x', kind: 'prompt' }, { id: 'y', kind: 't2i' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'x', target: 'y' },
    ];
    const plan = planGraph(branchNodes, edges);
    expect(plan.cycles).toEqual([]);
    expect(plan.order.length).toBe(branchNodes.length);
    expect(plan.order.indexOf('b')).toBeGreaterThan(plan.order.indexOf('a'));
    expect(plan.order.indexOf('y')).toBeGreaterThan(plan.order.indexOf('x'));
  });

  it('readyNodes returns only nodes whose sources completed', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const order = planGraph(nodes.slice(0, 3), edges).order;
    expect(readyNodes(order, edges, new Set(), new Set())).toEqual(['a']);
    expect(readyNodes(order, edges, new Set(['a']), new Set())).toEqual(['b']);
    expect(readyNodes(order, edges, new Set(['a', 'b']), new Set())).toEqual(['c']);
  });

  it('downstreamOf returns transitive dependents', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'c', target: 'd' },
    ];
    expect(downstreamOf('a', edges).sort()).toEqual(['b', 'c', 'd']);
    expect(downstreamOf('c', edges)).toEqual(['d']);
    expect(downstreamOf('d', edges)).toEqual([]);
  });
});
