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
    children: []
  };
}

function createListNode(title = 'New list') {
  return {
    id: uid(),
    type: 'list',
    title,
    children: []
  };
}

function sanitizeTree(node) {
  if (node.type === 'item') {
    node.children = [];
    if (typeof node.done !== 'boolean') node.done = false;
    return node;
  }

  if (node.type === 'list') {
    node.children = Array.isArray(node.children) ? node.children.map(sanitizeTree) : [];
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

    const checkbox = document.createElement('input');
    if (node.type === 'item') {
      checkbox.type = 'checkbox';
      checkbox.checked = node.done;
      checkbox.addEventListener('change', () => {
        node.done = checkbox.checked;
        saveData(nodesRaw);
        render();
      });
    } else {
      checkbox.type = 'checkbox';
      checkbox.disabled = true;
      checkbox.title = 'Sub-list has no done state';
    }

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = node.title;
    titleInput.className = 'label';
    titleInput.addEventListener('change', () => {
      node.title = titleInput.value;
      saveData(nodesRaw);
      render();
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

    const elements = [checkbox, titleInput, removeButton];

    let contextMenu = null;
    let closeMenu = null;

    const addMenuAction = (button) => {
      button.className = 'small-button';
      button.style.width = '100%';
      button.addEventListener('click', () => {
        if (closeMenu) closeMenu();
      });
      if (contextMenu) contextMenu.appendChild(button);
    };

    if (node.type === 'list') {
      const contextToggle = document.createElement('button');
      contextToggle.textContent = '⋮';
      contextToggle.className = 'small-button';

      contextMenu = document.createElement('div');
      contextMenu.className = 'context-menu';

      closeMenu = () => contextMenu.classList.remove('open');
      contextToggle.addEventListener('click', () => {
        contextMenu.classList.toggle('open');
      });

      elements.push(contextToggle);
      const addChildItem = document.createElement('button');
      addChildItem.textContent = '+Item';
      addChildItem.addEventListener('click', () => {
        node.children.push(createNode());
        saveData(nodesRaw);
        render();
      });

      const addChildList = document.createElement('button');
      addChildList.textContent = '+Sub-list';
      addChildList.addEventListener('click', () => {
        node.children.push(createListNode());
        saveData(nodesRaw);
        render();
      });

      const childDoneAll = document.createElement('button');
      childDoneAll.textContent = 'Set Descendants Done';
      childDoneAll.addEventListener('click', () => {
        setTreeDone([node], true, true);
        saveData(nodesRaw);
        render();
      });

      const childNotDoneAll = document.createElement('button');
      childNotDoneAll.textContent = 'Set Descendants Not Done';
      childNotDoneAll.addEventListener('click', () => {
        setTreeDone([node], false, true);
        saveData(nodesRaw);
        render();
      });

      const thisLevelDone = document.createElement('button');
      thisLevelDone.textContent = 'Level Done';
      thisLevelDone.addEventListener('click', () => {
        setTreeDone(node.children, true, false);
        saveData(nodesRaw);
        render();
      });

      const thisLevelNotDone = document.createElement('button');
      thisLevelNotDone.textContent = 'Level Not Done';
      thisLevelNotDone.addEventListener('click', () => {
        setTreeDone(node.children, false, false);
        saveData(nodesRaw);
        render();
      });

      addMenuAction(addChildItem);
      addMenuAction(addChildList);
      addMenuAction(childDoneAll);
      addMenuAction(childNotDoneAll);
      if (level > 0) {
        addMenuAction(thisLevelDone);
        addMenuAction(thisLevelNotDone);
      }
    }

    wrapper.append(...elements);
    if (node.type === 'list' && contextMenu) {
      wrapper.appendChild(contextMenu);
    }
    li.appendChild(wrapper);

    if (node.type === 'list' && node.children.length > 0) {
      const childContainer = document.createElement('div');
      renderTree(node.children, childContainer, level + 1);
      li.appendChild(childContainer);
    }
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

function render() {
  const container = document.getElementById('tree');
  if (!container) return;
  renderTree(nodesRaw.children, container);
}

function registerControls() {
  const addItem = document.getElementById('add-item');
  const addList = document.getElementById('add-list');
  const globalMarkAllDone = document.getElementById('global-mark-all-done');
  const globalMarkAllNotDone = document.getElementById('global-mark-all-not-done');

  if (addItem) {
    addItem.addEventListener('click', () => {
      nodesRaw.children.push(createNode());
      saveData(nodesRaw);
      render();
    });
  }

  if (addList) {
    addList.addEventListener('click', () => {
      nodesRaw.children.push(createListNode());
      saveData(nodesRaw);
      render();
    });
  }

  if (globalMarkAllDone) {
    globalMarkAllDone.addEventListener('click', () => {
      setTreeDone(nodesRaw.children, true, true);
      saveData(nodesRaw);
      render();
      document.getElementById('global-context')?.classList.remove('open');
    });
  }

  if (globalMarkAllNotDone) {
    globalMarkAllNotDone.addEventListener('click', () => {
      setTreeDone(nodesRaw.children, false, true);
      saveData(nodesRaw);
      render();
      document.getElementById('global-context')?.classList.remove('open');
    });
  }

  const globalContextToggle = document.getElementById('global-context-toggle');
  const globalContext = document.getElementById('global-context');
  const globalExport = document.getElementById('global-export');
  const globalImport = document.getElementById('global-import');

  if (globalContextToggle && globalContext) {
    globalContextToggle.addEventListener('click', () => {
      globalContext.classList.toggle('open');
    });

    document.addEventListener('click', (evt) => {
      if (!globalContext.contains(evt.target) && evt.target !== globalContextToggle) {
        globalContext.classList.remove('open');
      }
    });
  }

  if (globalExport) {
    globalExport.addEventListener('click', () => {
      exportData();
      globalContext?.classList.remove('open');
    });
  }

  if (globalImport) {
    globalImport.addEventListener('click', () => {
      promptImportData();
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
    closeAbout.addEventListener('click', closeAboutDialog);
  }

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
  document.title = 'Checklist PWA';
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
