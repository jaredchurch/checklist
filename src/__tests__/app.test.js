import { describe, it, expect, beforeEach } from 'vitest';
import { createNode, createListNode, setTreeDone, setLevelDone, findNodeById, getData, saveData, renderTree, sanitizeTree, sortNodeChildren } from '../app.js';

describe('Checklist core logic', () => {
  let root;

  beforeEach(() => {
    root = {
      id: 'root',
      type: 'list',
      title: 'Root List',
      children: [
        { id: 'a', type: 'item', title: 'Child item', done: false, children: [] }
      ]
    };
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
    setTreeDone(root.children, true, true);
    expect(root.children[0].done).toBe(true);
  });

  it('setTreeDone excludes descendants when false (items only)', () => {
    root.children[0].done = true;
    setTreeDone(root.children, false, false);
    expect(root.children[0].done).toBe(false);
  });

  it('setTreeDone on item nodes does not affect their descendants', () => {
    const nested = createNode('nested');
    root.children[0].children.push(nested);
    setTreeDone([root.children[0]], true, true);
    expect(root.children[0].done).toBe(true);
    expect(root.children[0].children[0].done).toBe(false);
  });

  it('setLevelDone does not recurse via item nodes', () => {
    const nested = createNode('nested');
    root.children[0].children.push(nested);
    setLevelDone(root.children, 1, true);
    expect(root.children[0].done).toBe(false);
    expect(root.children[0].children[0].done).toBe(false);
  });

  it('setLevelDone sets target level only', () => {
    setLevelDone(root.children, 0, true);
    expect(root.children[0].done).toBe(true);
  });

  it('findNodeById returns correct node', () => {
    const result = findNodeById(root, 'a');
    expect(result).toEqual(root.children[0]);
  });

  it('sanitizeTree regenerates duplicate and missing IDs', () => {
    const existingIds = new Set(['root', 'a']);
    const imported = {
      id: 'a',
      type: 'list',
      title: 'Imported',
      children: [
        { id: 'a', type: 'item', title: 'Child item', done: false, children: [] },
        { type: 'item', title: 'Missing id', done: false, children: [] }
      ]
    };

    const sanitized = sanitizeTree(imported, existingIds);
    expect(sanitized.id).not.toBe('a');
    expect(sanitized.children[0].id).not.toBe('a');
    expect(sanitized.children[1].id).toEqual(expect.any(String));
    expect(new Set([sanitized.id, sanitized.children[0].id, sanitized.children[1].id]).size).toBe(3);
  });

  it('sortNodeChildren orders incomplete items and lists first while preserving manual order', () => {
    const root = createListNode('Root');
    const itemA = createNode('Item A');
    const itemB = createNode('Item B');
    const listA = createListNode('List A');
    const listB = createListNode('List B');

    itemA.done = false;
    itemB.done = true;

    const nested = createNode('Nested Item');
    nested.done = true;
    listA.children.push(nested);

    listB.children.push(createNode('Incomplete'));

    root.children.push(itemA, listA, itemB, listB);

    sortNodeChildren(root);

    expect(root.children[0]).toBe(listB);
    expect(root.children[1]).toBe(itemA);
    expect(root.children[2]).toBe(listA);
    expect(root.children[3]).toBe(itemB);
  });

  it('sortNodeChildren preserves original creation order when an item is toggled back to incomplete', () => {
    const root = createListNode('Root');
    const itemA = createNode('Item A');
    const itemC = createNode('Item C');
    const itemB = createNode('Item B');

    itemA.done = false;
    itemC.done = true;
    itemB.done = false;

    root.children.push(itemA, itemC, itemB);

    expect(root.children.map((n) => n.title)).toEqual(['Item A', 'Item C', 'Item B']);

    sortNodeChildren(root);
    expect(root.children.map((n) => n.title)).toEqual(['Item A', 'Item B', 'Item C']);

    itemC.done = false;
    sortNodeChildren(root);
    expect(root.children.map((n) => n.title)).toEqual(['Item A', 'Item C', 'Item B']);
  });

  it('renderTree adds context menu toggle to both items and lists', () => {
    const root = createListNode('Root');
    const item = createNode('Item');
    item.children.push(createNode('child-of-item'));
    const list = createListNode('List');
    root.children.push(item, list);

    const container = document.createElement('div');
    renderTree(root.children, container);

    const firstItem = container.querySelectorAll('li')[0];
    const firstItemMenuToggle = [...firstItem.querySelectorAll('button')].find((b) => b.textContent === '⋮');
    expect(firstItemMenuToggle).toBeDefined();

    const secondListItem = container.querySelectorAll('li')[1];
    const secondListMenuToggle = [...secondListItem.querySelectorAll('button')].find((b) => b.textContent === '⋮');
    expect(secondListMenuToggle).toBeDefined();

    const firstListItemButtons = [...firstItem.querySelectorAll('button')].map((b) => b.textContent);
    expect(firstListItemButtons).not.toContain('Set Descendants Done');
    expect(firstListItemButtons).not.toContain('Set Descendants Not Done');

    const secondListButtons = [...secondListItem.querySelectorAll('button')].map((b) => b.textContent);
    expect(secondListButtons).not.toContain('Set Descendants Done');
    expect(secondListButtons).not.toContain('Set Descendants Not Done');
  });

  it('getData/saveData roundtrips localStorage', () => {
    const sample = createListNode('Test Root');
    sample.children.push(createNode('x'));
    saveData(sample);
    const loaded = getData();
    expect(loaded.title).toBe('Test Root');
    expect(loaded.children[0].title).toBe('x');
  });
});
