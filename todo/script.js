// このページはmypage.jsからiframeで埋め込まれ、
// ?category=カテゴリーID というクエリパラメータが付けて渡されてくる。
// 以前はこのパラメータを一切見ておらず、TODO_STORAGE_KEYが
// 'todo-items' という固定の1つのキーだったため、
// 別のカテゴリーを開いても同じTodoリストが表示されてしまっていた。
const params = new URLSearchParams(location.search);
const CATEGORY_ID = params.get('category') || 'default';
const TODO_STORAGE_KEY = 'todo-items-' + CATEGORY_ID;

// ------------------------------------------------------------
// 担当者の色を固定するための、Memberリストとの連携
// ------------------------------------------------------------
// 以前は「担当者」が自由入力のテキストで、名前が一致するかどうかでしか
// 判定できなかったため、同じ人でも表示順によって色がバラバラになっていた。
// 親ページ（mypage.js）がMemberリストの色を確定させたタイミングで
// postMessageで教えてくれるので、それを使ってメールアドレス単位で
// 担当者を選べるようにし、色もMemberリストと完全に一致させる。
// ------------------------------------------------------------
let knownMembers = []; // [{ email, name, color }, ...]

function findMemberByEmail(email) {
  return knownMembers.find(m => m.email === email) || null;
}

// 担当者の色。メールアドレスでMemberリストと一致すればその固定色を使う。
// 古いデータ（assigneeEmailが無い）や、メンバーが見つからない場合は
// 「未定」は固定のグレー、それ以外は名前から作った固定色にフォールバックする。
function colorForAssignee(todo) {
  if (todo.assigneeEmail) {
    const member = findMemberByEmail(todo.assigneeEmail);
    if (member) return member.color;
  }
  const name = (todo.assignee || '未定').trim() || '未定';
  if (name === '未定') return '#d9d9d9';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palette = ['#f3b6b7', '#fef5c1', '#ebd0b3', '#c3bad3', '#cee3be', '#e4b8cf'];
  return palette[Math.abs(hash) % palette.length];
}

function populateAssigneeOptions() {
  const select = document.getElementById('assignee-input');
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">未定</option>' + knownMembers.map(m =>
    `<option value="${m.email.replace(/"/g, '&quot;')}">${m.name}</option>`
  ).join('');
  // 選択中だった担当者がまだリストにいればそのまま復元する
  if (knownMembers.some(m => m.email === currentValue)) {
    select.value = currentValue;
  }
}

if (window.parent && window.parent !== window) {
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'tb-members-update' && Array.isArray(e.data.members)) {
      knownMembers = e.data.members;
      populateAssigneeOptions();
      renderTodos(); // 色が変わっている可能性があるので再描画
    }
  });
  // 親ページ（mypage.js）に、今のメンバー情報をちょうだいとお願いする
  // （読み込みタイミングによっては親が先にbroadcastし終えている場合もあるが、
  //   その場合も親側は選択中カテゴリーが変わるたびに再度broadcastしてくれる）
  window.parent.postMessage({ type: 'tb-request-members' }, '*');
}

function loadTodos() {
  try {
    return JSON.parse(localStorage.getItem(TODO_STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveTodos() {
  localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todos));
  window.dispatchEvent(new Event('todo-data-updated'));
}

// 初期データは保存済みの内容を読み込む
let todos = loadTodos();

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
    // メールアドレスが分かっていればそちらでグループ化する（同姓同名の別人と
    // 混ざらないようにするため。無ければ従来どおり名前で代用する）
    const key = todo.assigneeEmail || assignee;
    if (!groupMap[key]) {
      groupMap[key] = { assignee, tasks: [] };
      groups.push(groupMap[key]);
    }
    groupMap[key].tasks.push(todo);
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
        <div class="col-assignee">
          <span class="assignee-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:${colorForAssignee(todo)};"></span>${group.assignee}
        </div>
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

  // 担当者はMemberリストから選んだメールアドレス。選ばれていれば表示名は
  // そのメンバーの名前（＝Memberリスト・円グラフと同じ表記）に統一する。
  const assigneeEmail = assigneeInput.value || null;
  const selectedMember = assigneeEmail ? findMemberByEmail(assigneeEmail) : null;
  const assigneeName = selectedMember ? selectedMember.name : '未定';

  const newTodo = {
    id: Date.now(), // 簡易的なユニークID
    task: taskInput.value,
    assignee: assigneeName,
    assigneeEmail: assigneeEmail,
    status: statusInput.value
  };

  todos.push(newTodo);
  saveTodos();
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
  saveTodos();
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
  saveTodos();
  renderTodos();
};

// 初回描画
renderTodos();