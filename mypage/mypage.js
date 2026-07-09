// ============================================================
// Firebase設定
// ------------------------------------------------------------
// 1. https://console.firebase.google.com/ でプロジェクトを新規作成（無料）
// 2. 「Firestore Database」を作成（テストモードでOK。後でルールを絞る）
// 3. プロジェクト設定 → マイアプリ → ウェブアプリを追加 → 下の firebaseConfig をコピペ
// ※ ユーザー認証はこのファイル内で完結する独自実装（Firebase Authenticationは未使用）。
//    Firestoreはカテゴリー・Goalなどのデータ保存にだけ使っている。
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
// ログインユーザー情報
// ------------------------------------------------------------
// ログイン画面は別ファイルに分けず、このページ（#login-screen）に直接組み込んである。
// ログインに成功したら currentUser を設定して、そのままアプリ画面に切り替える
// （別ページへの遷移はしないので、file://・ローカルサーバーどちらでも確実に動く）。
// ============================================================
const USER_KEY = 'tb_current_user';
function loadStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}
function saveStoredUser(u) { try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch { /* ignore */ } }
let currentUser = loadStoredUser(); // { name, email, favoriteColor } または null

// ------------------------------------------------------------
// アカウント（メールアドレス）ごとのプロフィール保存
// ------------------------------------------------------------
// 以前は「名前」がどこにも保存されず、「お気に入りの色」も
// 全アカウント共通の1つのキー(favoriteColor)に保存されていたため、
// ログアウトして別アカウントでログインしても前の人の色が残ったり、
// 名前が常にメールアドレス由来の文字列になってしまっていた。
// これを避けるため、プロフィールはメールアドレスごとに分けて保存する。
// ------------------------------------------------------------
function profileKey(email) {
  return 'tb_profile_' + (email || '').trim().toLowerCase();
}
function loadUserProfile(email) {
  if (!email) return null;
  try { return JSON.parse(localStorage.getItem(profileKey(email))) || null; } catch { return null; }
}
function saveUserProfile(email, data) {
  if (!email) return null;
  const merged = Object.assign({}, loadUserProfile(email) || {}, data);
  try { localStorage.setItem(profileKey(email), JSON.stringify(merged)); } catch { /* ignore */ }
  syncProfileToCloud(email, merged);
  return merged;
}

// ------------------------------------------------------------
// プロフィールをFirestoreにも保存する
// ------------------------------------------------------------
// これまでは名前・お気に入りの色がそれぞれの端末のlocalStorageにしか
// 保存されておらず、他のメンバーの端末からは見えなかった（Memberアイコンの
// 色が人によってバラバラに見えていた原因）。ログインしているメールアドレスを
// ドキュメントIDにしてFirestoreにも保存しておくことで、誰の端末から見ても
// 同じ色・名前がMember一覧に表示されるようにする。
// ------------------------------------------------------------
function syncProfileToCloud(email, profile) {
  if (!email) return;
  const key = email.trim().toLowerCase();
  db.collection('users').doc(key).set({
    name: profile.name || '',
    favoriteColor: profile.favoriteColor || null,
  }, { merge: true }).catch(err => console.warn('プロフィールの同期に失敗しました', err));
}

// 新規登録の途中（まだログインしていない状態）で色を選んでいるとき、
// どのメールアドレスのプロフィールに保存すればいいかを覚えておくための変数
let pendingSignupEmail = null;

// カテゴリー用パステルカラー（既存タブ配色に合わせる）
const CATEGORY_COLORS = ['#f3b6b7', '#fef5c1', '#ebd0b3', '#c3bad3', '#cee3be', '#e4b8cf'];

