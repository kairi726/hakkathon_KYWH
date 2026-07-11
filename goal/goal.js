// このページはmypage.jsからiframeで埋め込まれ、
// ?category=カテゴリーID というクエリパラメータが付けて渡されてくる。
// 以前は mypage.js の EMBED_PAGES に 'goal' が登録されておらず、
// このページだけ ?category= が渡されないまま常に同じキーを見ていたため、
// カテゴリーを切り替えても円グラフの中身が変わらなかった。
// todo/script.js と同じ組み立て方でキーを作ることで、Todoの内容と一致させる。
const params = new URLSearchParams(location.search);
const CATEGORY_ID = params.get('category') || 'default';

const USER_KEY = 'tb_current_user';
const COLOR_PALETTE = ['#ffcfda','#fff5b7','#c8f7c5','#e9d5ff','#cffafe','#e5aad2'];

// ------------------------------------------------------------
// Firebase（mypage.js・todo/script.jsと同じプロジェクト・同じ設定）
// ------------------------------------------------------------
// 以前はTodoの件数をlocalStorage（この端末だけ）から読んでいたため、
// 他のメンバーが追加したタスクがこの円グラフに反映されなかった。
// todo/script.jsと同じFirestoreコレクションを購読することで、
// 誰が・どの端末でタスクを追加してもリアルタイムで反映されるようにする。
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
const categoryDocRef = db.collection('categories').doc(CATEGORY_ID);
const todosRef = categoryDocRef.collection('todos');
let latestTodos = [];

// ------------------------------------------------------------
// Target（目標）欄の保存
// ------------------------------------------------------------
// 以前はこのテキストエリアに保存・読み込みの処理が一切無く、
// 何を書いても再読み込みすれば消え、他のメンバーにも共有されていなかった。
// mypage.js（以前のGoalタブ）と同じ categories/カテゴリーID/goal/main
// ドキュメントを使い、targetフィールドとして保存する。
// ------------------------------------------------------------
const goalDocRef = categoryDocRef.collection('goal').doc('main');
const goalInfoTextEl = document.getElementById('goalInfoText');
let goalSaveTimer = null;

if (goalInfoTextEl) {
  goalDocRef.onSnapshot(doc => {
    if (!doc.exists) return;
    const data = doc.data() || {};
    // 自分が今まさに入力中のときは上書きしない（他人の更新が来てもカーソル位置や
    // 入力中の文字が消えないようにするため）
    if (document.activeElement !== goalInfoTextEl) {
      goalInfoTextEl.value = data.target || data.text || '';
    }
  }, err => console.error('目標欄の購読に失敗しました', err));

  goalInfoTextEl.addEventListener('input', () => {
    clearTimeout(goalSaveTimer);
    goalSaveTimer = setTimeout(() => {
      goalDocRef.set({
        target: goalInfoTextEl.value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch(err => console.error('目標欄の保存に失敗しました', err));
    }, 500);
  });
}

let members = [];

const memberList = document.getElementById('memberList');
const taskLegend = document.getElementById('taskLegend');
const chartCanvas = document.getElementById('taskChart');
const ctx = chartCanvas ? chartCanvas.getContext('2d') : null;

// ------------------------------------------------------------
// 「未着手のまま何日放置されているか」の自動判定（todo/script.jsと共通の考え方）
// ------------------------------------------------------------
// createdAtはFirestoreのserverTimestamp()で保存されているためTimestampオブジェクトで
// 届く。追加直後でまだサーバー確定前だとnullのことがあるので、その場合は
// 「今作ったばかり」= 0日として扱う。
const NEGLECT_THRESHOLD_DAYS = 0; // これ以上「未着手」のままならランキングに数える（0日=作成直後から即カウント。動作確認用）

function toMillis(ts) {
  if (!ts) return Date.now();
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return Date.now();
}

function escHtmlLocal(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ------------------------------------------------------------
// Memberリスト（mypage.js）との色の連携
// ------------------------------------------------------------
// 以前は担当者の「名前」が一致するかどうかと、表示順のインデックスだけで
// 色を決めていたため、自分以外のメンバーの色がMemberリストや表示順によって
// 変わってしまっていた。親ページ（mypage.js）がMemberリストの色を確定させた
// タイミングでpostMessageしてくれるので、それをメールアドレスで突き合わせて
// 使うことで、円グラフの色もMemberリスト・Todoの担当者色と完全に一致させる。
// ------------------------------------------------------------
let knownMembers = []; // [{ email, name, color }, ...]
// 「自分が誰か」もpostMessageで受け取る（HTMLファイルを直接開いた場合=file://だと
// 親ページのlocalStorageがこのiframeから見えないことがあるため、loadStoredUser()
// だけに頼らずこちらを優先する）
let myEmail = null;
let myName = null;

function findMemberByEmail(email) {
  return knownMembers.find(m => m.email === email) || null;
}

if (window.parent && window.parent !== window) {
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'tb-members-update' && Array.isArray(e.data.members)) {
      knownMembers = e.data.members;
      if (e.data.me && e.data.me.email) { myEmail = e.data.me.email; myName = e.data.me.name; }
      init(); // 色・件数・自分の判定が変わっている可能性があるので再描画
    }
  });
  window.parent.postMessage({ type: 'tb-request-members' }, '*');
}

function loadStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY)) || null;
  } catch (e) {
    return null;
  }
}

// アカウント(メールアドレス)ごとに保存されているプロフィール(名前・お気に入りの色)を読む。
// mypage.js側の tb_profile_<email> と同じキーの作り方に合わせてある。
function loadUserProfile(email) {
  if (!email) return null;
  try {
    return JSON.parse(localStorage.getItem('tb_profile_' + email.trim().toLowerCase())) || null;
  } catch (e) {
    return null;
  }
}

function loadTodos() {
  return latestTodos;
}

function getMemberColor(name, index) {
  const currentUser = loadStoredUser();
  const normalizedName = (name || '').trim();

  if (currentUser && currentUser.name && normalizedName === currentUser.name) {
    // 自分自身の場合は、最新のプロフィールに保存されている色を優先する
    // （currentUser.favoriteColorがログイン時点のキャッシュなのに対し、
    //   プロフィールは「色を決定」ボタンを押すたびに更新されるため）
    const profile = loadUserProfile(currentUser.email);
    return (profile && profile.favoriteColor) || currentUser.favoriteColor || COLOR_PALETTE[index % COLOR_PALETTE.length];
  }

  if (normalizedName === '未定') {
    return '#d9d9d9';
  }

  return COLOR_PALETTE[(index + 1) % COLOR_PALETTE.length];
}

// メールアドレスで固定された色を使う版（mypage.jsからメンバー情報を
// 受け取れているときはこちらを使う）
function buildMembersFromKnown() {
  const currentEmail = myEmail || loadStoredUser()?.email || null;
  const memberMap = new Map(); // key: email（不明分は '未定' 固定キー）

  knownMembers.forEach(m => {
    memberMap.set(m.email, { name: m.name, email: m.email, count: 0, color: m.color });
  });

  loadTodos().forEach(todo => {
    if (todo.assigneeEmail && memberMap.has(todo.assigneeEmail)) {
      memberMap.get(todo.assigneeEmail).count += 1;
      return;
    }
    // メールアドレスが分からない（古いデータ、または担当者未定）タスクはまとめる
    if (!memberMap.has('__unassigned__')) {
      memberMap.set('__unassigned__', { name: '未定', email: null, count: 0, color: '#d9d9d9' });
    }
    memberMap.get('__unassigned__').count += 1;
  });

  return Array.from(memberMap.values())
    .filter(m => m.count > 0 || m.email === currentEmail) // 自分は0件でも表示、それ以外は0件なら省く
    .sort((a, b) => {
      if (a.email === currentEmail) return -1;
      if (b.email === currentEmail) return 1;
      return b.count - a.count || a.name.localeCompare(b.name, 'ja');
    });
}

// 従来の名前一致＋インデックスによる版（mypage.jsからメンバー情報を
// まだ受け取れていない・単体で開いた場合のフォールバック）
function buildMembersLegacy() {
  const currentUser = loadStoredUser();
  const currentUserName = currentUser?.name || 'あなた';
  const currentUserProfile = currentUser ? loadUserProfile(currentUser.email) : null;
  const memberMap = new Map();

  memberMap.set(currentUserName, {
    name: currentUserName,
    count: 0,
    color: (currentUserProfile && currentUserProfile.favoriteColor) || currentUser?.favoriteColor || COLOR_PALETTE[0],
  });

  loadTodos().forEach((todo, index) => {
    const assignee = (todo.assignee || '未定').trim() || '未定';
    const key = assignee === '未定' ? '未定' : assignee;

    if (!memberMap.has(key)) {
      memberMap.set(key, {
        name: key,
        count: 0,
        color: getMemberColor(key, index),
      });
    }

    memberMap.get(key).count += 1;
  });

  return Array.from(memberMap.values()).sort((a, b) => {
    if (a.name === currentUserName) return -1;
    if (b.name === currentUserName) return 1;
    return b.count - a.count || a.name.localeCompare(b.name, 'ja');
  });
}

function buildMembers() {
  return knownMembers.length > 0 ? buildMembersFromKnown() : buildMembersLegacy();
}

function renderMembers() {
  if (!memberList) return;
  memberList.innerHTML = '';
  members.forEach(member => {
    const item = document.createElement('li');
    item.className = 'member-item';
    item.innerHTML = `
      <div class="member-badge" style="background:${member.color}">${member.name.slice(0, 1)}</div>
      <div class="member-meta">
        <div class="member-name">${member.name}</div>
        <div class="member-tasks">タスク ${member.count} 件</div>
      </div>
    `;
    memberList.appendChild(item);
  });
}

