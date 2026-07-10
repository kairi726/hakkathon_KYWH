const COLORS = ['#f3b6b7','#fef5c1','#ebd0b3','#c3bad3','#cee3be','#e4b8cf']; // 古い付箋（authorが無いデータ）向けのフォールバック用クラス名
let notes = [];
let memoTimer = null;

// ------------------------------------------------------------
// 保存先について
// ------------------------------------------------------------
// 以前はlocalStorage（この端末だけ）に保存していたため、他のメンバーには
// 一切共有されず、後からカテゴリーに参加した人には何も見えなかった。
// Todo/Calendarと同じくFirestore（categories/カテゴリーID/opinions、
// categories/カテゴリーID/opinionMemo/main）に保存し、カテゴリーに
// 参加している全員にリアルタイムで共有されるようにする。
// ------------------------------------------------------------
const params = new URLSearchParams(location.search);
const CATEGORY_ID = params.get('category') || 'default';

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
const opinionsRef = categoryDocRef.collection('opinions');
const memoRef = categoryDocRef.collection('opinionMemo').doc('main');

// ------------------------------------------------------------
// 自分の固定色（ログイン画面で選んだお気に入りの色）で付箋を貼るための連携
// ------------------------------------------------------------
// 以前は付箋を追加した順番（notes.length）で coral/green/amber/lav を
// 順番に割り当てていたため、同じ人が書いても毎回違う色になっていた。
// mypage.js・todo・goalと同じ tb_current_user / tb_profile_<email> を見て、
// 自分が選んだ色をそのまま付箋の背景色として使う。
// ------------------------------------------------------------
function loadStoredUser(){
  try { return JSON.parse(localStorage.getItem('tb_current_user')); } catch(e) { return null; }
}
function loadUserProfile(email){
  if(!email) return null;
  try { return JSON.parse(localStorage.getItem('tb_profile_' + email.trim().toLowerCase())) || null; } catch(e) { return null; }
}
// 色が一つも決まっていない場合の最後の保険（メールアドレスから毎回同じ色を作る）。
// mypage.js（Member欄）・todo/script.jsのフォールバックと全く同じパレットを使い、
// 万が一お気に入りの色が未設定のままでも他の画面と色がズレないようにしてある。
function fallbackColorFromEmail(email){
  const palette = ['#f3b6b7', '#fef5c1', '#ebd0b3', '#c3bad3', '#cee3be', '#e4b8cf'];
  let hash = 0;
  const s = String(email || 'guest');
  for(let i = 0; i < s.length; i++){ hash = s.charCodeAt(i) + ((hash << 5) - hash); }
  return palette[Math.abs(hash) % palette.length];
}
function getCurrentAuthor(){
  const currentUser = loadStoredUser();
  const email = currentUser?.email || null;
  const profile = email ? loadUserProfile(email) : null;
  const color = (profile && profile.favoriteColor) || currentUser?.favoriteColor || fallbackColorFromEmail(email);
  const name = (profile && profile.name) || currentUser?.name || 'あなた';
  return { email, name, color };
}
// 背景色の明るさに応じて、読みやすい文字色（濃い茶 or 白）を選ぶ
function inkColorFor(bgHex){
  const hex = String(bgHex || '').replace('#','');
  if(hex.length !== 6) return '#3A342A';
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
  return luminance > 0.6 ? '#3A342A' : '#ffffff';
}

// ------------------------------------------------------------
// コメント入力欄の状態を、再描画をまたいで覚えておく
// ------------------------------------------------------------
// 以前はリアクションやコメントがどこかで来るたびに全部の付箋を
// 作り直していたため、コメントを入力している途中でも入力欄ごと
// 消えてしまい、「入力してる時にリアクションとかくるとやり直しになる」
// 状態になっていた。入力中の文字・開閉状態をここに保存しておき、
// 再描画のたびに復元する。
// ------------------------------------------------------------
const noteUiState = {}; // { [noteId]: { open: bool, draft: string } }