// 埋め込みページ（相対パス。mypage/ から見た位置）
// ※ 以前は 'goal' がこの一覧に無かったため、Goalタブだけ ?category= が
//   渡らず、常に固定の src="../goal/goal.html" のままだった。
const EMBED_PAGES = {
  goal: '../goal/goal.html',
  todo: '../todo/index.html',
  calendar: '../calender/calender.html',
  opinion: '../opinion/opinion.html',
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

// ============================================================
// ログイン画面のロジック
// ============================================================
const toggleButtons = document.querySelectorAll('.toggle-btn');
const formTitle = document.getElementById('form-title');
const formDescription = document.getElementById('form-description');
const submitButton = document.getElementById('submit-btn');
const formMessage = document.getElementById('form-message');
const nameGroup = document.getElementById('name-group');
const confirmGroup = document.getElementById('confirm-group');
const authForm = document.getElementById('auth-form');
const colorGroup = document.getElementById('color-group');
const colorInput = document.getElementById('favorite-color');
const colorPreview = document.getElementById('color-preview');
const colorHelp = document.getElementById('color-help');
const swatches = document.querySelectorAll('.color-swatch');
let colorSelectionReady = false;
const confirmColorBtn = document.getElementById('confirm-color-btn');

function updateColorPreview() {
  const color = colorInput.value;
  colorPreview.style.backgroundColor = color;
  colorHelp.textContent = 'お好みの色を選べます。';
}

// resetColor=false のときは「ログイン表示に切り替えても色選択は隠さない」。
// 新規登録が完了した直後だけ、この状態でsetMode('login')を呼んで
// 名前・確認パスワード欄は隠しつつ色選択だけ表示し続けられるようにする。
function setMode(mode, { resetColor = true } = {}) {
  const isSignup = mode === 'signup';

  toggleButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });

  formTitle.textContent = isSignup ? '新規登録' : 'ログイン';
  formDescription.textContent = isSignup
    ? 'アカウントを作成して、サービスを始めましょう。'
    : '登録済みの情報でログインできます。';
  submitButton.textContent = isSignup ? '新規登録する' : 'ログインする';

  nameGroup.classList.toggle('hidden', !isSignup);
  confirmGroup.classList.toggle('hidden', !isSignup);
  colorGroup.classList.toggle('hidden', !colorSelectionReady);
  formMessage.textContent = '';

  // 隠れている項目にrequiredが残っていると、ブラウザが「必須なのにフォーカスできない」
  // 判定でフォーム送信自体をブロックしてしまうため、表示状態に合わせて付け外しする
  document.getElementById('name').required = isSignup;

  if (!isSignup && resetColor) {
    // ユーザーが自分でログインタブに切り替えたときだけ、色選択は次回まで一旦リセットする
    colorSelectionReady = false;
    colorGroup.classList.add('hidden');
  }
}

toggleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    pendingSignupEmail = null;
    setMode(button.dataset.mode);
  });
});

swatches.forEach((button) => {
  button.addEventListener('click', () => {
    colorInput.value = button.dataset.color;
    updateColorPreview();
  });
});

confirmColorBtn.addEventListener('click', () => {
  const selected = colorInput.value;
  const targetEmail = pendingSignupEmail || (currentUser && currentUser.email);

  if (!targetEmail) {
    formMessage.style.color = '#b91c1c';
    formMessage.textContent = '先にメールアドレスを入力してください。';
    return;
  }

  saveUserProfile(targetEmail, { favoriteColor: selected });

  // すでにログイン中で、自分自身の色を変更した場合はその場にも反映する
  if (currentUser && currentUser.email === targetEmail) {
    currentUser.favoriteColor = selected;
    saveStoredUser(currentUser);
  }

  formMessage.style.color = '#0f766e';
  formMessage.textContent = '色を保存しました。';
});

colorInput.addEventListener('input', updateColorPreview);
updateColorPreview();

// ログイン成功時：ページ遷移せず、その場でアプリ画面に切り替える
function completeLogin(nameFromForm, email) {
  const profile = loadUserProfile(email) || {};
  const name = profile.name || nameFromForm || (email ? email.split('@')[0] : '');

  currentUser = {
    name,
    email: email || '',
    favoriteColor: profile.favoriteColor || null,
  };
  saveStoredUser(currentUser);
  document.getElementById('login-screen').style.display = 'none';
  startApp();
}

authForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const isSignup = document.querySelector('.toggle-btn.active').dataset.mode === 'signup';
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (isSignup && password !== confirmPassword) {
    formMessage.textContent = 'パスワードが一致しません。';
    formMessage.style.color = '#b91c1c';
    return;
  }

  formMessage.style.color = '#0f766e';

  if (isSignup) {
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();

    if (!name) {
      formMessage.style.color = '#b91c1c';
      formMessage.textContent = 'お名前を入力してください。';
      return;
    }
    if (!email) {
      formMessage.style.color = '#b91c1c';
      formMessage.textContent = 'メールアドレスを入力してください。';
      return;
    }

    // ここで名前をこのメールアドレスのプロフィールとして保存する。
    // 以前はここで何も保存していなかったため、名前が常に空扱いになっていた。
    saveUserProfile(email, { name });
    pendingSignupEmail = email;

    authForm.reset();
    // 新規登録直後のログイン画面には、ログインボタンを押す前から
    // 最初から色選択を表示しておく（ボタンを1回押さないと出てこないのはNG）
    colorSelectionReady = true;
    colorGroup.classList.remove('hidden');
    updateColorPreview();
    formMessage.textContent = '新規登録が完了しました。好きな色を選んでから、ログインしてください。';
    setMode('login', { resetColor: false });
    // ログイン画面でメールを入力し直す手間を減らすため、メールだけ復元しておく
    document.getElementById('email').value = email;
    return;
  }

  // ログイン：まだ色を選んだことが無いアカウントは、色を選んでもらってから
  // ログインを完了する（自動で先へ進めてしまうと色選択がちらっと見えるだけで
  // 終わってしまうため、ここでは自動遷移せず一旦止める）。
  const email = document.getElementById('email').value.trim();
  const nameValue = document.getElementById('name').value.trim(); // ログイン画面では入力欄が隠れているため空のことが多い

  const existingProfile = loadUserProfile(email);
  if (!existingProfile || !existingProfile.favoriteColor) {
    pendingSignupEmail = email;
    colorSelectionReady = true;
    colorGroup.classList.remove('hidden');
    updateColorPreview();
    formMessage.style.color = '#0f766e';
    formMessage.textContent = '好きな色を選んで「色を決定」を押してから、もう一度「ログインする」を押してください。';
    return;
  }

  formMessage.textContent = 'ログインしました。マイページに移動します…';
  setTimeout(() => completeLogin(nameValue, email), 500);
});

setMode('login');

// ===== ログアウト =====
document.getElementById('logout-btn').addEventListener('click', () => {
  if (unsubCategories) unsubCategories();
  if (unsubCategoryDoc) unsubCategoryDoc();
  if (unsubGoalDoc) unsubGoalDoc();
  currentUser = null;
  pendingSignupEmail = null;
  localStorage.removeItem(USER_KEY);
  document.getElementById('app-screen').style.display = 'none';
  authForm.reset();
  setMode('login');
  document.getElementById('login-screen').style.display = '';
});

async function startApp() {
  document.getElementById('app-screen').style.display = 'block';
  document.getElementById('user-email-label').textContent = currentUser.name + ' ・ ' + currentUser.email;

  if (pendingJoinId) {
    await joinCategoryById(pendingJoinId);
    history.replaceState({}, '', location.pathname); // ?join= を消す
  }
  subscribeCategories();
}

// 初期表示：ログイン済み（過去にログインしてlocalStorageに残っている）ならそのままアプリを開始。
// 未ログインならログイン画面（デフォルトで表示されている）のままにする。
if (currentUser) {
  document.getElementById('login-screen').style.display = 'none';
  startApp();
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
    if (textEl && document.activeElement !== textEl) textEl.value = data.text || '';
    if (infoEl && document.activeElement !== infoEl) infoEl.value = data.info || '';
  });
}

// 他のメンバーのプロフィール（Firestore由来）を一度取得したら使い回すキャッシュ
const memberProfileCache = {};

