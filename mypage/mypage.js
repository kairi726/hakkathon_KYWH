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
const CATEGORY_COLORS = ['#ffcfda','#fff5b7','#c8f7c5','#e9d5ff','#cffafe','#e5aad2'];

// 埋め込みページ（相対パス。mypage/ から見た位置）
// ※ 以前は 'goal' がこの一覧に無かったため、Goalタブだけ ?category= が
//   渡らず、常に固定の src="../goal/goal.html" のままだった。
const EMBED_PAGES = {
  goal: '../goal/goal.html',
  todo: '../todo/index.html',
  calendar: '../calender/calender.html',
  opinion: '../opinion/opinion.html',
  ai: '../chat/chat.html', // 「AI Asistant」だったタブを、カテゴリー内チャットに変更
};

let selectedCategoryId = null;
let currentActiveTab = null; // 今開いているタブ（'goal'|'todo'|'opinion'|'calendar'|'ai'など）。
                              // Chatタブを実際に見ている間は、そのカテゴリーの通知を出さないようにするため。
let selectedColor = CATEGORY_COLORS[0];
let categories = [];
let unsubCategories = null;
let unsubCategoryDoc = null;
let unsubGoalDoc = null;
let saveTimer = null;
let lastCategoryMemberEmails = []; // 今表示中のカテゴリーのメンバー一覧（名前変更後にMember欄をすぐ再描画するため）

// ------------------------------------------------------------
// 「今日やるタスク」：全カテゴリー横断で、自分が担当のTodo（未完了）と
// 今日・明日締切のCalendar項目をまとめて表示するためのstate。
// カテゴリーごとにtodos/deadlinesサブコレクションを購読し、参加している
// カテゴリーが増減したら購読も追従させる。
// ------------------------------------------------------------
let todayTaskUnsubs = {}; // { [categoryId]: () => void }
let myTodosByCategory = {}; // { [categoryId]: todo[] }（自分担当・未完了のみ）
let myDeadlinesByCategory = {}; // { [categoryId]: deadline[] }（今日・明日締切のみ）

// 「助けてー」：自分以外の担当タスクがneedsHelp:trueになったら、カテゴリーの
// 全メンバーに知らせる。helpRequestsByCategoryは常に今アクティブな要請の一覧、
// notifiedHelpIdsは「もうポップアップ済み」の要請を覚えておいて、解決されるまで
// 同じ要請で何度もポップアップが出ないようにするためのもの。
let helpRequestsByCategory = {}; // { [categoryId]: {id, task, assignee, assigneeEmail}[] }
let notifiedHelpIds = new Set(); // "categoryId:todoId" のセット

// ------------------------------------------------------------
// チャットの新着通知：カテゴリーを問わず、自分以外の誰かがメッセージを
// 送ったら、今どのタブ・どのカテゴリーを見ていてもポップアップ＋一覧で
// 気づけるようにする。「助けてー」と同じ考え方だが、対象はchatの新着メッセージ。
// ------------------------------------------------------------
let chatUnreadByCategory = {}; // { [categoryId]: {count, catName, catColor, lastAuthor, lastText} }
let chatSeenMessageIds = {}; // { [categoryId]: Set<messageId> }（通知済み・既存のメッセージID）
let chatSubsInitialized = {}; // { [categoryId]: boolean }（初回スナップショットかどうか＝既存メッセージで誤通知しないため）

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// メールアドレスの表記ゆれ（大文字・小文字、前後の空白）で招待が届かない事故を防ぐため、
// 保存・比較の前に必ずこれを通す（大文字で登録しても小文字で招待しても一致するように）
function normEmail(s) { return String(s || '').trim().toLowerCase(); }

// 招待リンクの ?join=... を一時保存（ログイン後に処理する）
const pendingJoinId = new URLSearchParams(location.search).get('join');

