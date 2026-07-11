// このページはmypage.jsからiframeで埋め込まれる。2通りの使われ方がある：
//   ?category=カテゴリーID → カテゴリー内の全員参加グループチャット
//   ?dm=DM_ID              → メンバー同士の1対1の個人チャット
// メッセージの表示・既読・画像の圧縮/拡大表示のロジックはどちらも共通で、
// 保存先のFirestoreコレクションだけが違う
// （categories/カテゴリーID/messages ⇔ dms/DM_ID/messages）。
const params = new URLSearchParams(location.search);
const CATEGORY_ID = params.get('category') || null;
const DM_ID = params.get('dm') || null;
const IS_DM = !CATEGORY_ID && !!DM_ID;

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
const messagesRef = IS_DM
  ? db.collection('dms').doc(DM_ID).collection('messages')
  : db.collection('categories').doc(CATEGORY_ID || 'default').collection('messages');

// 個人チャットのときは、見出しの説明文をそれっぽく変えておく
if (IS_DM) {
  const subEl = document.querySelector('.chat-sub');
  if (subEl) subEl.textContent = '1対1でリアルタイムにやり取りできます';
}

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

// ------------------------------------------------------------
// 「既読」表示：今このChatタブが実際に画面に表示されているかどうか。
// iframe自体はタブを切り替えても裏で読み込まれたままなので、mypage.js側
// から「今表示中/非表示になった」をpostMessageで教えてもらう必要がある
// （そうしないと、見ていないのに既読が付いてしまう）。
// 初回読み込み時（isChatVisibleの初期値）は「このタブを開いたから読み込まれた」
// ケースがほとんどなので、trueにしておく。
// ------------------------------------------------------------
let isChatVisible = true;
const markedReadIds = new Set(); // 既に既読を付け終えたメッセージID（同じ書き込みを繰り返さないため）

if (window.parent && window.parent !== window) {
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'tb-members-update') {
      if (Array.isArray(e.data.members)) knownMembers = e.data.members;
      if (e.data.me && e.data.me.email) { myEmail = e.data.me.email; myName = e.data.me.name; }
      render(); // 自分／他人の色・名前が確定した可能性があるので再描画
      // Firestoreの初回スナップショットは、このpostMessageで「自分が誰か」が
      // 確定するより先に届くことがある。その場合markVisibleMessagesRead()は
      // email不明のまま何もせず終わってしまうので、ここで確定した直後に
      // もう一度試す（そうしないと既読が永遠に付かないことがある）。
      markVisibleMessagesRead();
    }
    if (e.data && e.data.type === 'tb-panel-visibility') {
      isChatVisible = !!e.data.visible;
      if (isChatVisible) markVisibleMessagesRead();
    }
  });
  window.parent.postMessage({ type: 'tb-request-members' }, '*');
}