function render(){
  const wrap = document.getElementById('notes');
  if (!wrap) return;

  // 今フォーカスが当たっているコメント入力欄があれば、再描画後に
  // カーソル位置ごと復元できるよう覚えておく
  const focused = document.activeElement;
  let refocus = null;
  if (wrap.contains(focused) && focused.classList && focused.classList.contains('comment-input')) {
    refocus = {
      noteId: focused.closest('[data-note-id]')?.dataset.noteId,
      selStart: focused.selectionStart,
      selEnd: focused.selectionEnd,
    };
  }

  wrap.innerHTML = '';
  notes.forEach(n => wrap.appendChild(buildNoteEl(n)));

  if (refocus && refocus.noteId) {
    const newInput = wrap.querySelector(`[data-note-id="${refocus.noteId}"] .comment-input`);
    if (newInput) {
      newInput.focus();
      try { newInput.setSelectionRange(refocus.selStart, refocus.selEnd); } catch (e) { /* ignore */ }
    }
  }
}

function normalizeReactionKey(key){
  return key;
}

function hasActiveReaction(n){
  return Object.values(n.reactions || {}).some((count) => Number(count) > 0);
}

function toggleReaction(n, key){
  if (!n.reactions) n.reactions = {};
  const current = Number(n.reactions[key] || 0);
  n.reactions[key] = current > 0 ? 0 : 1;
  return n.reactions[key];
}

function buildNoteEl(n){
  const el = document.createElement('div');
  el.className = 'note' + (hasActiveReaction(n) ? ' is-reacted' : '');
  el.dataset.noteId = n.id;
  el.style.setProperty('--r', n.rot + 'deg');

  // n.colorが「#rrggbb」形式（＝書いた人の固定色）ならインラインで直接塗る。
  // 古いデータ（coral/green/amber/lavのようなクラス名だけの付箋）は
  // 従来どおりCSSクラスに任せる。
  if (n.color && n.color.charAt(0) === '#') {
    el.style.background = n.color;
    el.style.color = inkColorFor(n.color);
  } else {
    el.classList.add('c-' + (n.color || COLORS[0]));
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'note-delete';
  deleteBtn.type = 'button';
  deleteBtn.setAttribute('aria-label', '付箋を削除');
  deleteBtn.textContent = '×';
  deleteBtn.onclick = (event) => {
    event.stopPropagation();
    notes = notes.filter((item) => item.id !== n.id);
    delete noteUiState[n.id];
    render();
    opinionsRef.doc(n.id).delete().catch(err => console.error('付箋の削除に失敗しました', err));
  };
  el.appendChild(deleteBtn);

  const tape = document.createElement('div');
  tape.className = 'tape';
  el.appendChild(tape);

  const text = document.createElement('div');
  text.className = 'note-text';
  text.contentEditable = 'true';
  text.spellcheck = true;
  text.setAttribute('data-placeholder', 'アイデアを入力');
  text.textContent = n.text;
  text.addEventListener('input', () => {
    n.text = text.innerText || text.textContent || '';
    opinionsRef.doc(n.id).update({ text: n.text }).catch(err => console.error('付箋の更新に失敗しました', err));
  });
  el.appendChild(text);

  const reactions = document.createElement('div');
  reactions.className = 'reactions';
  Object.entries(n.reactions || {}).forEach(([key, count]) => {
    if(Number(count) > 0) {
      reactions.appendChild(reactBtn(n, key, normalizeReactionKey(key), count));
    }
  });

  const reactionAdder = document.createElement('div');
  reactionAdder.className = 'reaction-adder';
  const addToggle = document.createElement('button');
  addToggle.className = 'reaction-add-toggle';
  addToggle.type = 'button';
  addToggle.textContent = 'リアクションを追加';
  const emojiPanel = document.createElement('div');
  emojiPanel.className = 'emoji-panel';
  emojiPanel.style.display = 'none';
  const emojiOptions = ['👍', '❤️', '👎', '🔥', '👏', '💡', '😁', '🙇‍♀️', '💩'];
  const emojiButtons = emojiOptions.map((emoji) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-option-btn';
    btn.type = 'button';
    btn.textContent = emoji;
    btn.onclick = () => {
      toggleReaction(n, emoji);
      render();
      opinionsRef.doc(n.id).update({ reactions: n.reactions }).catch(err => console.error('リアクションの更新に失敗しました', err));
    };
    return btn;
  });
  emojiButtons.forEach((btn) => emojiPanel.appendChild(btn));
  addToggle.onclick = () => {
    const isOpen = emojiPanel.style.display === 'flex';
    emojiPanel.style.display = isOpen ? 'none' : 'flex';
    addToggle.classList.toggle('active', !isOpen);
  };
  reactionAdder.appendChild(addToggle);
  reactionAdder.appendChild(emojiPanel);
  el.appendChild(reactions);
  el.appendChild(reactionAdder);

  const toggle = document.createElement('button');
  toggle.className = 'comment-toggle';
  toggle.textContent = 'コメントを追加';
  const box = document.createElement('div');
  box.className = 'comment-box';
  const savedState = noteUiState[n.id];
  if (savedState && savedState.open) box.classList.add('open');
  const input = document.createElement('input');
  input.className = 'comment-input';
  input.placeholder = 'コメントを入力';
  if (savedState && savedState.draft) input.value = savedState.draft;
  const send = document.createElement('button');
  send.textContent = '送信';
  box.appendChild(input);
  box.appendChild(send);

// ーーー 220行目付近のここから差し替え ーーー
  const list = document.createElement('ul');
  list.className = 'comment-list';
  n.comments.forEach((c, idx) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    
    // 過去の古いデータ（ただの文字）か、新しいデータ（オブジェクト形式）かを判定してテキストを取得
    const commentText = (typeof c === 'object' && c !== null) ? c.text : c;
    
    // 画面にはコメントの本文だけを表示（ユーザー名は表示しない）
    span.textContent = commentText;
    li.appendChild(span);

    // 削除ボタンの表示判定（自分がこのブラウザで投稿したコメント、または古いデータのみ×を出す）
    const commentId = (typeof c === 'object' && c !== null) ? c.id : null;
    const mySavedComments = JSON.parse(localStorage.getItem('my_posted_comments') || '[]');
    const isMyComment = commentId && mySavedComments.includes(commentId);

    if (isMyComment) {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '×';
      deleteBtn.style.marginLeft = '8px';
      deleteBtn.style.cursor = 'pointer';
      deleteBtn.style.border = 'none';
      deleteBtn.style.background = 'none';
      deleteBtn.style.color = 'inherit';
      deleteBtn.style.fontSize = '16px';
      deleteBtn.style.padding = '0';
      deleteBtn.onclick = () => {
        n.comments.splice(idx, 1);
        render();
        opinionsRef.doc(n.id).update({ comments: n.comments }).catch(err => console.error('コメントの削除に失敗しました', err));
      };
      li.appendChild(deleteBtn);
    }
    list.appendChild(li);
  });
  // ーーー ここまで差し替え ーーー

  toggle.onclick = () => {
    box.classList.toggle('open');
    noteUiState[n.id] = Object.assign({}, noteUiState[n.id], { open: box.classList.contains('open') });
  };

  // 入力中の文字を覚えておく（再描画をまたいでも消えないように）
  input.addEventListener('input', () => {
    noteUiState[n.id] = Object.assign({}, noteUiState[n.id], { open: true, draft: input.value });
  });

