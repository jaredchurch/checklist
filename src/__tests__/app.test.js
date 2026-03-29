import { describe, it, expect, beforeEach } from 'vitest';
import { createNode, setTreeDone, setLevelDone, findNodeById, getData, saveData } from '../app.js';

describe('Checklist core logic', () => {
  let tree;

  beforeEach(() => {
    tree = [
      { id: 'a', title: 'Root', done: false, children: [
          { id: 'b', title: 'Child', done: false, children: [] }
        ]
      }
    ];
  });

  it('createNode creates a valid node', () => {
    const node = createNode('Test');
    expect(node.title).toBe('Test');
    expect(node.done).toBe(false);
    expect(node.children).toEqual([]);
    expect(node.id).toEqual(expect.any(String));
  });

  it('setTreeDone includes descendants when true', () => {
    setTreeDone(tree, true, true);
    expect(tree[0].done).toBe(true);
    expect(tree[0].children[0].done).toBe(true);
  });

  it('setTreeDone excludes descendants when false', () => {
    tree[0].children[0].done = true;
    setTreeDone(tree, false, false);
    expect(tree[0].done).toBe(false);
    expect(tree[0].children[0].done).toBe(true);
  });

  it('setLevelDone sets target level only', () => {
    setLevelDone(tree, 1, true);
    expect(tree[0].done).toBe(false);
    expect(tree[0].children[0].done).toBe(true);
  });

  it('findNodeById returns correct node', () => {
    const result = findNodeById(tree, 'b');
    expect(result).toEqual(tree[0].children[0]);
  });

  it('getData/saveData roundtrips localStorage', () => {
    const sample = [createNode('x')];
    saveData(sample);
    const loaded = getData();
    expect(loaded[0].title).toBe('x');
  });
});
