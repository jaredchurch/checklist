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

function getData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Invalid saved data', err);
    localStorage.removeItem(KEY);
    return [];
  }
}

function saveData(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

function findNodeById(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNodeById(n.children, id);
    if (found) return found;
  }
  return null;
}

function updateNode(nodes, id, callback) {
  for (const n of nodes) {
    if (n.id === id) {
      callback(n);
      return true;
    }
    if (updateNode(n.children, id, callback)) return true;
  }
  return false;
}

function setTreeDone(nodes, done, includeDescendants = true) {
  for (const n of nodes) {
    if (n.type === 'item') {
      n.done = done;
    }
    if (includeDescendants) {
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
    setLevelDone(n.children, level - 1, done);
  }
}

function renderTree(nodes, container, level = 0) {
  container.innerHTML = '';
  const ul = document.createElement('ul');
  for (const node of nodes) {
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

    const addChildItem = document.createElement('button');
    addChildItem.textContent = '+Item';
    addChildItem.className = 'small-button';
    addChildItem.addEventListener('click', () => {
      if (node.type === 'list') {
        node.children.push(createNode());
      } else {
        node.children.push(createNode());
      }
      saveData(nodesRaw);
      render();
    });

    const addChildList = document.createElement('button');
    addChildList.textContent = '+Sub-list';
    addChildList.className = 'small-button';
    addChildList.addEventListener('click', () => {
      node.children.push(createListNode());
      saveData(nodesRaw);
      render();
    });

    const removeButton = document.createElement('button');
    removeButton.textContent = 'Delete';
    removeButton.className = 'small-button';
    removeButton.addEventListener('click', () => {
      const parent = findParent(nodesRaw, node.id);
      const array = parent ? parent.children : nodesRaw;
      const idx = array.findIndex((c) => c.id === node.id);
      if (idx !== -1) {
        array.splice(idx, 1);
        saveData(nodesRaw);
        render();
      }
    });

    const childDoneAll = document.createElement('button');
    childDoneAll.textContent = 'This+Descendants Done';
    childDoneAll.className = 'small-button';
    childDoneAll.addEventListener('click', () => {
      setTreeDone([node], true, true);
      saveData(nodesRaw);
      render();
    });

    const childNotDoneAll = document.createElement('button');
    childNotDoneAll.textContent = 'This+Descendants Not Done';
    childNotDoneAll.className = 'small-button';
    childNotDoneAll.addEventListener('click', () => {
      setTreeDone([node], false, true);
      saveData(nodesRaw);
      render();
    });

    const thisLevelDone = document.createElement('button');
    thisLevelDone.textContent = 'Level Done';
    thisLevelDone.className = 'small-button';
    thisLevelDone.addEventListener('click', () => {
      setLevelDone(nodesRaw, level, true);
      saveData(nodesRaw);
      render();
    });

    const thisLevelNotDone = document.createElement('button');
    thisLevelNotDone.textContent = 'Level Not Done';
    thisLevelNotDone.className = 'small-button';
    thisLevelNotDone.addEventListener('click', () => {
      setLevelDone(nodesRaw, level, false);
      saveData(nodesRaw);
      render();
    });

    wrapper.append(checkbox, titleInput, addChildItem, addChildList, removeButton, childDoneAll, childNotDoneAll, thisLevelDone, thisLevelNotDone);
    li.appendChild(wrapper);

    if (node.children.length > 0) {
      const childContainer = document.createElement('div');
      renderTree(node.children, childContainer, level + 1);
      li.appendChild(childContainer);
    }
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

function findParent(nodes, childId, parent = null) {
  for (const node of nodes) {
    if (node.id === childId) return parent;
    const found = findParent(node.children, childId, node);
    if (found) return found;
  }
  return null;
}

let nodesRaw = getData();

function render() {
  const container = document.getElementById('tree');
  if (!container) return;
  renderTree(nodesRaw, container);
}

function registerControls() {
  const addRootItem = document.getElementById('add-root-item');
  const addRootList = document.getElementById('add-root-list');
  const markAllDone = document.getElementById('mark-all-done');
  const markAllNotDone = document.getElementById('mark-all-not-done');
  const exportBtn = document.getElementById('export');
  const importInput = document.getElementById('import');

  if (addRootItem) {
    addRootItem.addEventListener('click', () => {
      console.log('addRootItem clicked');
      nodesRaw.push(createNode());
      saveData(nodesRaw);
      render();
    });
  }

  if (addRootList) {
    addRootList.addEventListener('click', () => {
      console.log('addRootList clicked');
      nodesRaw.push(createListNode());
      saveData(nodesRaw);
      render();
    });
  }

  if (markAllDone) {
    markAllDone.addEventListener('click', () => {
      setTreeDone(nodesRaw, true, true);
      saveData(nodesRaw);
      render();
    });
  }

  if (markAllNotDone) {
    markAllNotDone.addEventListener('click', () => {
      setTreeDone(nodesRaw, false, true);
      saveData(nodesRaw);
      render();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const dataString = JSON.stringify(nodesRaw, null, 2);
      const blob = new Blob([dataString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'checklist-backup.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (importInput) {
    importInput.addEventListener('change', async (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error('Invalid file format');
      nodesRaw = imported;
      saveData(nodesRaw);
      render();
      importInput.value = '';
    } catch (error) {
      alert('Import failed: ' + error.message);
      console.error(error);
    }
  });
  }
}

async function fetchCommitInfo() {
  const el = document.getElementById('commit-info');
  if (!el) return;

  const repoOwner = 'jaredchurch';
  const repoName = 'checklist';
  const branch = 'main';
  const url = `https://api.github.com/repos/${repoOwner}/${repoName}/commits/${branch}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const commit = await response.json();
    const hash = commit.sha.slice(0, 7);
    const date = new Date(commit.commit.committer.date).toLocaleString();
    el.textContent = `Commit ${hash} @ ${date}`;
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
  findParent
};
