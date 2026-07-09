const COLORS = ['coral','green','amber','lav']; // 古い付箋（authorが無いデータ）向けのフォールバック用クラス名
let notes = [];
let memoTimer = null;

// ------------------------------------------------------------
// 保存先について
// ------------------------------------------------------------
// 以前は window.storage.get/set という、このプロジェクトのどこにも
// 定義されていない関数を呼んでいたため、付箋もメモも実際には
// 一切保存されていなかった（エラーがtry/catchで握りつぶされて
// 気づきにくくなっていた）。Todo/Calendarと同じく、ブラウザの
// localStorageに保存するようにする。あわせて ?category=カテゴリーID
// でカテゴリーごとにデータが分かれるようにする（他のタブと同じ仕組み）。
// ------------------------------------------------------------
const params = new URLSearchParams(location.search);
const CATEGORY_ID = params.get('category') || 'default';
const NOTES_KEY = 'idea-notes-' + CATEGORY_ID;
const MEMO_KEY = 'idea-memo-' + CATEGORY_ID;

function rid(){ return Math.random().toString(36).slice(2,9); }

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

function loadState(){
  try{
    const raw = localStorage.getItem(NOTES_KEY);
    notes = raw ? JSON.parse(raw) : [];
  }catch(e){ notes = []; }
  render();
  loadMemo();
}

function saveNotes(){
  try{ localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }
  catch(e){ console.error('save failed', e); }
}

function render(){
  const wrap = document.getElementById('notes');
  if (!wrap) return;
  wrap.innerHTML = '';
  notes.forEach(n => wrap.appendChild(buildNoteEl(n)));
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
  deleteBtn.onclick = async (event) => {
    event.stopPropagation();
    notes = notes.filter((item) => item.id !== n.id);
    await saveNotes();
    render();
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
  text.addEventListener('input', async () => {
    n.text = text.innerText || text.textContent || '';
    await saveNotes();
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
    btn.onclick = async () => {
      toggleReaction(n, emoji);
      await saveNotes();
      render();
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
  const input = document.createElement('input');
  input.placeholder = 'コメントを入力';
  const send = document.createElement('button');
  send.textContent = '送信';
  box.appendChild(input);
  box.appendChild(send);

  const list = document.createElement('ul');
  list.className = 'comment-list';
  n.comments.forEach((c, idx) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = c;
    li.appendChild(span);
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '×';
    deleteBtn.style.marginLeft = '8px';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.border = 'none';
    deleteBtn.style.background = 'none';
    deleteBtn.style.color = 'inherit';
    deleteBtn.style.fontSize = '16px';
    deleteBtn.style.padding = '0';
    deleteBtn.onclick = async () => {
      n.comments.splice(idx, 1);
      await saveNotes();
      render();
    };
    li.appendChild(deleteBtn);
    list.appendChild(li);
  });

  toggle.onclick = () => box.classList.toggle('open');
  send.onclick = async () => {
    const v = input.value.trim();
    if(!v) return;
    n.comments.push(v);
    input.value = '';
    await saveNotes();
    render();
  };
  input.addEventListener('keydown', e => { if(e.key === 'Enter') send.onclick(); });

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
  btn.onclick = async () => {
    toggleReaction(n, safeKey);
    await saveNotes();
    render();
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
    notes.push({
      id: rid(),
      text,
      color: author.color, // 自分が選んだ固定色をそのまま使う（以前は追加順で色が変わっていた）
      authorEmail: author.email,
      authorName: author.name,
      rot: (Math.random() * 2.4 - 1.2).toFixed(1),
      reactions: {},
      comments: []
    });
    await saveNotes();
    render();
    closeComposer();
  };
}

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
    if(tcP) tcP.style.style.display = 'none';
    if(hlP) hlP.style.style.display = 'none';
  }
});

// 保存機能
if(memoEl) {
  memoEl.addEventListener('input', () => {
    clearTimeout(memoTimer);
    if(memoHint) memoHint.textContent = '';
    memoTimer = setTimeout(() => {
      try{
        const html = memoEl.innerHTML;
        localStorage.setItem(MEMO_KEY, html);
        if(memoHint) {
          memoHint.textContent = '保存しました';
          setTimeout(() => memoHint.textContent = '', 1500);
        }
      }catch(e){}
    }, 500);
  });
}

function loadMemo(){
  try{
    const html = localStorage.getItem(MEMO_KEY);
    if(html && memoEl){
      memoEl.innerHTML = html;
    }
  }catch(e){}
}

loadState();

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