// 誰も色を選んでいない場合のフォールバック：メールアドレスから毎回同じ色を作る
// （前は表示順=配列のインデックスで色を決めていたため、並び順が変わると
//   同じ人でも色が変わってしまっていた）
function fallbackColorFromEmail(email) {
  let hash = 0;
  const s = String(email);
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

// メールアドレスの配列から {email, name, color} の配列を作る。
// Todo/GoalタブはiframeでメンバーのMemberリストと同じ色を使いたいので、
// この結果をあとでpostMessageでも渡せるよう、renderMembersから切り出してある。
async function resolveMemberInfo(emails) {
  // 自分の端末のlocalStorageに無い（＝他の人のアカウントの）メールだけ、
  // Firestoreのusersコレクションへ問い合わせて色・名前を取得する
  const unknown = emails.filter(email => {
    const local = loadUserProfile(email);
    return !(local && local.favoriteColor) && !(email in memberProfileCache);
  });
  await Promise.all(unknown.map(async (email) => {
    try {
      const key = email.trim().toLowerCase();
      const doc = await db.collection('users').doc(key).get();
      memberProfileCache[email] = doc.exists ? doc.data() : null;
    } catch (err) {
      memberProfileCache[email] = null;
    }
  }));

  return emails.map((email) => {
    // 優先順位：自分の端末のプロフィール → Firestore上の他メンバーのプロフィール
    // → メールアドレスから作った固定のフォールバック色
    const localProfile = loadUserProfile(email);
    const cloudProfile = memberProfileCache[email];
    const color = (localProfile && localProfile.favoriteColor)
      || (cloudProfile && cloudProfile.favoriteColor)
      || fallbackColorFromEmail(email);
    const name = (localProfile && localProfile.name)
      || (cloudProfile && cloudProfile.name)
      || email.split('@')[0];
    return { email, name, color };
  });
}

// Todo/Goalタブが直近で受け取ったメンバー情報（postMessageで問い合わせてきたときに返す用）
let lastMemberInfo = [];

// Todo/Goalなど埋め込みiframe側にも同じ色・名前を渡す
// （担当者の色をMemberリストと固定でそろえるため）
function broadcastMembersToIframes(memberInfo) {
  document.querySelectorAll('iframe.embedded-page').forEach(iframe => {
    if (!iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({ type: 'tb-members-update', members: memberInfo }, '*');
    } catch (e) { /* ignore */ }
  });
}

async function renderMembers(emails) {
  const box = document.getElementById('member-list');

  const memberInfo = await resolveMemberInfo(emails);
  lastMemberInfo = memberInfo;
  broadcastMembersToIframes(memberInfo);

  if (!box) return;
  // Member欄はメールアドレスではなく、設定してもらった名前を表示する
  // （招待欄は引き続きメールアドレスで入力してもらう。そちらは変更していない）
  box.innerHTML = memberInfo.map(({ email, name, color }) => {
    const displayName = name || email;
    const initial = displayName.trim()[0]?.toUpperCase() || '?';
    const isYou = currentUser && email === currentUser.email;
    return `<div class="member-row">
      <div class="member-avatar" style="background:${color}">${initial}</div>
      <span class="member-email">${escHtml(displayName)}${isYou?'<span class="member-you">（あなた）</span>':''}</span>
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
    if (label) {
      label.textContent = '保存しました';
      setTimeout(() => { if (label.textContent === '保存しました') label.textContent = ''; }, 2000);
    }
  }, 600);
}
const goalTextEl = document.getElementById('goal-text');
const goalInfoEl = document.getElementById('goal-info');
if (goalTextEl) goalTextEl.addEventListener('input', scheduleGoalSave);
if (goalInfoEl) goalInfoEl.addEventListener('input', scheduleGoalSave);

// ===== タブ切り替え =====
const tabs = document.querySelectorAll('.tab-item[data-tab]');
const panels = document.querySelectorAll('.tab-panel');

// カテゴリーごとにGoal/To do/Opinion/Calendarの中身が混ざらないよう、埋め込みページには
// ?category=カテゴリーID を必ず付けて渡す（以前はGoalタブだけ意図的に除外されていて、
// それが「Goalのデータがカテゴリーをまたいで共有されてしまう」不具合の原因だった）
function showTabPanel(tabName) {
  if (!tabs.length || !panels.length) return;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  panels.forEach(p => {
    const isActive = p.dataset.panel === tabName;
    p.classList.toggle('active', isActive);
    const iframe = p.querySelector('iframe.embedded-page');
    if (iframe) {
      const base = EMBED_PAGES[tabName] || iframe.getAttribute('src');
      const src = base && selectedCategoryId
        ? base + (base.includes('?') ? '&' : '?') + 'category=' + encodeURIComponent(selectedCategoryId)
        : base;
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

// ===== アラーム通知（どのタブを見ていても気づけるように） =====
// Calendarタブのiframe（calender.html）は、アラームが鳴った瞬間にここへ
// postMessageで知らせてくる。今どのタブを表示していても、このページ全体に
// 固定表示されるバナーでお知らせする。
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'tb-alarm-fired') {
    showGlobalAlarmBanner(e.data.title);
  }
  // Todo/Goalタブのiframeが読み込まれた直後に「メンバー情報をください」と
  // 聞いてくるので、今わかっている最新のメンバー情報（色・名前）を返す。
  // こうしておくと、iframeが先に読み込み終わっていても後から読み込んでも
  // 確実にメンバーの色を受け取れる。
  if (e.data && e.data.type === 'tb-request-members') {
    if (e.source && typeof e.source.postMessage === 'function') {
      e.source.postMessage({ type: 'tb-members-update', members: lastMemberInfo }, '*');
    }
  }
});

function showGlobalAlarmBanner(title) {
  const banner = document.getElementById('global-alarm-banner');
  banner.innerHTML = `<div class="alarm-fire-card">
    <span class="alarm-fire-icon">⏰</span>
    <div class="alarm-fire-body">
      <strong>${escHtml(title)}</strong>
      <span>アラームの時間です！</span>
    </div>
    <button class="alarm-fire-dismiss" onclick="document.getElementById('global-alarm-banner').classList.remove('active')">✕</button>
  </div>`;
  banner.classList.add('active');
  setTimeout(() => banner.classList.remove('active'), 12000);
}