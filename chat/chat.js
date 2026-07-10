// このページはmypage.jsからiframeで埋め込まれ、
// ?category=カテゴリーID というクエリパラメータが付けて渡されてくる。
// LINEのようなグループチャットとして、カテゴリーのメンバー全員にリアルタイムで
// 共有されるよう、Firestore（categories/カテゴリーID/messages）に保存する。
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
const categoryDocRef = db.collection('categories').doc(CATEGORY_ID);
const messagesRef = categoryDocRef.collection('messages');

// ------------------------------------------------------------
// 「自分が誰か」「メンバー一覧の色」をmypage.jsから受け取る。
// HTMLファイルを直接開いた場合（file://）はファイルごとに保存領域が分かれて
// しまい、親ページのlocalStorageがこのiframeから見えないことがあるため、
// loadStoredUser()だけに頼らずpostMessage経由の情報を優先する。
// ------------------------------------------------------------
let knownMembers = []; // [{ email, name, color }, ...]
let myEmail = null;
let myName = null;

function loadStoredUser() {
  try { return JSON.parse(localStorage.getItem('tb_current_user')); } catch (e) { return null; }
}

// mypage.js（Member欄）・Todo/Opinion/Goal/Calendarと同じパレット・作り方にそろえる
function fallbackColorFromEmail(email) {
  const palette = ['#ffcfda','#fff5b7','#c8f7c5','#e9d5ff','#cffafe','#e5aad2'];
  let hash = 0;
  const s = String(email || 'guest');
  for (let i = 0; i < s.length; i++) { hash = s.charCodeAt(i) + ((hash << 5) - hash); }
  return palette[Math.abs(hash) % palette.length];
}

function colorForAuthor(email) {
  const m = knownMembers.find(x => x.email === email);
  if (m && m.color) return m.color;
  return fallbackColorFromEmail(email);
}

function getCurrentAuthor() {
  const stored = loadStoredUser();
  const email = myEmail || stored?.email || null;
  const known = email ? knownMembers.find(m => m.email === email) : null;
  const name = (known && known.name) || myName || stored?.name || 'あなた';
  return { email, name };
}

if (window.parent && window.parent !== window) {
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'tb-members-update') {
      if (Array.isArray(e.data.members)) knownMembers = e.data.members;
      if (e.data.me && e.data.me.email) { myEmail = e.data.me.email; myName = e.data.me.name; }
      render(); // 自分／他人の色・名前が確定した可能性があるので再描画
    }
  });
  window.parent.postMessage({ type: 'tb-request-members' }, '*');
}

// ------------------------------------------------------------
// メッセージの表示
// ------------------------------------------------------------
let messages = [];

function formatTime(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '';
  const d = ts.toDate();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function render() {
  const wrap = document.getElementById('chatMessages');
  if (!wrap) return;

  // 自分がメッセージ一覧の一番下を見ているときだけ、新着で自動スクロールする
  // （過去のメッセージを読んでいる途中で下に引っ張られないようにするため）
  const nearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 60;

  wrap.innerHTML = '';

  if (messages.length === 0) {
    wrap.innerHTML = '<div class="chat-empty">まだメッセージがありません。最初のメッセージを送ってみましょう！</div>';
    return;
  }

  // isMineの判定はgetCurrentAuthor()と同じ解決順（postMessageのme→localStorage）を使う。
  // myEmailだけを見てしまうと、postMessageが届く前（や単体テストのような
  // 親iframeが無い状況）で自分のメッセージなのに他人扱いになってしまう。
  const myResolvedEmail = getCurrentAuthor().email;

  messages.forEach(m => {
    const isMine = !!(myResolvedEmail && m.authorEmail === myResolvedEmail);
    const row = document.createElement('div');
    row.className = 'chat-row' + (isMine ? ' chat-row-mine' : '');

    if (!isMine) {
      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      avatar.style.background = colorForAuthor(m.authorEmail);
      avatar.textContent = (m.authorName || m.authorEmail || '?').trim()[0]?.toUpperCase() || '?';
      row.appendChild(avatar);
    }

    const col = document.createElement('div');
    col.className = 'chat-col';

    if (!isMine) {
      const nameEl = document.createElement('div');
      nameEl.className = 'chat-author';
      nameEl.textContent = m.authorName || m.authorEmail || '誰か';
      col.appendChild(nameEl);
    }

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.style.background = isMine ? colorForAuthor(myResolvedEmail) : '';
    bubble.textContent = m.text || ''; // textContentでそのまま入れるのでHTMLとして解釈されない（XSS対策）
    col.appendChild(bubble);

    const timeEl = document.createElement('div');
    timeEl.className = 'chat-time';
    timeEl.textContent = formatTime(m.createdAt);
    col.appendChild(timeEl);

    row.appendChild(col);
    wrap.appendChild(row);
  });

  if (nearBottom) wrap.scrollTop = wrap.scrollHeight;
}

// カテゴリー内の全員に共有されるよう、Firestoreをリアルタイムで購読する。
// 後からカテゴリーに参加した人がこのページを開いても、これまでの
// 会話がそのまま全部表示される。
messagesRef.orderBy('createdAt', 'asc').onSnapshot(snap => {
  messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render();
}, err => console.error('チャットの購読に失敗しました', err));

// ------------------------------------------------------------
// メッセージの送信
// ------------------------------------------------------------
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

function autoResizeInput() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
}
chatInput.addEventListener('input', autoResizeInput);

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  const author = getCurrentAuthor();
  messagesRef.add({
    text,
    authorEmail: author.email,
    authorName: author.name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch(err => console.error('メッセージの送信に失敗しました', err));
  chatInput.value = '';
  autoResizeInput();
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});

// LINEと同じ操作感：Enterで送信、Shift+Enterで改行。
// 日本語入力（IME）の変換確定にもEnterを使うため、e.isComposingで区別し、
// 変換中は誤って送信されないようにする。
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
});
