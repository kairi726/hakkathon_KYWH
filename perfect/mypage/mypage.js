// ============================================================
// Firebase設定
// ------------------------------------------------------------
// 1. https://console.firebase.google.com/ でプロジェクトを新規作成（無料）
// 2. 「Firestore Database」を作成（テストモードでOK。後でルールを絞る）
// 3. プロジェクト設定 → マイアプリ → ウェブアプリを追加 → 下の firebaseConfig をコピペ
// ※ ログイン機能は別担当が実装中のため、ここでは Firebase Authentication は使わず
//    Firestore（データ保存）だけを使っている。ログインができたら下の「仮のユーザー識別」を
//    実際のログインユーザー情報に差し替えるだけでよい。
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyA3x07jil3hPvtSsYFnreB-QQhxPGWOHIc",
  authDomain: "kwyh-1219.firebaseapp.com",
  projectId: "kwyh-1219",
  storageBucket: "kwyh-1219.firebasestorage.app",
  messagingSenderId: "497261200413",
  appId: "1:497261200413:web:17465c15d28e1d9e13f2f4",
  measurementId: "G-0ZSW26JXG0",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;

// ============================================================
// 仮のユーザー識別（ログイン機能ができるまでのつなぎ）
// ------------------------------------------------------------
// 名前・メールアドレスをlocalStorageに保存して「ログイン済み」の代わりにする。
// ログイン機能ができたら、currentUser の中身をそのログインユーザー情報に
// 差し替えれば、招待・共有・カテゴリー機能はそのまま動く。
// ============================================================
const USER_KEY = 'tb_current_user';
function loadStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}
function saveStoredUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
let currentUser = loadStoredUser(); // { name, email } または null

// カテゴリー用パステルカラー（既存タブ配色に合わせる）
const CATEGORY_COLORS = ['#f3b6b7', '#fef5c1', '#ebd0b3', '#c3bad3', '#cee3be', '#e4b8cf'];

// 埋め込みページ（相対パス）
const EMBED_PAGES = {
  todo: '../../todo/index.html',
  calendar: '../../calender/calender.html',
  opinion: '../perfect.html',
};

let selectedCategoryId = null;
let selectedColor = CATEGORY_COLORS[0];
let categories = [];
let unsubCategories = null;
let unsubCategoryDoc = null;
let unsubGoalDoc = null;
let saveTimer = null;

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// 招待リンクの ?join=... を一時保存（ログイン後に処理する）
const pendingJoinId = new URLSearchParams(location.search).get('join');

// ===== 仮のユーザー識別フォーム =====
document.getElementById('identity-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('identity-name').value.trim();
  const email = document.getElementById('identity-email').value.trim();
  if (!name || !email) return;
  currentUser = { name, email };
  saveStoredUser(currentUser);
  startApp();
});

// ログアウト（今は仮のユーザー識別を消すだけ。本物のログイン機能が来たらここに置き換える）
document.getElementById('logout-btn').addEventListener('click', () => {
  if (unsubCategories) unsubCategories();
  if (unsubCategoryDoc) unsubCategoryDoc();
  if (unsubGoalDoc) unsubGoalDoc();
  currentUser = null;
  localStorage.removeItem(USER_KEY);
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('identity-screen').style.display = 'flex';
});