// 今表示中のメッセージのうち、自分以外が送っていて、まだ自分が既読を
// 付けていないものに、自分のメールアドレスを既読者リスト（readBy）へ追加する。
// LINEのグループチャットと同じで、「開いて見た」ことをもって既読扱いにする
// （1件ずつスクロールして見た範囲を厳密に判定はしない、簡易版）。
function markVisibleMessagesRead() {
  if (!isChatVisible) return;
  const email = getCurrentAuthor().email;
  if (!email) return;
  messages.forEach(m => {
    if (m.authorEmail === email) return; // 自分の投稿は既読対象外
    if (markedReadIds.has(m.id)) return;
    if (Array.isArray(m.readBy) && m.readBy.includes(email)) { markedReadIds.add(m.id); return; }
    markedReadIds.add(m.id);
    messagesRef.doc(m.id).update({
      readBy: firebase.firestore.FieldValue.arrayUnion(email),
    }).catch(err => console.warn('既読の更新に失敗しました', err));
  });
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

// ------------------------------------------------------------
// 写真のライトボックス：送信済みの写真をタップすると、画面いっぱいに
// 大きく表示する（✕ボタン、または背景クリックで閉じる）。
// ------------------------------------------------------------
const chatImageLightbox = document.getElementById('chatImageLightbox');
const chatImageLightboxImg = document.getElementById('chatImageLightboxImg');
const chatImageLightboxClose = document.getElementById('chatImageLightboxClose');

function openImageLightbox(url) {
  if (!chatImageLightbox || !chatImageLightboxImg || !url) return;
  chatImageLightboxImg.src = url;
  chatImageLightbox.style.display = 'flex';
}
function closeImageLightbox() {
  if (!chatImageLightbox) return;
  chatImageLightbox.style.display = 'none';
  if (chatImageLightboxImg) chatImageLightboxImg.src = '';
}
if (chatImageLightboxClose) chatImageLightboxClose.addEventListener('click', closeImageLightbox);
if (chatImageLightbox) {
  chatImageLightbox.addEventListener('click', (e) => {
    if (e.target === chatImageLightbox) closeImageLightbox(); // 背景部分をクリックしたときだけ閉じる
  });
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

  messages.forEach((m, idx) => {
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

    if (m.imageUrl) {
      const img = document.createElement('img');
      img.className = 'chat-image';
      img.src = m.imageUrl;
      img.alt = '送信された画像（タップで拡大表示）';
      img.addEventListener('click', () => openImageLightbox(m.imageUrl));
      col.appendChild(img);
    }

    if (m.text) {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.style.background = isMine ? colorForAuthor(myResolvedEmail) : '';
      bubble.textContent = m.text; // textContentでそのまま入れるのでHTMLとして解釈されない（XSS対策）
      col.appendChild(bubble);
    }

    // 自分が送ったメッセージにだけ、何人が既読を付けたか（自分以外の読んだ人数）を表示する。
    // LINEのグループチャットで見る「既読3」と同じ考え方。
    // タップすると、実際に誰が読んだか（名前）を確認できるようにする。
    if (isMine) {
      const readers = Array.isArray(m.readBy) ? m.readBy.filter(e => e !== m.authorEmail) : [];
      if (readers.length > 0) {
        const readWrap = document.createElement('div');
        readWrap.className = 'chat-read-wrap';

        const readBtn = document.createElement('button');
        readBtn.type = 'button';
        readBtn.className = 'chat-read';
        readBtn.textContent = readers.length > 1 ? `既読 ${readers.length}` : '既読';
        readBtn.setAttribute('aria-label', '既読した人を見る');

        const detail = document.createElement('div');
        detail.className = 'chat-read-detail';
        detail.style.display = 'none';
        const names = readers.map(email => {
          const known = knownMembers.find(x => x.email === email);
          return (known && known.name) || email;
        });
        detail.textContent = names.join('、') + 'さんが既読';

        readBtn.addEventListener('click', () => {
          detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
        });

        readWrap.appendChild(readBtn);
        readWrap.appendChild(detail);
        col.appendChild(readWrap);
      }
    }

    // 同じ人が同じ時刻（分単位）に連続して送っている場合、時刻はそのかたまりの
    // 一番新しいメッセージにだけ表示する（LINEのように、毎回は表示しない）
    const currentTime = formatTime(m.createdAt);
    const next = messages[idx + 1];
    const groupedWithNext = next && next.authorEmail === m.authorEmail && formatTime(next.createdAt) === currentTime;
    if (!groupedWithNext) {
      const timeEl = document.createElement('div');
      timeEl.className = 'chat-time';
      timeEl.textContent = currentTime;
      col.appendChild(timeEl);
    }

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
  markVisibleMessagesRead(); // 今画面を見ているなら、届いたばかりのメッセージにも既読を付ける
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

// ------------------------------------------------------------
// 画像の選択：選んだ直後には送らず、まずプレビュー表示だけする。
// 実際に送るのは「送信」ボタン（またはEnter）を押したタイミング。
//
// ※ 当初はFirebase Storageにアップロードする実装にしていたが、この
// プロジェクトではStorageがまだ有効化されておらず（無料のSparkプランのままだと
// 有効化にBlazeプランへの変更＝クレジットカード登録が必要になる場合がある）、
// 学生プロジェクトとしてそこまでは求めないことにした。代わりに、画像を
// ブラウザ上でリサイズ・圧縮してBase64文字列に変換し、Firestoreの
// メッセージドキュメントにそのまま保存する方式にしている（Storageが不要で
// 今すぐ動く）。Firestoreの1ドキュメントの上限（約1MiB）に収まるよう、
// 圧縮後のサイズもチェックする。
// ------------------------------------------------------------
const chatImageBtn = document.getElementById('chatImageBtn');
const chatImageInput = document.getElementById('chatImageInput');
const chatUploadStatus = document.getElementById('chatUploadStatus');
const chatImagePreview = document.getElementById('chatImagePreview');
const chatImagePreviewImg = document.getElementById('chatImagePreviewImg');
const chatImagePreviewRemove = document.getElementById('chatImagePreviewRemove');
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB（選択時点での元ファイルサイズの上限。送信時にリサイズ・圧縮するのでこれくらいまでは許容する）
const MAX_FIRESTORE_IMAGE_CHARS = 900 * 1024; // 圧縮後のBase64文字列の上限（Firestoreの1ドキュメント約1MiB制限に収まるように余裕を持たせる）

// 画像をcanvasで最大900pxにリサイズし、JPEGとして再圧縮してBase64（data URL）にする。
// スマホ写真のような大きい画像でもFirestoreの上限に収まるようにするため。
function fileToCompressedDataUrl(file, maxDim = 900, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('ファイルの読み込みに失敗しました'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

let pendingImageFile = null;
let pendingImagePreviewUrl = null;
let isSending = false;

function setPendingImage(file) {
  clearPendingImage();
  pendingImageFile = file;
  pendingImagePreviewUrl = URL.createObjectURL(file);
  if (chatImagePreviewImg) chatImagePreviewImg.src = pendingImagePreviewUrl;
  if (chatImagePreview) chatImagePreview.style.display = 'flex';
}

function clearPendingImage() {
  if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl);
  pendingImageFile = null;
  pendingImagePreviewUrl = null;
  if (chatImagePreview) chatImagePreview.style.display = 'none';
  if (chatImagePreviewImg) chatImagePreviewImg.src = '';
}

if (chatImagePreviewRemove) {
  chatImagePreviewRemove.addEventListener('click', () => clearPendingImage());
}

if (chatImageBtn && chatImageInput) {
  chatImageBtn.addEventListener('click', () => chatImageInput.click());

  chatImageInput.addEventListener('change', () => {
    const file = chatImageInput.files && chatImageInput.files[0];
    chatImageInput.value = ''; // 同じファイルを続けて選んでもchangeが発火するようにリセット
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showUploadStatus('画像ファイルを選んでください。', true);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showUploadStatus('画像が大きすぎます（15MBまで）。', true);
      return;
    }
    setPendingImage(file);
  });
}

function showUploadStatus(text, isError) {
  if (!chatUploadStatus) return;
  chatUploadStatus.textContent = text;
  chatUploadStatus.classList.toggle('is-error', !!isError);
  clearTimeout(showUploadStatus._t);
  // エラーは原因を確認してもらうまで消さずに残す。成功時の「送信中…」表示だけ
  // 自動で消す（成功時は最後にshowUploadStatus('', false)で明示的にクリアしている）。
  if (text && !isError) {
    showUploadStatus._t = setTimeout(() => { chatUploadStatus.textContent = ''; }, 4000);
  }
}

// テキスト・画像（プレビュー中のもの）どちらか、または両方をまとめて送信する。
// 失敗した場合は入力内容・プレビューを消さずに残し、もう一度「送信」を押せば
// やり直せるようにする。
async function sendMessage() {
  const text = chatInput.value.trim();
  const imageFile = pendingImageFile;
  if (!text && !imageFile) return;
  if (isSending) return;
  isSending = true;

  const author = getCurrentAuthor();
  try {
    let imageDataUrl = null;
    if (imageFile) {
      showUploadStatus('画像を処理中…', false);
      imageDataUrl = await fileToCompressedDataUrl(imageFile);
      if (imageDataUrl.length > MAX_FIRESTORE_IMAGE_CHARS) {
        throw new Error('画像を圧縮しても大きすぎました。もう少しシンプルな画像を試してください。');
      }
    }

    const payload = {
      authorEmail: author.email,
      authorName: author.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (text) payload.text = text;
    if (imageDataUrl) payload.imageUrl = imageDataUrl;
    await messagesRef.add(payload);

    // 送信できたときだけ、入力欄とプレビューをクリアする
    chatInput.value = '';
    autoResizeInput();
    clearPendingImage();
    if (imageFile) showUploadStatus('', false);
  } catch (err) {
    console.error('メッセージの送信に失敗しました', err);
    // 原因が分かるよう、エラーコード／メッセージをそのまま画面に出す
    const detail = err && (err.code || err.message) ? `（${err.code || ''}${err.code && err.message ? ' : ' : ''}${err.message || ''}）` : '';
    showUploadStatus(`送信に失敗しました${detail}`, true);
  } finally {
    isSending = false;
  }
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
