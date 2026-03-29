import { describe, it, expect, beforeEach } from 'vitest';
import { createNode, createListNode, setTreeDone, setLevelDone, findNodeById, getData, saveData } from '../app.js';

describe('Checklist core logic', () => {
  let tree;

  beforeEach(() => {
    tree = [
      { id: 'a', type: 'list', title: 'Root List', children: [
          { id: 'b', type: 'item', title: 'Child item', done: false, children: [] }
        ]
      }
    ];
  });

  it('createNode creates a valid item node', () => {
    const node = createNode('Test');
    expect(node.type).toBe('item');
    expect(node.title).toBe('Test');
    expect(node.done).toBe(false);
    expect(node.children).toEqual([]);
    expect(node.id).toEqual(expect.any(String));
  });

  it('createListNode creates a valid list node', () => {
    const list = createListNode('List');
    expect(list.type).toBe('list');
    expect(list.title).toBe('List');
    expect(list.children).toEqual([]);
    expect(list.done).toBeUndefined();
  });

  it('setTreeDone includes descendants when true (items only)', () => {
    setTreeDone(tree, true, true);
    expect(tree[0].type).toBe('list');
    expect(tree[0].children[0].done).toBe(true);
  });

  it('setTreeDone excludes descendants when false (items only)', () => {
    tree[0].children[0].done = true;
    setTreeDone(tree, false, false);
    expect(tree[0].children[0].done).toBe(true);
  });

  it('setLevelDone sets target level only', () => {
    setLevelDone(tree, 1, true);
    expect(tree[0].done).toBeUndefined();
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
