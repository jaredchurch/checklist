import { describe, it, expect, beforeEach } from 'vitest';
import { createNode, createListNode, setTreeDone, setLevelDone, findNodeById, getData, saveData, renderTree } from '../app.js';

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

  it('renderTree does not add descendant action buttons on item nodes', () => {
    const root = createListNode('Root');
    const item = createNode('Item');
    item.children.push(createNode('child-of-item'));
    const list = createListNode('List');
    root.children.push(item, list);

    const container = document.createElement('div');
    renderTree(root.children, container);

    const firstItem = container.querySelectorAll('li')[0];
    const firstItemMenuToggle = firstItem.querySelector('button');
    expect(firstItemMenuToggle?.textContent).not.toBe('⋮');

    const secondListItem = container.querySelectorAll('li')[1];
    const secondListMenuToggle = [...secondListItem.querySelectorAll('button')].find((b) => b.textContent === '⋮');
    expect(secondListMenuToggle).toBeUndefined();

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

  it('lastCompletedDate is set when item is marked as done', () => {
    const item = createNode('Test');
    expect(item.lastCompletedDate).toBeUndefined();
    item.done = true;
    item.lastCompletedDate = Date.now();
    expect(item.lastCompletedDate).toBeDefined();
    expect(item.lastCompletedDate).toBeGreaterThan(0);
  });

  it('lastCompletedDate persists when item is unmarked', () => {
    const item = createNode('Test');
    item.done = true;
    item.lastCompletedDate = 1000;
    item.done = false;
    expect(item.lastCompletedDate).toBe(1000);
  });
});