// ------------------------------------------------------------
// 招待の「見た目での通知」
// ------------------------------------------------------------
// 実際のメール送信（SMTP等）を行うには外部サービスの契約・APIキー設定が
// 必要になるため、代わりにこのマイページ自身で「招待されている」ことが
// はっきり分かるようにする：招待されたカテゴリーが初めて自分の一覧に
// 現れたときに、バナーと「NEW」バッジで知らせる。
// ------------------------------------------------------------
function seenCategoriesKey(email) { return 'tb_seen_categories_' + normEmail(email); }
function loadSeenCategoryIds(email) {
  try { return new Set(JSON.parse(localStorage.getItem(seenCategoriesKey(email))) || []); }
  catch { return new Set(); }
}
function markCategoriesSeen(email, ids) {
  const set = loadSeenCategoryIds(email);
  ids.forEach(id => set.add(id));
  try { localStorage.setItem(seenCategoriesKey(email), JSON.stringify([...set])); } catch { /* ignore */ }
}

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
    const email = normEmail(document.getElementById('email').value);

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
  const email = normEmail(document.getElementById('email').value);
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
  unsubscribeAllTodayTasks();
  categories = [];
  currentUser = null;
  pendingSignupEmail = null;
  localStorage.removeItem(USER_KEY);
  document.getElementById('app-screen').style.display = 'none';
  authForm.reset();
  setMode('login');
  document.getElementById('login-screen').style.display = '';
});

function updateUserEmailLabel() {
  // 右上にはメールアドレスは出さず、名前だけ表示する
  document.getElementById('user-name-btn').textContent = currentUser.name || '（名前未設定）';
}

// ------------------------------------------------------------
// 右上の名前ボタン：押すとアカウント情報パネルがマイページ上に開き、
// その場で名前を変更できる（以前はwindow.prompt()を使っていたが、
// 環境によってはダイアログがブロックされて反応しないことがあったため、
// ページ内のパネルに変更した）。
// ------------------------------------------------------------
const userNameBtn = document.getElementById('user-name-btn');
const accountPanel = document.getElementById('account-panel');
const accountNameInput = document.getElementById('account-name-input');
const accountEmailDisplay = document.getElementById('account-email-display');
const accountSaveBtn = document.getElementById('account-save-btn');
const accountSaveMsg = document.getElementById('account-save-msg');
const accountColorPalette = document.getElementById('account-color-palette');
const accountColorInput = document.getElementById('account-color-input');
const accountColorPreview = document.getElementById('account-color-preview');
let selectedAccountColor = CATEGORY_COLORS[0];

// 同じカテゴリー内で色がかぶって見分けづらくなったときのために、
// 名前の変更と同じ場所で自分の色も選び直せるようにする
accountColorPalette.innerHTML = CATEGORY_COLORS.map(c =>
  `<div class="color-swatch" data-color="${c}" style="background:${c}"></div>`
).join('');

function highlightAccountColor(color) {
  selectedAccountColor = color;
  accountColorPalette.querySelectorAll('.color-swatch').forEach(el => {
    el.classList.toggle('selected', el.dataset.color.toLowerCase() === color.toLowerCase());
  });
  accountColorInput.value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#c8f7c5';
  accountColorPreview.textContent = color;
}

accountColorPalette.addEventListener('click', (e) => {
  const swatch = e.target.closest('.color-swatch');
  if (!swatch) return;
  highlightAccountColor(swatch.dataset.color);
});

accountColorInput.addEventListener('input', () => {
  highlightAccountColor(accountColorInput.value);
});

function openAccountPanel() {
  if (!currentUser) return;
  accountNameInput.value = currentUser.name || '';
  accountEmailDisplay.textContent = currentUser.email || '';
  accountSaveMsg.textContent = '';
  const profile = loadUserProfile(currentUser.email);
  highlightAccountColor((profile && profile.favoriteColor) || currentUser.favoriteColor || CATEGORY_COLORS[0]);
  accountPanel.style.display = 'flex';
}
function closeAccountPanel() {
  accountPanel.style.display = 'none';
}

userNameBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (accountPanel.style.display === 'flex') {
    closeAccountPanel();
  } else {
    openAccountPanel();
  }
});

