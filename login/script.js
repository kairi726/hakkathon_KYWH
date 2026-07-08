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

function initSavedColor() {
  try {
    const saved = localStorage.getItem('favoriteColor');
    if (saved) {
      colorInput.value = saved;
      updateColorPreview();
    }
  } catch (e) {
    // localStorage unavailable — ignore
  }
}

function updateColorPreview() {
  const color = colorInput.value;
  colorPreview.style.backgroundColor = color;
  colorHelp.textContent = 'お好みの色を選べます。';
}

function setMode(mode) {
  const isSignup = mode === 'signup';

  toggleButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });

  formTitle.textContent = isSignup ? '新規登録' : '会員登録';
  formDescription.textContent = isSignup
    ? 'アカウントを作成して、サービスを始めましょう。'
    : '登録済みの情報でログインできます。';
  submitButton.textContent = isSignup ? '新規登録する' : 'ログインする';

  nameGroup.classList.toggle('hidden', !isSignup);
  confirmGroup.classList.toggle('hidden', !isSignup);
  colorGroup.classList.toggle('hidden', !colorSelectionReady);
  formMessage.textContent = '';
}

toggleButtons.forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

swatches.forEach((button) => {
  button.addEventListener('click', () => {
    colorInput.value = button.dataset.color;
    updateColorPreview();
  });
});

// ログイン後にマイページへ渡すユーザー情報（名前・メール・好きな色）
// file:// で開いた場合、ブラウザによってはページごとにlocalStorageが分離されて
// 見えないことがあるため、保険としてURLパラメータでも直接渡す。
function goToMyPage(name, email) {
  let favoriteColor = null;
  try {
    favoriteColor = localStorage.getItem('favoriteColor');
    localStorage.setItem('tb_current_user', JSON.stringify({
      name: name || (email ? email.split('@')[0] : ''),
      email: email || '',
      favoriteColor: favoriteColor || null,
    }));
  } catch (e) {
    console.warn('localStorage unavailable', e);
  }
  const params = new URLSearchParams({
    name: name || (email ? email.split('@')[0] : ''),
    email: email || '',
  });
  if (favoriteColor) params.set('color', favoriteColor);
  // 相対パスにして、file:// でもローカルサーバーでも同じように遷移できるようにする
  location.href = '../mypage/mypage.html?' + params.toString();
}

confirmColorBtn.addEventListener('click', () => {
  const selected = colorInput.value;
  try {
    localStorage.setItem('favoriteColor', selected);
  } catch (e) {
    console.warn('localStorage unavailable', e);
  }
  formMessage.style.color = '#0f766e';
  formMessage.textContent = '色を保存しました。';
});

colorInput.addEventListener('input', updateColorPreview);
updateColorPreview();
initSavedColor();

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
    // After signup, clear the login fields so they don't carry over
    authForm.reset();
    initSavedColor();
    colorSelectionReady = true;
    colorGroup.classList.remove('hidden');
    updateColorPreview();
    formMessage.textContent = '新規登録が完了しました。会員登録に進めます。';
    setMode('login');
    return;
  }

  // ログインは常にマイページへ進む（色選択は任意のおまけで、無くても進める）
  const email = document.getElementById('email').value.trim();
  const nameValue = document.getElementById('name').value.trim(); // ログイン画面では入力欄が隠れているため空のことが多い

  let saved = null;
  try {
    saved = localStorage.getItem('favoriteColor');
  } catch (e) {
    /* ignore */
  }

  if (!saved) {
    colorSelectionReady = true;
    colorGroup.classList.remove('hidden');
    updateColorPreview();
  }

  formMessage.textContent = 'ログインしました。マイページに移動します…';
  setTimeout(() => goToMyPage(nameValue, email), 500);
});

setMode('login');
