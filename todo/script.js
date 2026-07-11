// このページはmypage.jsからiframeで埋め込まれ、
// ?category=カテゴリーID というクエリパラメータが付けて渡されてくる。
//
// 以前はTodoの中身をlocalStorage（この端末・このブラウザだけ）に保存していたため、
// 他のメンバーには一切共有されず、後からカテゴリーに参加した人はもちろん、
// 最初からいたメンバーでも別の端末からは中身が見えなかった。
// カテゴリーに参加している全員にきちんと共有されるよう、Firestore
// （categories/カテゴリーID/todos）に保存するようにする。
const params = new URLSearchParams(location.search);
const CATEGORY_ID = params.get('category') || 'default';

// ------------------------------------------------------------
// Firebase（mypage.jsと同じプロジェクト・同じ設定）
// ------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyA3x07jil3hPvtSsYFnreB-QQhxPGWOHIc",
  authDomain: "kwyh-1219.firebaseapp.com",
  projectId: "kwyh-1219",
  storageBucket: "kwyh-1219.firebasestorage.app",
  messagingSenderId: "497261200413",
  appId: "1:497261200413:web:17465c15d28e1d9e13f2f4",
  measurementId: "G-0ZSW26JXG0",
};
if (!firebase.apps || !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const todosRef = db.collection('categories').doc(CATEGORY_ID).collection('todos');

// ------------------------------------------------------------
// 「助けてー」機能：自分の担当タスクが終わらないときに、同じカテゴリーの
// メンバー全員に助けを求められるようにする。
// ログイン中のユーザー情報はmypage.jsと同じlocalStorage（同一オリジンの
// iframeなので、そのまま同じlocalStorageが読める）から取得する。
// ------------------------------------------------------------
function loadStoredUser() {
  try { return JSON.parse(localStorage.getItem('tb_current_user')); } catch (e) { return null; }
}
// localStorage経由の値はあくまで初期値（ローカルサーバー/https配信ならこれで十分）。
// HTMLファイルを直接開いた場合（file://）はファイルごとに保存領域が分かれてしまい
// 親ページのlocalStorageが見えないため、下のpostMessage（tb-members-update内のme）
// で受け取った値があればそちらを優先して上書きする。
let currentUser = loadStoredUser();

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

// 表示用の担当者名。assigneeEmailからMemberリストを引いて「今の名前」を返す。
// 名前を変更した直後も、保存済みのtodo.assignee（古い名前の可能性がある文字列）
// ではなくこちらを使うことで、名前変更がすぐに一覧へ反映されるようにする。
function displayNameForAssignee(todo) {
  if (todo.assigneeEmail) {
    const member = findMemberByEmail(todo.assigneeEmail);
    if (member) return member.name;
  }
  return (todo.assignee || '未定').trim() || '未定';
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

// 「助けてー」ボタン／バッジのHTML。
// ・自分が担当のタスクは「助けてー」ボタンを直接表示する（選択ステップは無し）。
// ・押すと実際に要請が送られ、以後は同じ場所に「🆘 解決した」が表示される。
// ・「🆘 解決した」を押すと要請が取り下げられ、また「助けてー」に戻る。
// ・他人が担当のタスクで助けを求めている場合は、押せないバッジだけ表示して
//   同じカテゴリーの全員がひと目で気づけるようにする。
// ・リアクション（🙌応援／💪手伝う）は、助けを求めている本人にも他のメンバーにも
//   同じように見える（Firestoreに保存されるので、押した人だけでなく全員に反映される）。
function helpButtonHtml(todo) {
  const isMine = !!(currentUser && todo.assigneeEmail && todo.assigneeEmail === currentUser.email);

  if (!isMine) {
    if (!todo.needsHelp) return '';
    return `<span class="help-badge">🆘 助けてほしい</span>${helpReactionsHtml(todo)}`;
  }

  if (todo.status === 'completed') return '';

  if (todo.needsHelp) {
    return `<button type="button" class="help-btn help-btn-active" onclick="resolveHelp('${todo.id}')">🆘 解決した</button>${helpReactionsHtml(todo)}`;
  }
  return `<button type="button" class="help-btn" onclick="requestHelp('${todo.id}')">助けてー</button>`;
}

// 助けを求めている人への、軽いリアクションボタン。
// （自分がその場で手伝いに行くほどではなくても、「見たよ」「応援してる」を
//   ワンタップで伝えられるようにする）
const HELP_REACTIONS = [
  { emoji: '🙌', label: '応援' },
  { emoji: '💪', label: '手伝う' },
];
function helpReactionsHtml(todo) {
  const reactions = todo.helpReactions || {};
  const myEmail = currentUser ? currentUser.email : null;
  const buttons = HELP_REACTIONS.map(r => {
    // helpReactions[emoji] は「押した人のメールアドレスの配列」。以前は0/1の
    // 単一フラグだったため、誰か1人が押した状態を別の人が押すと自分の分としてではなく
    // その1人分を取り消してしまっていた（＝実質1人しか押せない不具合）。
    // 配列にして、自分が押したかどうかを自分のメールアドレスが含まれているかで判定する。
    const reactors = Array.isArray(reactions[r.emoji]) ? reactions[r.emoji] : [];
    const count = reactors.length;
    const isMine = !!(myEmail && reactors.includes(myEmail));
    return `<button type="button" class="help-reaction-btn${isMine ? ' active' : ''}" title="${r.label}" onclick="toggleHelpReaction('${todo.id}', '${r.emoji}')">${r.emoji}${count > 0 ? ' ' + count : ''}</button>`;
  }).join('');
  return `<span class="help-reactions">${buttons}</span>`;
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
      if (e.data.me && e.data.me.email) currentUser = e.data.me;
      populateAssigneeOptions();
      renderTodos(); // 色・自分の判定が変わっている可能性があるので再描画
    }
  });
  // 親ページ（mypage.js）に、今のメンバー情報をちょうだいとお願いする
  // （読み込みタイミングによっては親が先にbroadcastし終えている場合もあるが、
  //   その場合も親側は選択中カテゴリーが変わるたびに再度broadcastしてくれる）
  window.parent.postMessage({ type: 'tb-request-members' }, '*');
}