async function startApp() {
  document.getElementById('identity-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  document.getElementById('user-email-label').textContent = currentUser.name + ' ・ ' + currentUser.email;

  if (pendingJoinId) {
    await joinCategoryById(pendingJoinId);
    history.replaceState({}, '', location.pathname); // ?join= を消す
  }
  subscribeCategories();
}

// 初期表示：すでに仮ユーザー情報があればそのままアプリを開始
if (currentUser) {
  startApp();
} else {
  document.getElementById('identity-screen').style.display = 'flex';
}

// リンクから参加：自分のメールをmemberEmailsに追加するだけ
async function joinCategoryById(categoryId) {
  try {
    await db.collection('categories').doc(categoryId).update({
      memberEmails: FieldValue.arrayUnion(currentUser.email),
    });
    selectCategory(categoryId);
  } catch (err) {
    console.warn('共有リンクでの参加に失敗しました', err);
  }
}

// ===== カテゴリー一覧の購読 =====
// 最初の画面は常に「カテゴリー一覧」。カテゴリーを追加しても自動では詳細画面に
// 遷移させず、一覧に残っている作成済みカテゴリーの中から選んでもらう。
function subscribeCategories() {
  if (unsubCategories) unsubCategories();
  unsubCategories = db.collection('categories')
    .where('memberEmails', 'array-contains', currentUser.email)
    .onSnapshot(snap => {
      categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCategoryChips();
      // 表示中だったカテゴリーが無くなっていたら一覧画面に戻す
      if (selectedCategoryId && !categories.find(c => c.id === selectedCategoryId)) {
        showCategoryListScreen();
      }
    }, err => console.error('categories購読エラー', err));
}

function renderCategoryChips() {
  const box = document.getElementById('category-list-chips');
  box.innerHTML = categories.map(c => `
    <div class="category-chip ${c.id===selectedCategoryId?'active':''}"
         style="background:${c.color||CATEGORY_COLORS[0]}"
         onclick="selectCategory('${c.id}')">${escHtml(c.name)}</div>
  `).join('');
  document.getElementById('no-category-msg').style.display = categories.length ? 'none' : 'flex';
}

// ===== 画面切り替え：一覧 ⇔ 詳細 =====
function showCategoryListScreen() {
  selectedCategoryId = null;
  document.getElementById('category-content').style.display = 'none';
  document.getElementById('category-list-screen').style.display = 'block';
  document.getElementById('category-form-box').style.display = 'none';
  renderCategoryChips();
}

window.selectCategory = function (id) {
  selectedCategoryId = id;
  document.getElementById('category-list-screen').style.display = 'none';
  document.getElementById('category-content').style.display = 'block';
  showTabPanel('goal');
  subscribeSelectedCategory();
};

document.getElementById('back-to-list-btn').addEventListener('click', showCategoryListScreen);

function subscribeSelectedCategory() {
  if (unsubCategoryDoc) unsubCategoryDoc();
  if (unsubGoalDoc) unsubGoalDoc();

  unsubCategoryDoc = db.collection('categories').doc(selectedCategoryId)
    .onSnapshot(doc => {
      if (!doc.exists) return;
      renderMembers(doc.data().memberEmails || []);
    });

  const goalRef = db.collection('categories').doc(selectedCategoryId).collection('goal').doc('main');
  unsubGoalDoc = goalRef.onSnapshot(doc => {
    const data = doc.data() || {};
    const textEl = document.getElementById('goal-text');
    const infoEl = document.getElementById('goal-info');
    if (document.activeElement !== textEl) textEl.value = data.text || '';
    if (document.activeElement !== infoEl) infoEl.value = data.info || '';
  });
}

function renderMembers(emails) {
  const box = document.getElementById('member-list');
  box.innerHTML = emails.map((email, i) => {
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    const initial = email.trim()[0]?.toUpperCase() || '?';
    const isYou = currentUser && email === currentUser.email;
    return `<div class="member-row">
      <div class="member-avatar" style="background:${color}">${initial}</div>
      <span class="member-email">${escHtml(email)}${isYou?'<span class="member-you">（あなた）</span>':''}</span>
    </div>`;
  }).join('');
}

// ===== カテゴリー追加 =====
const colorPicker = document.getElementById('color-picker');
colorPicker.innerHTML = CATEGORY_COLORS.map((c,i) =>
  `<div class="color-swatch ${i===0?'selected':''}" style="background:${c}" onclick="pickColor('${c}', this)"></div>`
).join('');
window.pickColor = function (color, el) {
  selectedColor = color;
  colorPicker.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
};

function openCategoryForm() {
  document.getElementById('category-form-box').style.display = 'flex';
  document.getElementById('category-form-error').textContent = '';
  document.getElementById('new-category-name').focus();
}
document.getElementById('add-category-btn').addEventListener('click', openCategoryForm);

document.getElementById('cancel-category-btn').addEventListener('click', () => {
  document.getElementById('category-form-box').style.display = 'none';
  document.getElementById('new-category-name').value = '';
  document.getElementById('category-form-error').textContent = '';
});

document.getElementById('create-category-btn').addEventListener('click', async () => {
  const nameInput = document.getElementById('new-category-name');
  const errorEl = document.getElementById('category-form-error');
  const btn = document.getElementById('create-category-btn');
  const name = nameInput.value.trim();
  errorEl.textContent = '';
  if (!name) { errorEl.textContent = 'カテゴリー名を入力してください'; return; }
  if (!currentUser) { errorEl.textContent = 'ユーザー情報が取得できていません。再読み込みしてください。'; return; }

  btn.disabled = true;
  try {
    const docRef = await db.collection('categories').add({
      name,
      color: selectedColor,
      ownerEmail: currentUser.email,
      memberEmails: [currentUser.email],
      createdAt: FieldValue.serverTimestamp(),
    });
    await docRef.collection('goal').doc('main').set({ text: '', info: '' });

    document.getElementById('category-form-box').style.display = 'none';
    nameInput.value = '';
    selectCategory(docRef.id);
  } catch (err) {
    console.error('カテゴリー作成に失敗', err);
    errorEl.textContent = '作成に失敗しました：' + (err.message || err.code) + '（mypage.jsのfirebaseConfigが設定されているか確認してください）';
  } finally {
    btn.disabled = false;
  }
});

// ===== カテゴリー削除（間違えて作成したときのため） =====
document.getElementById('delete-category-btn').addEventListener('click', async () => {
  if (!selectedCategoryId) return;
  const target = categories.find(c => c.id === selectedCategoryId);
  const name = target ? target.name : 'このカテゴリー';
  const ok = confirm(`「${name}」を削除しますか？この操作は取り消せません。`);
  if (!ok) return;

  const btn = document.getElementById('delete-category-btn');
  btn.disabled = true;
  try {
    const catRef = db.collection('categories').doc(selectedCategoryId);
    await catRef.collection('goal').doc('main').delete();
    await catRef.delete();
    showCategoryListScreen();
  } catch (err) {
    console.error('カテゴリー削除に失敗', err);
    alert('削除に失敗しました：' + (err.message || err.code));
  } finally {
    btn.disabled = false;
  }
});

// ===== 招待 =====
document.getElementById('invite-btn').addEventListener('click', async () => {
  const email = document.getElementById('invite-email').value.trim();
  const msgEl = document.getElementById('invite-msg');
  if (!email || !selectedCategoryId) return;
  try {
    await db.collection('categories').doc(selectedCategoryId).update({
      memberEmails: FieldValue.arrayUnion(email),
    });
    msgEl.textContent = email + ' を招待しました（相手がこのメールでログインすると表示されます）';
    document.getElementById('invite-email').value = '';
  } catch (err) {
    msgEl.textContent = '招待に失敗しました：' + (err.message || err.code);
  }
});

// ===== 共有リンク =====
document.getElementById('share-link-btn').addEventListener('click', async () => {
  if (!selectedCategoryId) return;
  const url = location.origin + location.pathname + '?join=' + selectedCategoryId;
  try {
    await navigator.clipboard.writeText(url);
    alert('共有リンクをコピーしました：\n' + url);
  } catch {
    prompt('このリンクをコピーしてください：', url);
  }
});

// ===== Goalテキストの自動保存 =====
function scheduleGoalSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!selectedCategoryId) return;
    await db.collection('categories').doc(selectedCategoryId).collection('goal').doc('main').set({
      text: document.getElementById('goal-text').value,
      info: document.getElementById('goal-info').value,
      updatedBy: currentUser?.email || '',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const label = document.getElementById('goal-saved-label');
    label.textContent = '保存しました';
    setTimeout(() => { if (label.textContent === '保存しました') label.textContent = ''; }, 2000);
  }, 600);
}
document.getElementById('goal-text').addEventListener('input', scheduleGoalSave);
document.getElementById('goal-info').addEventListener('input', scheduleGoalSave);

// ===== タブ切り替え =====
const tabs = document.querySelectorAll('.tab-item[data-tab]');
const panels = document.querySelectorAll('.tab-panel');

// カテゴリーごとにTo do/Calendarの中身が混ざらないよう、埋め込みページには
// ?category=カテゴリーID を付けて渡す（todo/calenderページ側もこのIDでデータを分ける）
function showTabPanel(tabName) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  panels.forEach(p => {
    const isActive = p.dataset.panel === tabName;
    p.classList.toggle('active', isActive);
    const iframe = p.querySelector('iframe.embedded-page');
    if (iframe) {
      const base = EMBED_PAGES[tabName];
      const src = base && selectedCategoryId ? base + '?category=' + encodeURIComponent(selectedCategoryId) : base;
      if (isActive && src) {
        if (iframe.dataset.loadedSrc !== src) {
          iframe.src = src;
          iframe.dataset.loadedSrc = src;
        }
        iframe.style.display = 'block';
      } else {
        iframe.style.display = 'none';
      }
    }
  });
}

tabs.forEach(tab => {
  tab.addEventListener('click', (e) => {
    e.preventDefault();
    showTabPanel(tab.dataset.tab);
  });
});
