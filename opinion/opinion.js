const COLORS = ['coral','green','amber','lav'];
let notes = [];
let memoTimer = null;

function rid(){ return Math.random().toString(36).slice(2,9); }

async function loadState(){
  try{
    const res = await window.storage.get('idea-notes', true);
    notes = res ? JSON.parse(res.value) : [];
  }catch(e){ notes = []; }
  if(notes.length === 0){
    notes = [];
  }
  render();

  try{
    const memoRes = await window.storage.get('idea-memo', true);
    if(memoRes) document.getElementById('memo').value = memoRes.value;
  }catch(e){}
}

async function saveNotes(){
  try{ await window.storage.set('idea-notes', JSON.stringify(notes), true); }
  catch(e){ console.error('save failed', e); }
}

function render(){
  const wrap = document.getElementById('notes');
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
  el.className = 'note c-' + n.color + (hasActiveReaction(n) ? ' is-reacted' : '');
  el.style.setProperty('--r', n.rot + 'deg');

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
  const emojiOptions = ['👍', '❤️', '👎', '🔥', '👏', '💡', '😁', '🙇‍♀️'];
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
  composer.style.display = 'block';
  composerEditor.focus();
}

function closeComposer(){
  composer.style.display = 'none';
  composerEditor.innerHTML = '';
}

addNoteBtn.onclick = () => {
  openComposer();
};

composerCancel.onclick = () => {
  closeComposer();
};

composerSave.onclick = async () => {
  const text = (composerEditor.innerText || composerEditor.textContent || '').trim();
  if(!text) return;
  const color = COLORS[notes.length % COLORS.length];
  notes.push({
    id: rid(),
    text,
    color,
    rot: (Math.random() * 2.4 - 1.2).toFixed(1),
    reactions: {},
    comments: []
  });
  await saveNotes();
  render();
  closeComposer();
};

const memoEl = document.getElementById('memo');
const memoHint = document.getElementById('memoHint');
memoEl.addEventListener('input', () => {
  clearTimeout(memoTimer);
  memoHint.textContent = '';
  memoTimer = setTimeout(async () => {
    try{
      await window.storage.set('idea-memo', memoEl.value, true);
      memoHint.textContent = '保存しました';
      setTimeout(() => memoHint.textContent = '', 1500);
    }catch(e){}
  }, 500);
});

loadState();