accountSaveBtn.addEventListener('click', () => {
  if (!currentUser) return;
  const newName = accountNameInput.value.trim();
  if (!newName) {
    accountSaveMsg.style.color = '#b91c1c';
    accountSaveMsg.textContent = '名前を空にはできません。';
    return;
  }

  currentUser.name = newName;
  currentUser.favoriteColor = selectedAccountColor;
  saveStoredUser(currentUser);
  // ローカル＋Firestore（users/<email>）に保存。これでMember欄・Todo・Goal・
  // Opinion・Calendarどこから見ても、名前と同時に新しい色が反映される
  saveUserProfile(currentUser.email, { name: newName, favoriteColor: selectedAccountColor });
  updateUserEmailLabel();

  // 今カテゴリー詳細画面を開いていれば、Member欄の名前・色もすぐに更新する
  if (selectedCategoryId) renderMembers(lastCategoryMemberEmails);

  accountSaveMsg.style.color = '#0f766e';
  accountSaveMsg.textContent = '保存しました。';
});

// パネルの外側をクリックしたら閉じる
document.addEventListener('click', (e) => {
  if (accountPanel.style.display === 'flex' && !accountPanel.contains(e.target) && e.target !== userNameBtn) {
    closeAccountPanel();
  }
});

async function startApp() {
  document.getElementById('app-screen').style.display = 'block';
  updateUserEmailLabel();

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
      updateInviteNotice();
      syncTodayTaskSubscriptions();
      renderTodayTasks();
      // 表示中だったカテゴリーが無くなっていたら一覧画面に戻す
      if (selectedCategoryId && !categories.find(c => c.id === selectedCategoryId)) {
        showCategoryListScreen();
      }
    }, err => console.error('categories購読エラー', err));
}

// ------------------------------------------------------------
// 今日やるタスク：カテゴリーごとのtodos/deadlines購読を、参加カテゴリーの
// 増減に合わせて追加・解除する
// ------------------------------------------------------------
function todayDateStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function tomorrowDateStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function subscribeTodayTasksForCategory(cat) {
  const id = cat.id;
  if (todayTaskUnsubs[id]) return; // 既に購読済み

  const todosRef = db.collection('categories').doc(id).collection('todos');
  const deadlinesRef = db.collection('categories').doc(id).collection('deadlines');

  const unsubTodos = todosRef.onSnapshot(snap => {
    const allTodos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    myTodosByCategory[id] = allTodos.filter(t => t.assigneeEmail === currentUser.email && t.status !== 'completed');
    updateHelpRequestsForCategory(id, cat, allTodos);
    renderTodayTasks();
  }, err => console.error('今日のタスク（Todo）購読エラー', err));

  const unsubDeadlines = deadlinesRef.onSnapshot(snap => {
    const today = todayDateStr();
    const tomorrow = tomorrowDateStr();
    myDeadlinesByCategory[id] = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(d => !d.done && d.datetime && (d.datetime.slice(0, 10) === today || d.datetime.slice(0, 10) === tomorrow));
    renderTodayTasks();
  }, err => console.error('今日のタスク（締切）購読エラー', err));

  // Firestoreの「docChanges()」で本当に新規追加されたドキュメントだけを拾う。
  // 以前はorderBy('createdAt','desc').limit(1)で「一番新しい1件」だけを比較していたが、
  // サーバー側のタイムスタンプ確定タイミングや、複数件がまとめて届いた場合に
  // 取りこぼす可能性があったため、より確実なdocChanges方式に変更した。
  // 初回のスナップショット（＝ページを開いた時点で既にある過去メッセージ）では
  // 通知しない。
  const messagesRef = db.collection('categories').doc(id).collection('messages');
  const unsubMessages = messagesRef.onSnapshot(snap => {
    const wasInitialized = chatSubsInitialized[id];
    chatSubsInitialized[id] = true;

    if (!wasInitialized) {
      // 既にある過去メッセージは「見た（＝通知不要）」ものとして記録するだけ
      chatSeenMessageIds[id] = new Set(snap.docs.map(d => d.id));
      return;
    }

    const seen = chatSeenMessageIds[id] || (chatSeenMessageIds[id] = new Set());
    snap.docChanges().forEach(change => {
      if (change.type !== 'added') return;
      if (seen.has(change.doc.id)) return; // 二重通知防止
      seen.add(change.doc.id);

      const data = change.doc.data();
      if (data.authorEmail && currentUser && data.authorEmail === currentUser.email) return; // 自分の投稿では通知しない
      // 今まさにこのカテゴリーのChatタブを開いて見ているなら、重ねて通知は出さない。
      // （他のカテゴリーを見ているときや、同じカテゴリーでも別のタブを見ているときは
      // 今まで通り通知する）
      if (selectedCategoryId === id && currentActiveTab === 'ai') return;

      const preview = data.text || (data.imageUrl ? '📷 写真を送信しました' : '');
      const personName = data.authorName || data.authorEmail || '誰か';
      chatUnreadByCategory[id] = {
        count: (chatUnreadByCategory[id]?.count || 0) + 1,
        catName: cat.name, catColor: cat.color,
        lastAuthor: personName, lastText: preview,
      };
      showChatBanner(id, cat.name, personName, preview);
      renderChatNotifications();
    });
  }, err => console.error('チャット通知の購読エラー', err));

  todayTaskUnsubs[id] = () => { unsubTodos(); unsubDeadlines(); unsubMessages(); };
}

