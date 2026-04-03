const KEY = 'checklist-pwa-data-v1';

function uid() {
  return "x" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function createNode(title = 'New item') {
  return {
    id: uid(),
    type: 'item',
    title,
    done: false,
    children: [],
    isNew: true
  };
}

function createListNode(title = 'New list') {
  return {
    id: uid(),
    type: 'list',
    title,
    children: [],
    isNew: true
  };
}

function sanitizeTree(node) {
  if (node.type === 'item') {
    node.children = [];
    if (typeof node.done !== 'boolean') node.done = false;
    if (typeof node.isNew !== 'boolean') node.isNew = false;
    return node;
  }

  if (node.type === 'list') {
    node.children = Array.isArray(node.children) ? node.children.map(sanitizeTree) : [];
    if (typeof node.isNew !== 'boolean') node.isNew = false;
    return node;
  }

  // fallback if malformed node type is encountered
  return createListNode(node.title || 'Root');
}

function getData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return createListNode('Root');
    const parsed = JSON.parse(raw);
    // Ensure it's a list node
    if (parsed.type !== 'list') {
      console.warn('Invalid root data, resetting to default');
      return createListNode('Root');
    }
    return sanitizeTree(parsed);
  } catch (err) {
    console.error('Invalid saved data', err);
    localStorage.removeItem(KEY);
    return createListNode('Root');
  }
}

