const members = [
  { name: '田中（あなた）', count: 6, color: '#f59e9b' },
  { name: '中村', count: 4, color: '#b7d9a1' },
  { name: '鈴木', count: 3, color: '#c8c8c8' },
  { name: '高橋', count: 2, color: '#c9bbe7' }
];

const memberList = document.getElementById('memberList');
const taskLegend = document.getElementById('taskLegend');
const totalTasksEl = document.getElementById('totalTasks');
const chartCanvas = document.getElementById('taskChart');
const ctx = chartCanvas.getContext('2d');

function renderMembers() {
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
  members.forEach(member => {
    const percent = Math.round((member.count / total) * 100);
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
  const centerX = chartCanvas.width / 2;
  const centerY = chartCanvas.height / 2;
  const radius = Math.min(centerX, centerY) - 24;
  let startAngle = -Math.PI / 2;

  ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);

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

  ctx.beginPath();
  ctx.fillStyle = '#f7f4ef';
  ctx.arc(centerX, centerY, radius * 0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = '600 24px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#4b443e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('負荷', centerX, centerY - 10);
  ctx.font = '500 16px "Noto Sans JP", sans-serif';
  ctx.fillText('割合', centerX, centerY + 18);
}

function init() {
  const total = members.reduce((sum, member) => sum + member.count, 0);
  renderMembers();
  renderLegend(total);
  totalTasksEl.textContent = total;
  drawChart(total);
}

window.addEventListener('DOMContentLoaded', init);