function unsubscribeTodayTasksForCategory(id) {
  if (todayTaskUnsubs[id]) {
    todayTaskUnsubs[id]();
    delete todayTaskUnsubs[id];
  }
  delete myTodosByCategory[id];
  delete myDeadlinesByCategory[id];
  delete helpRequestsByCategory[id];
  Array.from(notifiedHelpIds).forEach(key => {
    if (key.startsWith(id + ':')) notifiedHelpIds.delete(key);
  });
  renderHelpRequestsList();

  delete chatUnreadByCategory[id];
  delete chatSeenMessageIds[id];
  delete chatSubsInitialized[id];
  renderChatNotifications();
}

// 自分以外の担当タスクで助けを求めているものを拾い、
// ①一覧画面に表示し続ける、②新しく出てきたものだけポップアップで知らせる
function updateHelpRequestsForCategory(catId, cat, allTodos) {
  const active = allTodos.filter(t => t.needsHelp && t.assigneeEmail !== currentUser.email);
  helpRequestsByCategory[catId] = active.map(t => ({
    id: t.id, task: t.task, assignee: t.assignee, assigneeEmail: t.assigneeEmail,
  }));

  active.forEach(t => {
    const key = catId + ':' + t.id;
    if (!notifiedHelpIds.has(key)) {
      notifiedHelpIds.add(key);
      showHelpBanner(cat.name, t.assignee || t.assigneeEmail || '誰か', t.task);
    }
  });

  // 解決済みになったものはキーを消して、また助けを求めたら再度ポップアップされるようにする
  const activeKeys = new Set(active.map(t => catId + ':' + t.id));
  Array.from(notifiedHelpIds).forEach(key => {
    if (key.startsWith(catId + ':') && !activeKeys.has(key)) notifiedHelpIds.delete(key);
  });

  renderHelpRequestsList();
}

function showHelpBanner(catName, personName, taskName) {
  const banner = document.getElementById('global-help-banner');
  if (!banner) return;
  banner.innerHTML = `<div class="help-fire-card">
    <span class="help-fire-icon">🆘</span>
    <div class="help-fire-body">
      <strong>${escHtml(catName)}</strong>
      <span>${escHtml(personName)}さんが「${escHtml(taskName)}」で助けてー、と言っています</span>
    </div>
    <button class="help-fire-dismiss" onclick="document.getElementById('global-help-banner').classList.remove('active')">✕</button>
  </div>`;
  banner.classList.add('active');
  setTimeout(() => banner.classList.remove('active'), 12000);
}