// ーーー 287行目（スクリーンショットの場所） ーーー
  send.onclick = () => {
    const v = input.value.trim();
    if(!v) return;

    // コメントごとにランダムな固有IDを作る
    const newCommentId = 'c_' + Math.random().toString(36).substring(2, 15);

    // 自分が送ったコメントIDを、自分のブラウザのlocalStorageに保存
    const mySavedComments = JSON.parse(localStorage.getItem('my_posted_comments') || '[]');
    mySavedComments.push(newCommentId);
    localStorage.setItem('my_posted_comments', JSON.stringify(mySavedComments));

    // FirestoreにはIDとテキストだけを保存
    n.comments.push({
      id: newCommentId,
      text: v
    });
    
    input.value = '';
    noteUiState[n.id] = Object.assign({}, noteUiState[n.id], { draft: '' });
    render();
    opinionsRef.doc(n.id).update({ comments: n.comments }).catch(err => console.error('コメントの追加に失敗しました', err));
  };

  // Enterキー2回押しで送信できるようにする。
  // ただし日本語入力の変換確定（IME）でEnterが誤検知されると、文章が
  // 途中でバラバラに送信されてしまうため、e.isComposingがtrueの間
  // （変換中）は無視する。500ms以内に2回Enterが押されたときだけ送信する。
  let lastEnterAt = 0;
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;

    const now = Date.now();
    if (now - lastEnterAt < 500) {
      e.preventDefault();
      lastEnterAt = 0;
      send.click();
    } else {
      lastEnterAt = now;
    }
  });
  
  el.appendChild(toggle);
  el.appendChild(box);
  if(n.comments.length) el.appendChild(list);

  return el;
}

