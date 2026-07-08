// このページはmypage.jsからiframeで埋め込まれ、
// ?category=カテゴリーID というクエリパラメータが付けて渡されてくる。
// 以前は mypage.js の EMBED_PAGES に 'goal' が登録されておらず、
// このページだけ ?category= が渡されないまま常に同じキーを見ていたため、
// カテゴリーを切り替えても円グラフの中身が変わらなかった。
// todo/script.js と同じ組み立て方でキーを作ることで、Todoの内容と一致させる。
const params = new URLSearchParams(location.search);
const CATEGORY_ID = params.get('category') || 'default';

const USER_KEY = 'tb_current_user';
const TODO_STORAGE_KEY = 'todo-items-' + CATEGORY_ID;
const COLOR_PALETTE = ['#ffcfda', '#fff5b7', '#c8f7c5', '#e9d5ff', '#cffafe', '#9cd0d8'];

let members = [];

const memberList = document.getElementById('memberList');
const taskLegend = document.getElementById('taskLegend');
const totalTasksEl = document.getElementById('totalTasks');
const chartCanvas = document.getElementById('taskChart');
const ctx = chartCanvas ? chartCanvas.getContext('2d') : null;

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
  try {
    return JSON.parse(localStorage.getItem(TODO_STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
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

function buildMembers() {
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

  ctx.font = '600 24px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#4b443e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total > 0 ? '負荷' : '0', centerX, centerY - 10);
  ctx.font = '500 16px "Noto Sans JP", sans-serif';
  ctx.fillText(total > 0 ? '割合' : '件', centerX, centerY + 18);
}

function init() {
  members = buildMembers();
  const total = members.reduce((sum, member) => sum + member.count, 0);
  if (memberList) renderMembers();
  if (taskLegend) renderLegend(total);
  if (totalTasksEl) totalTasksEl.textContent = total;
  drawChart(total);
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('storage', init);
window.addEventListener('todo-data-updated', init);