function renderHelpRequestsList() {
  const box = document.getElementById('help-requests-box');
  const list = document.getElementById('help-requests-list');
  if (!box || !list) return;

  const items = [];
  categories.forEach(cat => {
    (helpRequestsByCategory[cat.id] || []).forEach(r => {
      items.push({
        catId: cat.id, catName: cat.name, catColor: cat.color,
        task: r.task, person: r.assignee || r.assigneeEmail || '誰か',
      });
    });
  });

  if (items.length === 0) {
    box.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  box.style.display = 'block';
  list.innerHTML = items.map(it => `
    <div class="today-task-item" onclick="selectCategory('${it.catId}')">
      <span class="today-task-cat" style="background:${it.catColor || CATEGORY_COLORS[0]}">${escHtml(it.catName)}</span>
      <span class="today-task-badge today-task-badge-help">🆘 助けてー</span>
      <span class="today-task-title">${escHtml(it.person)}さん：${escHtml(it.task)}</span>
    </div>
  `).join('');
}

function showChatBanner(catId, catName, personName, preview) {
  const banner = document.getElementById('global-chat-banner');
  if (!banner) return;
  // カード本体（✕ボタン以外）をクリックしたら、そのカテゴリーのChatタブへ直接飛ぶ
  banner.innerHTML = `<div class="chat-fire-card" onclick="openCategoryChat('${catId}')">
    <span class="chat-fire-icon">💬</span>
    <div class="chat-fire-body">
      <strong>${escHtml(catName)}</strong>
      <span>${escHtml(personName)}さん：${escHtml(preview)}</span>
    </div>
    <button class="chat-fire-dismiss" onclick="event.stopPropagation(); document.getElementById('global-chat-banner').classList.remove('active')">✕</button>
  </div>`;
  banner.classList.add('active');
  setTimeout(() => banner.classList.remove('active'), 12000);
}

function renderChatNotifications() {
  const box = document.getElementById('chat-notifications-box');
  const list = document.getElementById('chat-notifications-list');
  if (!box || !list) return;

  const items = Object.keys(chatUnreadByCategory)
    .map(catId => ({ catId, ...chatUnreadByCategory[catId] }))
    .filter(it => it.count > 0);

  if (items.length === 0) {
    box.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  box.style.display = 'block';
  list.innerHTML = items.map(it => `
    <div class="today-task-item" onclick="openCategoryChat('${it.catId}')">
      <span class="today-task-cat" style="background:${it.catColor || CATEGORY_COLORS[0]}">${escHtml(it.catName)}</span>
      <span class="today-task-badge today-task-badge-chat">💬 ${it.count}件</span>
      <span class="today-task-title">${escHtml(it.lastAuthor)}さん：${escHtml(it.lastText)}</span>
    </div>
  `).join('');
}

// 新着チャットの一覧をクリックしたら、そのカテゴリーのChatタブを直接開く
window.openCategoryChat = function (catId) {
  selectCategory(catId);
  showTabPanel('ai');
};

function syncTodayTaskSubscriptions() {
  const currentIds = new Set(categories.map(c => c.id));
  categories.forEach(cat => subscribeTodayTasksForCategory(cat));
  Object.keys(todayTaskUnsubs).forEach(id => {
    if (!currentIds.has(id)) unsubscribeTodayTasksForCategory(id);
  });
}

function unsubscribeAllTodayTasks() {
  Object.keys(todayTaskUnsubs).forEach(id => unsubscribeTodayTasksForCategory(id));
}

function renderTodayTasks() {
  const box = document.getElementById('today-tasks-box');
  const list = document.getElementById('today-tasks-list');
  if (!box || !list) return;

  const today = todayDateStr();
  const items = [];
  categories.forEach(cat => {
    (myTodosByCategory[cat.id] || []).forEach(t => {
      items.push({ type: 'todo', catId: cat.id, catName: cat.name, catColor: cat.color, title: t.task, status: t.status });
    });
    (myDeadlinesByCategory[cat.id] || []).forEach(d => {
      items.push({
        type: 'deadline', catId: cat.id, catName: cat.name, catColor: cat.color,
        title: d.title, datetime: d.datetime, isToday: d.datetime.slice(0, 10) === today,
      });
    });
  });

  if (items.length === 0) {
    box.style.display = 'block';
    list.innerHTML = '<p class="today-tasks-empty">今日やるべきタスクはありません。</p>';
    return;
  }

  // 締切が近い順（今日締切→明日締切）に並べ、その後にTodoを続ける
  items.sort((a, b) => {
    if (a.type === 'deadline' && b.type === 'deadline') return a.datetime.localeCompare(b.datetime);
    if (a.type === 'deadline') return -1;
    if (b.type === 'deadline') return 1;
    return 0;
  });

  box.style.display = 'block';
  list.innerHTML = items.map(it => {
    const catChip = `<span class="today-task-cat" style="background:${it.catColor || CATEGORY_COLORS[0]}">${escHtml(it.catName)}</span>`;
    if (it.type === 'deadline') {
      const badgeClass = it.isToday ? 'today-task-badge-deadline-today' : 'today-task-badge-deadline-tomorrow';
      const badgeText = it.isToday ? '今日締切' : '明日締切';
      return `
      <div class="today-task-item" onclick="selectCategory('${it.catId}')">
        ${catChip}
        <span class="today-task-badge ${badgeClass}">${badgeText}</span>
        <span class="today-task-title">${escHtml(it.title)}</span>
      </div>`;
    }
    const statusText = it.status === 'ongoing' ? '進行中' : '未着手';
    return `
    <div class="today-task-item" onclick="selectCategory('${it.catId}')">
      ${catChip}
      <span class="today-task-badge today-task-badge-todo">${statusText}</span>
      <span class="today-task-title">${escHtml(it.title)}</span>
    </div>`;
  }).join('');
}

// 自分が作成者ではない（＝誰かに招待された）カテゴリーのうち、
// まだ一度も開いたことが無いものを「新しい招待」として扱う
function getNewInvites() {
  if (!currentUser) return [];
  const seen = loadSeenCategoryIds(currentUser.email);
  return categories.filter(c => c.ownerEmail !== currentUser.email && !seen.has(c.id));
}

function updateInviteNotice() {
  const notice = document.getElementById('invite-notice');
  if (!notice) return;
  const newInvites = getNewInvites();
  if (newInvites.length === 0) {
    notice.style.display = 'none';
    return;
  }
  const names = newInvites.map(c => c.name).join('、');
  document.getElementById('invite-notice-text').textContent =
    `🎉 ${newInvites.length}件のカテゴリーに招待されています：${names}`;
  notice.style.display = 'flex';
}

document.getElementById('invite-notice-dismiss').addEventListener('click', () => {
  if (!currentUser) return;
  markCategoriesSeen(currentUser.email, getNewInvites().map(c => c.id));
  updateInviteNotice();
  renderCategoryChips();
});

function renderCategoryChips() {
  const box = document.getElementById('category-list-chips');
  const seen = currentUser ? loadSeenCategoryIds(currentUser.email) : new Set();
  box.innerHTML = categories.map(c => {
    const isNew = currentUser && c.ownerEmail !== currentUser.email && !seen.has(c.id);
    return `
    <div class="category-chip ${c.id===selectedCategoryId?'active':''}"
         style="background:${c.color||CATEGORY_COLORS[0]}"
         onclick="selectCategory('${c.id}')">${escHtml(c.name)}${isNew ? '<span class="new-badge">NEW</span>' : ''}</div>
  `;
  }).join('');
  document.getElementById('no-category-msg').style.display = categories.length ? 'none' : 'flex';
}

// ===== 画面切り替え：一覧 ⇔ 詳細 =====
function showCategoryListScreen() {
  selectedCategoryId = null;
  currentActiveTab = null;
  document.getElementById('category-content').style.display = 'none';
  document.getElementById('category-list-screen').style.display = 'block';
  document.getElementById('category-form-box').style.display = 'none';
  renderCategoryChips();
  updateInviteNotice();
}

window.selectCategory = function (id) {
  selectedCategoryId = id;
  if (currentUser) markCategoriesSeen(currentUser.email, [id]); // 開いたら「NEW」を消す
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
      lastCategoryMemberEmails = doc.data().memberEmails || [];
      renderMembers(lastCategoryMemberEmails);
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

// 「自分が誰か」をiframe側に伝えるための情報。
// 以前はTodo/Opinion/Goal/Calendarの各iframeが自分でlocalStorageの
// tb_current_userを読んでいたが、HTMLファイルを直接開いた場合（file://）は
// ファイルごとに保存領域が分かれてしまい、親ページ（mypage.html）が保存した
// localStorageがiframe側からは見えない、という問題があった（ローカルサーバー
// 経由やhttps配信では問題なく共有されるが、file://だと共有されない）。
// postMessageは通信元の保存領域に関係なく届くので、こちらに乗せて渡す。
function currentUserForIframes() {
  return currentUser ? { email: currentUser.email, name: currentUser.name } : null;
}

// Todo/Goalなど埋め込みiframe側にも同じ色・名前を渡す
// （担当者の色をMemberリストと固定でそろえるため）
function broadcastMembersToIframes(memberInfo) {
  document.querySelectorAll('iframe.embedded-page').forEach(iframe => {
    if (!iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({ type: 'tb-members-update', members: memberInfo, me: currentUserForIframes() }, '*');
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
  // 大文字・小文字の表記ゆれで「招待したのに相手に届かない」事故を防ぐため、
  // 保存前に必ず正規化する（相手のアカウントのメールアドレスも同じ正規化を通してある）
  const email = normEmail(document.getElementById('invite-email').value);
  const msgEl = document.getElementById('invite-msg');
  if (!email || !selectedCategoryId) return;
  try {
    await db.collection('categories').doc(selectedCategoryId).update({
      memberEmails: FieldValue.arrayUnion(email),
    });
    msgEl.textContent = email + ' を招待しました。相手が次にこのメールアドレスでマイページを開くと、カテゴリー一覧に「招待されています」というお知らせと一緒に表示されます。';
    document.getElementById('invite-email').value = '';
  } catch (err) {
    msgEl.textContent = '招待に失敗しました：' + (err.message || err.code);
  }
});

// ===== 共有リンク =====
document.getElementById('share-link-btn').addEventListener('click', async () => {
  if (!selectedCategoryId) return;
  const url = location.origin + location.pathname + '?join=' + selectedCategoryId;

  const resultBox = document.getElementById('share-link-result');
  const linkInput = document.getElementById('share-link-text');
  const msgEl = document.getElementById('share-link-copied-msg');

  // window.alert()/prompt()は環境によってはブロックされて何も起きないことが
  // あったため使わない。リンクは必ずこの欄に表示するので、コピーが失敗しても
  // ここから選択して手動でコピー・共有できる。
  linkInput.value = url;
  resultBox.style.display = 'flex';
  linkInput.focus();
  linkInput.select();

  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      copied = true;
    }
  } catch (e) { copied = false; }

  if (!copied) {
    // Clipboard APIが使えない環境向けのフォールバック
    try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
  }

  // 確認ボタンを押さなくていい、ふわっと出て自動で消えるパステルの通知
  msgEl.textContent = copied
    ? 'リンクをコピーしました！'
    : 'コピーできませんでした。上の欄から手動でコピーしてください。';
  msgEl.classList.toggle('is-error', !copied);
  msgEl.classList.add('show');
  clearTimeout(msgEl._hideTimer);
  msgEl._hideTimer = setTimeout(() => msgEl.classList.remove('show'), 2500);
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

  currentActiveTab = tabName;

  // Chatタブを実際に開いたら、そのカテゴリーの新着通知は「読んだ」ものとして消す
  if (tabName === 'ai' && selectedCategoryId && chatUnreadByCategory[selectedCategoryId]) {
    delete chatUnreadByCategory[selectedCategoryId];
    renderChatNotifications();
  }

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

      // Chatタブ（既読管理）向け：iframe自体はタブを切り替えても裏で読み込まれた
      // ままなので、「今実際に画面に表示されているか」をここで明示的に伝える。
      // これが無いと、見ていないタブのメッセージにまで既読が付いてしまう。
      if (iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ type: 'tb-panel-visibility', visible: isActive }, '*');
        } catch (e) { /* ignore */ }
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
      e.source.postMessage({ type: 'tb-members-update', members: lastMemberInfo, me: currentUserForIframes() }, '*');
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