function reactBtn(n, key, mark){
  const btn = document.createElement('button');
  btn.className = 'react-btn';
  const safeKey = String(key);
  const safeValue = Number(n.reactions[safeKey] || 0);
  btn.innerHTML = '<span class="mark">' + safeKey + '</span><span>' + safeValue + '</span>';
  btn.classList.toggle('active', safeValue > 0);
  btn.title = 'クリックで反応 / もう一度で解除';
  btn.onclick = () => {
    toggleReaction(n, safeKey);
    render();
    opinionsRef.doc(n.id).update({ reactions: n.reactions }).catch(err => console.error('リアクションの更新に失敗しました', err));
  };
  return btn;
}

const composer = document.getElementById('composer');
const composerEditor = document.getElementById('composerEditor');
const composerCancel = document.getElementById('composerCancel');
const composerSave = document.getElementById('composerSave');
const addNoteBtn = document.getElementById('addNoteBtn');

function openComposer(){
  if(composer) composer.style.display = 'block';
  if(composerEditor) composerEditor.focus();
}

function closeComposer(){
  if(composer) composer.style.display = 'none';
  if(composerEditor) composerEditor.innerHTML = '';
}

if(addNoteBtn) { addNoteBtn.onclick = () => { openComposer(); }; }
if(composerCancel) { composerCancel.onclick = () => { closeComposer(); }; }

if(composerSave) {
  composerSave.onclick = async () => {
    const text = (composerEditor.innerText || composerEditor.textContent || '').trim();
    if(!text) return;
    const author = getCurrentAuthor();
    try {
      await opinionsRef.add({
        text,
        color: author.color, // 自分が選んだ固定色をそのまま使う（以前は追加順で色が変わっていた）
        authorEmail: author.email,
        authorName: author.name,
        rot: (Math.random() * 2.4 - 1.2).toFixed(1),
        reactions: {},
        comments: [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error('付箋の追加に失敗しました', err);
    }
    closeComposer();
  };
}

// カテゴリー内の全員に共有されるよう、Firestoreをリアルタイムで購読する。
// 後からカテゴリーに参加した人がこのページを開いても、これまでの
// 付箋がそのまま全部表示される。
opinionsRef.orderBy('createdAt', 'asc').onSnapshot(snap => {
  notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render();
}, err => console.error('付箋の購読に失敗しました', err));

const memoEl = document.getElementById('memo');
const memoHint = document.getElementById('memoHint');
const linkInputWrapper = document.getElementById('linkInputWrapper');
const linkUrlInput = document.getElementById('linkUrlInput');
const linkSubmitBtn = document.getElementById('linkSubmitBtn');
const linkCancelBtn = document.getElementById('linkCancelBtn');

function showLinkInput(){
  if(linkInputWrapper) linkInputWrapper.style.display = 'flex';
  if(linkUrlInput) {
    linkUrlInput.focus();
    linkUrlInput.select();
  }
}

function hideLinkInput(){
  if(linkInputWrapper) linkInputWrapper.style.display = 'none';
  if(linkUrlInput) linkUrlInput.value = '';
}

function insertLinkFromInput(){
  const rawValue = linkUrlInput?.value.trim() || '';
  if(!rawValue || !memoEl) return;

  let url = rawValue;
  if(!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  const label = rawValue.replace(/^https?:\/\//i, '').replace(/\/$/, '') || 'リンク';
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.textContent = label;

  memoEl.focus();
  const selection = window.getSelection();
  let range;

  if (selection && selection.rangeCount > 0) {
    range = selection.getRangeAt(0);
    if (!memoEl.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(memoEl);
      range.collapse(false);
    }
  } else {
    range = document.createRange();
    range.selectNodeContents(memoEl);
    range.collapse(false);
  }

  range.insertNode(anchor);
  range.setStartAfter(anchor);
  range.setEndAfter(anchor);
  selection.removeAllRanges();
  selection.addRange(range);

  const trailingSpace = document.createTextNode(' ');
  range.insertNode(trailingSpace);

  memoEl.dispatchEvent(new Event('input', { bubbles: true }));
  hideLinkInput();
  memoEl.focus();
  updateToolbarState();
}

if(linkSubmitBtn) {
  linkSubmitBtn.addEventListener('click', insertLinkFromInput);
}

if(linkCancelBtn) {
  linkCancelBtn.addEventListener('click', () => {
    hideLinkInput();
    if(memoEl) memoEl.focus();
  });
}

if(linkUrlInput) {
  linkUrlInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') {
      e.preventDefault();
      insertLinkFromInput();
    }
  });
}

// ツールバーボタンのコマンド実行（存在チェック用の安全ガード付き）
document.querySelectorAll('.memo-btn:not(.memo-text-color-btn):not(.memo-highlight-btn)').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const command = btn.getAttribute('data-command');
    if(command === 'createLink'){
      showLinkInput();
      return;
    }

    hideLinkInput();
    document.execCommand(command);
    if(memoEl) memoEl.focus();
    updateToolbarState();
  });
});