function saveData(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

let importFileInput = null;

function updateMenuLock() {
  const anyOpen = document.querySelector('.context-menu.open');
  document.body.classList.toggle('menu-open', !!anyOpen);
}

function exportData() {
  const dataString = JSON.stringify(nodesRaw, null, 2);
  const blob = new Blob([dataString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'checklist-backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

function exportSubListData() {
  const currentNode = getCurrentParentNode();
  const dataString = JSON.stringify(currentNode, null, 2);
  const blob = new Blob([dataString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'checklist-sublist.json';
  a.click();
  URL.revokeObjectURL(url);
}

function promptImportData() {
  const input = importFileInput || document.getElementById('import');
  if (input) {
    input.click();
    return;
  }

  const fallback = document.createElement('input');
  fallback.type = 'file';
  fallback.accept = 'application/json';
  fallback.style.display = 'none';
  fallback.addEventListener('change', async (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (imported.type !== 'list') throw new Error('Invalid file format: must be a list node');
      nodesRaw = sanitizeTree(imported);
      saveData(nodesRaw);
      render();
      fallback.value = '';
    } catch (error) {
      alert('Import failed: ' + error.message);
      console.error(error);
    } finally {
      document.body.removeChild(fallback);
    }
  });
  document.body.appendChild(fallback);
  fallback.click();
}

function promptImportSubListData() {
  const fallback = document.createElement('input');
  fallback.type = 'file';
  fallback.accept = 'application/json';
  fallback.style.display = 'none';
  fallback.addEventListener('change', async (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (imported.type !== 'list') throw new Error('Invalid file format: must be a list node');
      
      const currentNode = getCurrentParentNode();
      currentNode.children = currentNode.children || [];
      currentNode.children.push(sanitizeTree(imported));
      saveData(nodesRaw);
      render();
      fallback.value = '';
    } catch (error) {
      alert('Import failed: ' + error.message);
      console.error(error);
    } finally {
      document.body.removeChild(fallback);
    }
  });
  document.body.appendChild(fallback);
  fallback.click();
}

function findNodeById(root, id) {
  if (root.id === id) return root;
  for (const n of root.children) {
    const found = findNodeById(n, id);
    if (found) return found;
  }
  return null;
}

function updateNode(root, id, callback) {
  if (root.id === id) {
    callback(root);
    return true;
  }
  for (const n of root.children) {
    if (updateNode(n, id, callback)) return true;
  }
  return false;
}

function setTreeDone(nodes, done, includeDescendants = true) {
  for (const n of nodes) {
    if (n.type === 'item') {
      n.done = done;
      // items are leaf nodes by definition and should not propagate to children
      continue;
    }
    // lists may have children that can be checked as items
    if (includeDescendants && n.type === 'list') {
      setTreeDone(n.children, done, true);
    }
  }
}

function getDescendantItemSummary(node) {
  let done = 0;
  let total = 0;

  function recurse(n) {
    for (const c of n.children || []) {
      if (c.type === 'item') {
        total += 1;
        if (c.done) done += 1;
      } else if (c.type === 'list') {
        recurse(c);
      }
    }
  }

  if (node.type === 'list') {
    recurse(node);
  }

  return { done, total };
}

function setLevelDone(nodes, level, done) {
  if (level === 0) {
    for (const n of nodes) {
      if (n.type === 'item') {
        n.done = done;
      }
    }
    return;
  }
  for (const n of nodes) {
    if (n.type === 'list') {
      setLevelDone(n.children, level - 1, done);
    }
  }
}

function renderTree(nodes, container, level = 0) {
  container.innerHTML = '';
  const ul = document.createElement('ul');
  for (const node of nodes) {
    if (node.type === 'item') {
      node.children = []; // Enforce no descendants on item nodes
    }

    const li = document.createElement('li');
    const wrapper = document.createElement('div');
    wrapper.className = `tree-item${node.type === 'item' && node.done ? ' done' : ''}`;

    const titleInput = document.createElement('input');

    const actionControl = document.createElement(node.type === 'item' ? 'input' : 'button');

    if (node.type === 'item') {
      actionControl.type = 'checkbox';
      actionControl.checked = node.done;
      actionControl.addEventListener('change', () => {
        node.done = actionControl.checked;
        saveData(nodesRaw);
        render();
      });
      actionControl.style.minWidth = '1rem';
      actionControl.style.marginRight = '0.5rem';
    } else {
      actionControl.textContent = '↓';
      actionControl.className = 'small-button';
      actionControl.style.minWidth = '1rem';
      actionControl.style.marginRight = '0.5rem';
      actionControl.title = 'Drill In';
      actionControl.addEventListener('click', () => {
        currentPath.push(node.id);
        render();
      });
    }

    titleInput.type = 'text';
    titleInput.type = 'text';
    titleInput.value = node.title;
    titleInput.className = 'label';
    titleInput.addEventListener('change', () => {
      node.title = titleInput.value;
      node.isNew = false;
      saveData(nodesRaw);
      render();
    });
    titleInput.addEventListener('blur', () => {
      node.isNew = false;
    });
    titleInput.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        node.isNew = false;
        if (node.type === 'item') {
          // Create new item
          const parent = findParent(nodesRaw, node.id);
          const array = parent ? parent.children : nodesRaw.children;
          const idx = array.findIndex((c) => c.id === node.id);
          if (idx !== -1) {
            array.splice(idx + 1, 0, createNode());
            saveData(nodesRaw);
            render();
            // Focus the new item
            setTimeout(() => {
              const inputs = document.querySelectorAll('#tree-content input.label');
              const newInput = inputs[idx + 1];
              if (newInput) {
                newInput.focus();
                newInput.select();
              }
            }, 0);
          }
        } else if (node.type === 'list') {
          // Drill into list and create new item
          currentPath.push(node.id);
          const listNode = findNodeById(nodesRaw, node.id);
          if (listNode) {
            listNode.children = listNode.children || [];
            listNode.children.push(createNode());
            saveData(nodesRaw);
            render();
            // Focus the new item in the sub-list
            setTimeout(() => {
              const inputs = document.querySelectorAll('#tree-content input.label');
              const lastInput = inputs[inputs.length - 1];
              if (lastInput) {
                lastInput.focus();
                lastInput.select();
              }
            }, 0);
          } else {
            render();
          }
        }
      } else if (evt.key === 'Escape') {
        if (node.isNew) {
          evt.preventDefault();
          // Delete the new item
          const parent = findParent(nodesRaw, node.id);
          const array = parent ? parent.children : nodesRaw.children;
          const idx = array.findIndex((c) => c.id === node.id);
          if (idx !== -1) {
            array.splice(idx, 1);
            saveData(nodesRaw);
            render();
          }
        }
      }
    });

    const removeButton = document.createElement('button');
    removeButton.textContent = 'Delete';
    removeButton.className = 'small-button';
    removeButton.addEventListener('click', () => {
      const parent = findParent(nodesRaw, node.id);
      const array = parent ? parent.children : nodesRaw.children;
      const idx = array.findIndex((c) => c.id === node.id);
      if (idx !== -1) {
        array.splice(idx, 1);
        saveData(nodesRaw);
        render();
      }
    });

    const elements = [actionControl, titleInput, removeButton];

    if (node.type === 'list') {
      const summary = getDescendantItemSummary(node);
      const summaryEl = document.createElement('span');
      summaryEl.className = 'summary';
      summaryEl.textContent = `(${summary.done}/${summary.total})`;
      elements.splice(2, 0, summaryEl); // insert before removeButton
    }

    wrapper.append(...elements);

    li.appendChild(wrapper);
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

function findParent(root, childId, parent = null) {
  if (root.id === childId) return parent;
  for (const node of root.children) {
    const found = findParent(node, childId, root);
    if (found) return found;
  }
  return null;
}

let nodesRaw = getData();
let currentPath = [];

function getCurrentParentNode() {
  if (currentPath.length === 0) return nodesRaw;
  const node = findNodeById(nodesRaw, currentPath[currentPath.length - 1]);
  return node || nodesRaw;
}

function getCurrentNodes() {
  const parent = getCurrentParentNode();
  return Array.isArray(parent.children) ? parent.children : [];
}

function render() {
  const container = document.getElementById('tree-content');
  if (!container) return;

  const breadcrumb = document.getElementById('breadcrumb');
  if (breadcrumb) {
    breadcrumb.innerHTML = '';
    const home = document.createElement('button');
    home.textContent = 'Home';
    home.addEventListener('click', () => {
      currentPath = [];
      render();
    });
    breadcrumb.appendChild(home);

    let pathNodes = [];
    let node = nodesRaw;
    currentPath.forEach((id) => {
      node = findNodeById(node, id);
      if (node) pathNodes.push(node);
    });

    pathNodes.forEach((pNode) => {
      const sep = document.createElement('span');
      sep.textContent = ' / ';
      breadcrumb.appendChild(sep);

      const segment = document.createElement('button');
      segment.textContent = pNode.title;
      segment.addEventListener('click', () => {
        const idx = currentPath.indexOf(pNode.id);
        if (idx === -1) return;
        currentPath = currentPath.slice(0, idx + 1);
        render();
      });
      breadcrumb.appendChild(segment);
    });
  }

  renderTree(getCurrentNodes(), container);
  const back = document.getElementById('back-up');
  if (back) {
    if (currentPath.length > 0) {
      back.classList.remove('hidden');
      back.style.visibility = 'visible';
    } else {
      back.classList.add('hidden');
      back.style.visibility = 'hidden';
    }
  }
}

function registerControls() {
  const backUp = document.getElementById('back-up');
  const addItem = document.getElementById('add-item');
  const addList = document.getElementById('add-list');
  const globalMarkAllDone = document.getElementById('global-mark-all-done');
  const globalMarkAllNotDone = document.getElementById('global-mark-all-not-done');

  if (addItem) {
    addItem.addEventListener('click', () => {
      const parent = getCurrentParentNode();
      parent.children = parent.children || [];
      const newNode = createNode();
      parent.children.push(newNode);
      saveData(nodesRaw);
      render();
      // Focus the new item
      setTimeout(() => {
        const inputs = document.querySelectorAll('#tree-content input.label');
        const lastInput = inputs[inputs.length - 1];
        if (lastInput) {
          lastInput.focus();
          lastInput.select();
        }
      }, 0);
    });
  }

  if (addList) {
    addList.addEventListener('click', () => {
      const parent = getCurrentParentNode();
      parent.children = parent.children || [];
      const newNode = createListNode();
      parent.children.push(newNode);
      saveData(nodesRaw);
      render();
      // Focus the new list
      setTimeout(() => {
        const inputs = document.querySelectorAll('#tree-content input.label');
        const lastInput = inputs[inputs.length - 1];
        if (lastInput) {
          lastInput.focus();
          lastInput.select();
        }
      }, 0);
    });
  }

  if (globalMarkAllDone) {
    globalMarkAllDone.addEventListener('click', () => {
      setTreeDone(getCurrentNodes(), true, true);
      saveData(nodesRaw);
      render();
      document.getElementById('global-context')?.classList.remove('open');
    });
  }

  if (globalMarkAllNotDone) {
    globalMarkAllNotDone.addEventListener('click', () => {
      setTreeDone(getCurrentNodes(), false, true);
      saveData(nodesRaw);
      render();
      document.getElementById('global-context')?.classList.remove('open');
    });
  }

  if (backUp) {
    backUp.addEventListener('click', () => {
      if (currentPath.length > 0) {
        currentPath.pop();
        render();
      }
    });
  }

  const globalContextToggle = document.getElementById('global-context-toggle');
  const globalContext = document.getElementById('global-context');
  const globalExport = document.getElementById('global-export');
  const globalImport = document.getElementById('global-import');

  if (globalContextToggle && globalContext) {
    globalContextToggle.addEventListener('click', () => {
      globalContext.classList.toggle('open');
      updateMenuLock();
    });
  }

  if (globalExport) {
    globalExport.addEventListener('click', () => {
      if (currentPath.length === 0) {
        // At root level, export entire tree
        exportData();
      } else {
        // In sub-list, export current sub-list
        exportSubListData();
      }
      globalContext?.classList.remove('open');
    });
  }

  if (globalImport) {
    globalImport.addEventListener('click', () => {
      showImportDialog();
      globalContext?.classList.remove('open');
    });
  }

  const globalAbout = document.getElementById('global-about');
  const aboutDialog = document.getElementById('about-dialog');
  const aboutCommitInfo = document.getElementById('about-commit-info');
  const closeAbout = document.getElementById('close-about');

  let lastFocusedElement = null;

  const onAboutKeydown = (evt) => {
    if (evt.key === 'Escape' && aboutDialog.style.display === 'flex') {
      evt.preventDefault();
      closeAboutDialog();
    }

    if (evt.key === 'Tab' && aboutDialog.style.display === 'flex') {
      const focusable = aboutDialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const focusArray = Array.from(focusable).filter((el) => !el.hasAttribute('disabled'));
      const currentIndex = focusArray.indexOf(document.activeElement);
      let nextIndex = currentIndex;

      if (evt.shiftKey) {
        nextIndex = currentIndex <= 0 ? focusArray.length - 1 : currentIndex - 1;
      } else {
        nextIndex = currentIndex === focusArray.length - 1 ? 0 : currentIndex + 1;
      }

      evt.preventDefault();
      focusArray[nextIndex].focus();
    }
  };

  const openAbout = async () => {
    if (!aboutDialog || !aboutCommitInfo) return;

    lastFocusedElement = document.activeElement;
    aboutDialog.style.display = 'flex';

    const focusable = aboutDialog.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable) focusable.focus();

    document.addEventListener('keydown', onAboutKeydown);

    aboutCommitInfo.textContent = 'Loading commit info...';
    await fetchCommitInfo();
    globalContext?.classList.remove('open');
    updateMenuLock();
  };

  const closeAboutDialog = () => {
    if (!aboutDialog) return;

    aboutDialog.style.display = 'none';
    document.removeEventListener('keydown', onAboutKeydown);

    if (lastFocusedElement && lastFocusedElement.focus) {
      lastFocusedElement.focus();
    }
  };

  if (aboutDialog) {
    aboutDialog.addEventListener('click', (evt) => {
      if (evt.target === aboutDialog) {
        closeAboutDialog();
      }
    });
  }

  if (globalAbout) {
    globalAbout.addEventListener('click', openAbout);
  }

  if (closeAbout) {
    closeAbout.addEventListener('click', (evt) => {
      evt.stopPropagation();
      closeAboutDialog();
    });
  }

  // Import dialog functionality
  const importDialog = document.getElementById('import-dialog');
  const importReplace = document.getElementById('import-replace');
  const importSublist = document.getElementById('import-sublist');
  const cancelImport = document.getElementById('cancel-import');

  let importFileData = null;

  const showImportDialog = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.style.display = 'none';
    input.addEventListener('change', async (evt) => {
      const file = evt.target.files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (imported.type !== 'list') throw new Error('Invalid file format: must be a list node');
        
        importFileData = imported;
        importDialog.style.display = 'flex';
        document.body.removeChild(input);
      } catch (error) {
        alert('Invalid file: ' + error.message);
        document.body.removeChild(input);
      }
    });
    document.body.appendChild(input);
    input.click();

    // Make sure any residual menu-open state doesn't block the dialog
    updateMenuLock();
  };

  const closeImportDialog = () => {
    if (!importDialog) return;
    importDialog.style.display = 'none';
    importFileData = null;
  };

  if (importReplace) {
    importReplace.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (importFileData) {
        nodesRaw = sanitizeTree(importFileData);
        saveData(nodesRaw);
        currentPath = [];
        render();
        closeImportDialog();
      }
    });
  }

  if (importSublist) {
    importSublist.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (importFileData) {
        const currentNode = getCurrentParentNode();
        currentNode.children = currentNode.children || [];
        currentNode.children.push(sanitizeTree(importFileData));
        saveData(nodesRaw);
        render();
        closeImportDialog();
      }
    });
  }

  if (cancelImport) {
    cancelImport.addEventListener('click', (evt) => {
      evt.stopPropagation();
      closeImportDialog();
    });
  }

  if (importDialog) {
    importDialog.addEventListener('click', (evt) => {
      if (evt.target === importDialog) {
        closeImportDialog();
      }
    });
  }

  // Unified click outside to close all context menus
  document.addEventListener('click', (evt) => {
    const target = evt.target;
    const isInsideMenu = target.closest('.context-menu');
    const isToggle = target.closest('.context-toggle');
    if (!isInsideMenu && !isToggle) {
      // close all open context menus
      document.querySelectorAll('.context-menu.open').forEach(menu => menu.classList.remove('open'));
      updateMenuLock();
    }
  });

}

