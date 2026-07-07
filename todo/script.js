// 初期データは空にして、再読み込み時に既存タスクが表示されないようにする
let todos = [];

const listContainer = document.getElementById('todo-list-container');
const todoForm = document.getElementById('todo-form');

// ステータスのテキストとクラスのマッピング
const statusMap = {
  'not-started': { text: '未着手', class: 'status-not-started' },
  'ongoing': { text: '進行中', class: 'status-ongoing' },
  'completed': { text: '完了', class: 'status-completed' }
};

// タスク一覧を描画する関数
function renderTodos() {
  listContainer.innerHTML = ''; // 一度クリア

  const groups = [];
  const groupMap = {};

  todos.forEach(todo => {
    const assignee = todo.assignee || '未定';
    if (!groupMap[assignee]) {
      groupMap[assignee] = { assignee, tasks: [] };
      groups.push(groupMap[assignee]);
    }
    groupMap[assignee].tasks.push(todo);
  });

  groups.forEach(group => {
    group.tasks.forEach((todo) => {
      const row = document.createElement('div');
      row.className = 'table-row' + (todo.status === 'completed' ? ' completed' : '');
      
      const statusInfo = statusMap[todo.status];

      row.innerHTML = `
        <div class="col-check">
          <input type="checkbox" ${todo.status === 'completed' ? 'checked' : ''} onchange="toggleComplete(${todo.id})">
        </div>
        <div class="col-task">・${todo.task}</div>
        <div class="col-assignee">${group.assignee}</div>
        <div class="col-status">
          <select class="status-select" onchange="updateStatus(${todo.id}, this.value)">
            <option value="not-started" ${todo.status === 'not-started' ? 'selected' : ''}>未着手</option>
            <option value="ongoing" ${todo.status === 'ongoing' ? 'selected' : ''}>進行中</option>
            <option value="completed" ${todo.status === 'completed' ? 'selected' : ''}>完了</option>
          </select>
          <span class="status-badge ${statusInfo.class}">${statusInfo.text}</span>
        </div>
        <div class="col-action">
          <button class="delete-btn" onclick="deleteTodo(${todo.id})">削除</button>
        </div>
      `;
      listContainer.appendChild(row);
    });
  });
}

// タスクを追加するイベント
todoForm.addEventListener('submit', (e) => {
  e.preventDefault(); // ページリロードを防ぐ

  const taskInput = document.getElementById('task-input');
  const assigneeInput = document.getElementById('assignee-input');
  const statusInput = document.getElementById('status-input');

  const newTodo = {
    id: Date.now(), // 簡易的なユニークID
    task: taskInput.value,
    assignee: assigneeInput.value || '未定',
    status: statusInput.value
  };

  todos.push(newTodo);
  renderTodos();

  // フォームをリセット
  taskInput.value = '';
  assigneeInput.value = '';
  statusInput.value = 'not-started';
});

// チェックボックス連動でステータスを変更
window.toggleComplete = function(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  const newStatus = todo.status === 'completed' ? 'not-started' : 'completed';
  updateStatus(id, newStatus);
};

// タスクを削除
window.deleteTodo = function(id) {
  todos = todos.filter(todo => todo.id !== id);
  renderTodos();
};

// ステータス更新ユーティリティ
window.updateStatus = function(id, newStatus) {
  todos = todos.map(todo => {
    if (todo.id === id) {
      return Object.assign({}, todo, { status: newStatus });
    }
    return todo;
  });
  renderTodos();
};

// 初回描画
renderTodos();