// 💡 存在しないカラーパレット処理でエラーが出ないよう安全ガード付きに変更
const textColorBtn = document.querySelector('.memo-text-color-btn');
if(textColorBtn) {
  textColorBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const palette = document.getElementById('textColorPalette');
    if(palette) palette.style.display = palette.style.display === 'flex' ? 'none' : 'flex';
  });
}

const highlightColorBtn = document.querySelector('.memo-highlight-btn');
if(highlightColorBtn) {
  highlightColorBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const palette = document.getElementById('highlightColorPalette');
    if(palette) palette.style.display = palette.style.display === 'flex' ? 'none' : 'flex';
  });
}

// パレット外クリックで閉じる処理の安全ガード
document.addEventListener('click', (e) => {
  if(!e.target.closest('.memo-color-group')){
    const tcP = document.getElementById('textColorPalette');
    const hlP = document.getElementById('highlightColorPalette');
    if(tcP) tcP.style.display = 'none';
    if(hlP) hlP.style.display = 'none';
  }
});

// 保存機能（メモもFirestoreで全員に共有する）
if(memoEl) {
  memoEl.addEventListener('input', () => {
    clearTimeout(memoTimer);
    if(memoHint) memoHint.textContent = '';
    memoTimer = setTimeout(() => {
      memoRef.set({ html: memoEl.innerHTML }, { merge: true })
        .then(() => {
          if(memoHint) {
            memoHint.textContent = '保存しました';
            setTimeout(() => { if (memoHint.textContent === '保存しました') memoHint.textContent = ''; }, 1500);
          }
        })
        .catch(() => {});
    }, 500);
  });
}

// カテゴリー内の全員に共有されるよう、メモもリアルタイムで購読する
memoRef.onSnapshot(doc => {
  if (!doc.exists || !memoEl) return;
  const html = doc.data().html || '';
  // 自分が今まさに入力中のときは上書きしない（他人の更新が入ってきても
  // カーソル位置が飛んだり、入力中の文字が消えたりしないようにするため）
  if (document.activeElement !== memoEl) {
    memoEl.innerHTML = html;
  }
});

const toolbarButtons = document.querySelectorAll('.memo-btn[data-command]');

function updateToolbarState(){
  toolbarButtons.forEach(btn => {
    const cmd = btn.dataset.command;
    if(['bold','italic','underline','insertUnorderedList'].includes(cmd)){
      try{
        btn.classList.toggle('active', document.queryCommandState(cmd));
      }catch(e){}
    }
  });
}

if(memoEl) {
  document.addEventListener('selectionchange', () => {
    if(document.activeElement === memoEl || memoEl.contains(document.activeElement)){
      updateToolbarState();
    }
  });
  memoEl.addEventListener('keyup', updateToolbarState);
  memoEl.addEventListener('mouseup', updateToolbarState);
}

// 🌟 リンクのクリック/ダブルクリック検知処理（安全ガード＆最適化版）
if (memoEl) {
    memoEl.addEventListener('dblclick', function(e) {
        if (e.target.tagName === 'A') {
            window.open(e.target.href, '_blank');
        }
    });

    memoEl.addEventListener('click', function(e) {
        if (e.target.tagName === 'A') {
            if (e.ctrlKey || e.metaKey) {
                window.open(e.target.href, '_blank');
            } else {
                if (memoHint) {
                    memoHint.innerText = "💡 Ctrl (Cmd) を押しながらクリックでリンクを開きます";
                    setTimeout(() => { if(memoHint.innerText.includes("クリック")) memoHint.innerText = ""; }, 3000);
                }
            }
        }
    });
}