function renderLegend(total) {
  if (!taskLegend) return;
  taskLegend.innerHTML = '';
  members.forEach(member => {
    const percent = total > 0 ? Math.round((member.count / total) * 100) : 0;
    const item = document.createElement('li');
    item.className = 'legend-item';
    item.innerHTML = `
      <span class="legend-dot" style="background:${member.color}"></span>
      <div class="legend-text">
        <span>${member.name}</span>
        <span>${member.count} 件 / ${percent}%</span>
      </div>
    `;
    taskLegend.appendChild(item);
  });
}

// ===== 放置ランキング =====
// 「未着手 or 進行中のまま」NEGLECT_THRESHOLD_DAYS日以上経過しているタスクの件数を
// 担当者ごとに数える（「完了」だけを対象外にする）。担当者はメールアドレスで
// Memberリストと突き合わせ、表示名・色をMemberリスト・円グラフと完全に一致させる。
function buildNeglectRanking() {
  const counts = new Map(); // key: email(不明時はテキストのまま), value: {name, count}

  loadTodos().forEach(todo => {
    if (todo.status === 'completed') return;
    const days = Math.floor((Date.now() - toMillis(todo.createdAt)) / (1000 * 60 * 60 * 24));
    if (days < NEGLECT_THRESHOLD_DAYS) return;

    const member = todo.assigneeEmail ? findMemberByEmail(todo.assigneeEmail) : null;
    const key = todo.assigneeEmail || (todo.assignee || '未定');
    const name = (member && member.name) || todo.assignee || '未定';

    if (!counts.has(key)) counts.set(key, { name, count: 0 });
    counts.get(key).count += 1;
  });

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
}

// 既存の .legend-card / .legend-list / .legend-item / .legend-dot / .legend-text を
// そのまま再利用して作る。新しいCSSを増やさずに元のデザインへ自然に馴染ませるため。
function renderNeglectRanking(ranking) {
  let container = document.getElementById('neglectRanking');
  if (!container) {
    container = document.createElement('div');
    container.id = 'neglectRanking';
    container.className = 'legend-card';
    container.style.marginTop = '18px';
    const chartMeta = taskLegend ? taskLegend.closest('.chart-meta') : null;
    const anchor = chartMeta || (taskLegend && taskLegend.parentElement) || document.body;
    anchor.appendChild(container);
  }

  if (ranking.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = '';
  const rows = ranking.map(r => `
    <li class="legend-item">
      <span class="legend-dot" style="background:${r.count >= 2 ? '#e5766f' : '#e8c25a'}"></span>
      <div class="legend-text">
        <span>${escHtmlLocal(r.name)}</span>
        <span>放置 ${r.count} 件</span>
      </div>
    </li>
  `).join('');

  container.innerHTML = `
    <h3>⚠️ 放置ランキング</h3>
    <ul class="legend-list">${rows}</ul>
  `;
}

function drawChart(total) {
  if (!chartCanvas || !ctx) return;

  const centerX = chartCanvas.width / 2;
  const centerY = chartCanvas.height / 2;
  const radius = Math.min(centerX, centerY) - 24;
  let startAngle = -Math.PI / 2;

  ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);

  if (total <= 0) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#e5ddd1';
    ctx.lineWidth = 24;
    ctx.stroke();
  } else {
    members.forEach(member => {
      const sliceAngle = (member.count / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = member.color;
      ctx.fill();
      startAngle += sliceAngle;
    });
  }

  ctx.beginPath();
  ctx.fillStyle = '#f7f4ef';
  ctx.arc(centerX, centerY, radius * 0.55, 0, Math.PI * 2);
  ctx.fill();

  // 中央表示：タスクがあるときは総件数を表示する（以前は'負荷' / '割合'を表示していた）
  ctx.font = '700 28px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#4b443e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total > 0 ? String(total) : '0', centerX, centerY - 8);
  ctx.font = '500 14px "Noto Sans JP", sans-serif';
  ctx.fillText('件', centerX, centerY + 20);
}

// 放置ランキングは日をまたいだ瞬間にも自動で更新されるよう、1分ごとに再計算する
setInterval(() => {
  if (latestTodos.some(t => t.status !== 'completed')) {
    renderNeglectRanking(buildNeglectRanking());
  }
}, 60 * 1000);

function init() {
  members = buildMembers();
  const total = members.reduce((sum, member) => sum + member.count, 0);
  if (memberList) renderMembers();
  if (taskLegend) renderLegend(total);
  drawChart(total);
  renderNeglectRanking(buildNeglectRanking());
}

// Todoの内容をリアルタイムで購読する（他のメンバーが別の端末で追加・変更しても
// すぐこの円グラフに反映される。以前使っていた'storage'イベントは同一ブラウザの
// 別タブにしか届かず、他のメンバーの端末には届かなかった）
todosRef.onSnapshot(snap => {
  latestTodos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  init();
}, err => console.error('Todoの購読に失敗しました', err));

window.addEventListener('DOMContentLoaded', init);