async function fetchCommitInfo() {
  const el = document.getElementById('about-commit-info') || document.getElementById('commit-info');
  if (!el) return;

  const repoOwner = 'jaredchurch';
  const repoName = 'checklist';

  try {
    let branch = 'main';

    const pagesResp = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pages`);
    if (pagesResp.ok) {
      const pagesData = await pagesResp.json();
      branch = pagesData.source?.branch || branch;
    } else {
      const repoResp = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`);
      if (repoResp.ok) {
        const repoData = await repoResp.json();
        branch = repoData.default_branch || branch;
      }
    }

    const commitResp = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/commits/${branch}`);
    if (!commitResp.ok) throw new Error(`Commits API ${commitResp.status}`);
    const commit = await commitResp.json();

    const hash = commit.sha.slice(0, 7);
    const date = new Date(commit.commit.committer.date).toLocaleString();
    el.textContent = `Commit ${hash} @ ${date} (${branch})`;
    return;
  } catch (err) {
    console.warn('Failed to load commit info', err);
    el.textContent = 'Commit info unavailable';
  }
}

function init() {
  document.title = 'Checklist';
  registerControls();
  render();
  fetchCommitInfo();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(() => {
      console.log('Service worker registered');
    }).catch((err) => console.error(err));
  }
}

window.addEventListener('load', init);

export {
  getData,
  saveData,
  createNode,
  createListNode,
  setTreeDone,
  setLevelDone,
  findNodeById,
  findParent,
  render,
  renderTree
};