// 保存済みの内容はFirestoreのonSnapshotから随時入ってくる
let todos = [];

const listContainer = document.getElementById('todo-list-container');
const todoForm = document.getElementById('todo-form');

// ステータスのテキストとクラスのマッピング
const statusMap = {
  'not-started': { text: '未着手', class: 'status-not-started' },
  'ongoing': { text: '進行中', class: 'status-ongoing' },
  'completed': { text: '完了', class: 'status-completed' }
};

// 表示する並び順：上から「未着手 → 進行中 → 完了」に固定する。
// 以前は担当者ごとにグループ化して表示していたため、削除した担当者の
// 位置に新しいタスクが紛れ込んだように見えたり、完了済みのタスクが
// 上の方に残ったままになったりしていた。
const statusRank = { 'not-started': 0, 'ongoing': 1, 'completed': 2 };

// タスク一覧を描画する関数
function renderTodos() {
  listContainer.innerHTML = ''; // 一度クリア

  // ステータスの順番だけで並べ替える（同じステータス内はFirestoreに
  // 登録した順のまま＝安定ソートなので順番が入れ替わらない）
  const sorted = [...todos].sort((a, b) => (statusRank[a.status] ?? 0) - (statusRank[b.status] ?? 0));

  sorted.forEach((todo) => {
    const row = document.createElement('div');
    row.className = 'table-row' + (todo.status === 'completed' ? ' completed' : '');

    const statusInfo = statusMap[todo.status];

    row.innerHTML = `
      <div class="col-check">
        <input type="checkbox" ${todo.status === 'completed' ? 'checked' : ''} onchange="toggleComplete('${todo.id}')">
      </div>
      <div class="col-task">・${todo.task}</div>
      <div class="col-assignee">
        <span class="assignee-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:${colorForAssignee(todo)};"></span>${displayNameForAssignee(todo)}
      </div>
      <div class="col-status">
        <select class="status-select" onchange="updateStatus('${todo.id}', this.value)">
          <option value="not-started" ${todo.status === 'not-started' ? 'selected' : ''}>未着手</option>
          <option value="ongoing" ${todo.status === 'ongoing' ? 'selected' : ''}>進行中</option>
          <option value="completed" ${todo.status === 'completed' ? 'selected' : ''}>完了</option>
        </select>
        <span class="status-badge ${statusInfo.class}">${statusInfo.text}</span>
      </div>
      <div class="col-action">
        <button class="delete-btn" onclick="deleteTodo('${todo.id}')">削除</button>
        ${helpButtonHtml(todo)}
      </div>
    `;
    listContainer.appendChild(row);
  });
}

// カテゴリー内の全員に共有されるよう、Firestoreをリアルタイムで購読する。
// 後からカテゴリーに参加した人がこのページを開いても、これまでの
// タスクがそのまま全部表示される。
todosRef.orderBy('createdAt', 'asc').onSnapshot(snap => {
  todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderTodos();
}, err => {
  console.error('Todoの購読に失敗しました', err);
});

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
    task: taskInput.value,
    assignee: assigneeName,
    assigneeEmail: assigneeEmail,
    status: statusInput.value,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  todosRef.add(newTodo).catch(err => console.error('タスクの追加に失敗しました', err));

  // フォームをリセット（画面反映はFirestoreのonSnapshotが行う）
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
  todosRef.doc(id).delete().catch(err => console.error('削除に失敗しました', err));
};

// ステータス更新ユーティリティ
window.updateStatus = function(id, newStatus) {
  todosRef.doc(id).update({ status: newStatus }).catch(err => console.error('更新に失敗しました', err));
};

// 「助けてー」を送信：同じカテゴリーの全員に通知が届く（mypage.js側がFirestoreを
// 見てポップアップ・一覧表示する）
window.requestHelp = function(id) {
  todosRef.doc(id).update({
    needsHelp: true,
    helpRequestedByEmail: currentUser ? currentUser.email : null,
    helpRequestedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch(err => console.error('助けて要請の送信に失敗しました', err));
};

// 「解決した」：助けて要請を取り下げる
window.resolveHelp = function(id) {
  todosRef.doc(id).update({ needsHelp: false }).catch(err => console.error('助けて要請の解除に失敗しました', err));
};

// 助けてーへのリアクション（🙌応援／💪手伝う）をワンタップでON/OFFする。
// 全員が独立して押せるように、押した人のメールアドレスを配列に入れておき、
// 自分がすでに押していればもう一度押したときに自分の分だけ取り消す
// （他の人が押した分は消えない）。
window.toggleHelpReaction = function(id, emoji) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  const myEmail = currentUser ? currentUser.email : null;
  if (!myEmail) return; // 自分が誰か分からない場合は何もしない

  const reactions = Object.assign({}, todo.helpReactions || {});
  const reactors = Array.isArray(reactions[emoji]) ? reactions[emoji].slice() : [];
  const idx = reactors.indexOf(myEmail);
  if (idx >= 0) {
    reactors.splice(idx, 1);
  } else {
    reactors.push(myEmail);
  }
  reactions[emoji] = reactors;
  todosRef.doc(id).update({ helpReactions: reactions }).catch(err => console.error('リアクションの更新に失敗しました', err));
};
