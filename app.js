/* ============================================================
 * 我的课表 App - 核心逻辑
 * 功能：课表展示 / 课程提醒 / 截图OCR导入 / 时间管理 / 数据持久化
 * ============================================================ */

/* ---------- 全局状态 ---------- */
const STATE = {
  courses: [],          // 课程列表
  currentWeek: 1,       // 当前查看周
  termStart: null,      // 学期开始日期（周一）
  periods: [],          // 节次时间表
  settings: {
    reminderEnabled: true,
    advanceMinutes: 5,
    sound: 'on'
  },
  editingId: null,      // 正在编辑的课程id
  recognizedCourses: [] // OCR识别结果
};

const COLORS = [
  '#4f7cff','#ff6b6b','#ffa94d','#51cf66','#22b8cf',
  '#cc5de8','#f06595','#845ef7','#20c997','#ffd43b'
];
const DAY_NAMES = ['周一','周二','周三','周四','周五','周六','周日'];
const STORAGE_KEY = 'my_schedule_data_v1';

/* ---------- 工具函数 ---------- */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function uid() { return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }
function pad(n) { return n < 10 ? '0'+n : ''+n; }
function showToast(msg, ms=2000) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(()=>t.classList.remove('show'), ms);
}
function getMonday(d) {
  d = new Date(d);
  const day = d.getDay(); const diff = d.getDate() - day + (day===0 ? -6 : 1);
  d.setDate(diff); d.setHours(0,0,0,0);
  return d;
}

/* ---------- 默认节次时间 ---------- */
function defaultPeriods() {
  return [
    {s:'08:00',e:'08:45'}, {s:'08:55',e:'09:40'}, {s:'10:00',e:'10:45'}, {s:'10:55',e:'11:40'},
    {s:'14:00',e:'14:45'}, {s:'14:55',e:'15:40'}, {s:'16:00',e:'16:45'}, {s:'16:55',e:'17:40'},
    {s:'19:00',e:'19:45'}, {s:'19:55',e:'20:40'}, {s:'20:50',e:'21:35'}
  ];
}

/* ---------- 数据持久化 ---------- */
function saveData() {
  const data = {
    courses: STATE.courses,
    termStart: STATE.termStart,
    periods: STATE.periods,
    settings: STATE.settings
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      STATE.termStart = getMonday(new Date()).toISOString();
      STATE.periods = defaultPeriods();
      return;
    }
    const d = JSON.parse(raw);
    STATE.courses = d.courses || [];
    STATE.termStart = d.termStart || getMonday(new Date()).toISOString();
    STATE.periods = d.periods && d.periods.length ? d.periods : defaultPeriods();
    STATE.settings = Object.assign(STATE.settings, d.settings || {});
  } catch(e) {
    STATE.termStart = getMonday(new Date()).toISOString();
    STATE.periods = defaultPeriods();
  }
}

/* ---------- 周次计算 ---------- */
function getCurrentWeekNumber() {
  const start = new Date(STATE.termStart);
  const now = new Date();
  const ms = now - start;
  const w = Math.floor(ms / (7*24*3600*1000)) + 1;
  return Math.max(1, Math.min(w, 25));
}
function getWeekDate(weekNum) {
  const start = new Date(STATE.termStart);
  const d = new Date(start);
  d.setDate(d.getDate() + (weekNum-1)*7);
  return d;
}
function parseWeeks(str) {
  // 解析 "1-8,10-16" 或 "1,3,5"
  const weeks = new Set();
  if (!str) return weeks;
  str.split(/[,，]/).forEach(seg => {
    seg = seg.trim();
    if (!seg) return;
    if (seg.includes('-')) {
      const [a,b] = seg.split('-').map(x=>parseInt(x));
      if (!isNaN(a) && !isNaN(b)) for (let i=Math.min(a,b); i<=Math.max(a,b); i++) weeks.add(i);
    } else {
      const n = parseInt(seg);
      if (!isNaN(n)) weeks.add(n);
    }
  });
  return weeks;
}

/* ---------- 渲染课表 ---------- */
function renderSchedule() {
  const weekNum = STATE.currentWeek;
  const weekStart = getWeekDate(weekNum);
  $('#weekLabel').textContent = `第 ${weekNum} 周`;

  // 表头（星期+日期）
  const head = $('#scheduleHead');
  const today = new Date(); today.setHours(0,0,0,0);
  let headHTML = '<div class="head-cell">节次</div>';
  for (let i=0; i<7; i++) {
    const d = new Date(weekStart); d.setDate(d.getDate()+i);
    const isToday = d.getTime()===today.getTime();
    headHTML += `<div class="head-cell${isToday?' today':''}">${DAY_NAMES[i]}<span class="date-num">${d.getMonth()+1}/${d.getDate()}</span></div>`;
  }
  head.innerHTML = headHTML;

  // 表体
  const body = $('#scheduleBody');
  const periods = STATE.periods;
  const currentPeriod = getCurrentPeriod();

  // 生成时间列 + 空白格
  let html = '';
  for (let p=0; p<periods.length; p++) {
    const isCur = currentPeriod === p;
    html += `<div class="time-cell">
      <span class="period">${p+1}</span>
      <span class="time-range">${periods[p].s}</span>
    </div>`;
    for (let d=0; d<7; d++) {
      html += `<div class="grid-cell${isCur?' current-period':''}" data-day="${d+1}" data-period="${p}"></div>`;
    }
  }
  body.innerHTML = html;

  // 放置课程块
  STATE.courses.forEach(c => {
    const weeks = parseWeeks(c.weeks);
    if (!weeks.has(weekNum)) return;
    if (c.day < 1 || c.day > 7) return;
    const cells = body.querySelectorAll(`.grid-cell[data-day="${c.day}"]`);
    if (!cells.length) return;
    const startCell = cells[c.start-1];
    if (!startCell) return;
    const block = document.createElement('div');
    block.className = 'course-block';
    block.style.background = c.color;
    const span = (c.end - c.start + 1);
    // 计算高度：每格高度=56px(含border)，top/bottom 2px
    block.style.height = `calc(${span} * 56px - 4px)`;
    block.innerHTML = `<div class="cname">${escapeHTML(c.name)}</div>${c.room?`<div class="croom">${escapeHTML(c.room)}</div>`:''}`;
    block.dataset.id = c.id;

    // 当前节次高亮
    const now = new Date();
    const nowDay = now.getDay()===0?7:now.getDay();
    if (nowDay === c.day && weekNum === getCurrentWeekNumber()) {
      const curP = getCurrentPeriod();
      if (curP >= c.start-1 && curP <= c.end-1) block.classList.add('ongoing');
    }

    block.addEventListener('click', ()=> openCourseModal(c.id));
    startCell.appendChild(block);
  });
}

function escapeHTML(s) {
  const div = document.createElement('div');
  div.textContent = s||'';
  return div.innerHTML;
}

/* ---------- 时间功能 ---------- */
function getCurrentPeriod() {
  const now = new Date();
  const hm = now.getHours()*60 + now.getMinutes();
  for (let i=0; i<STATE.periods.length; i++) {
    const [sh,sm] = STATE.periods[i].s.split(':').map(Number);
    const [eh,em] = STATE.periods[i].e.split(':').map(Number);
    if (hm >= sh*60+sm && hm <= eh*60+em) return i;
  }
  return -1;
}

function updateClock() {
  const now = new Date();
  $('#clockTime').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const wd = ['日','一','二','三','四','五','六'][now.getDay()];
  $('#clockDate').textContent = `${now.getMonth()+1}月${now.getDate()}日 周${wd}`;
}

/* ---------- 提醒功能 ---------- */
let reminderTimer = null;
function startReminderLoop() {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(checkReminders, 30000); // 每30秒检查
  checkReminders();
}

function checkReminders() {
  if (!STATE.settings.reminderEnabled) return;
  const now = new Date();
  const nowDay = now.getDay()===0?7:now.getDay();
  const curWeek = getCurrentWeekNumber();
  const advance = STATE.settings.advanceMinutes;

  STATE.courses.forEach(c => {
    const weeks = parseWeeks(c.weeks);
    if (!weeks.has(curWeek) || c.day !== nowDay) return;
    const [sh,sm] = STATE.periods[c.start-1].s.split(':').map(Number);
    const startMin = sh*60 + sm;
    const nowMin = now.getHours()*60 + now.getMinutes();
    const diff = startMin - nowMin;
    // 在提前提醒时刻触发（精确到分钟窗口）
    if (diff >= 0 && diff <= advance) {
      const key = `notified_${c.id}_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key,'1');
        fireNotification(c, diff);
      }
    }
  });
}

function fireNotification(course, minutesLeft) {
  const title = minutesLeft === 0 ? `【上课中】${course.name}` : `【即将上课】${course.name}`;
  const body = `${minutesLeft===0?'现在':'还有'+minutesLeft+'分钟'}开始${course.room?(' · '+course.room):''}${course.teacher?(' · '+course.teacher):''}`;

  // 桌面通知
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icons/icon-192.png', tag: course.id }); } catch(e){}
  }
  // 应用内提示
  showToast(`${title} ${body}`, 4000);
  // 铃声
  if (STATE.settings.sound === 'on') playBeep();
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(); osc.stop(ctx.currentTime + 0.6);
  } catch(e){}
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) { showToast('当前浏览器不支持通知'); return; }
  if (Notification.permission === 'granted') { showToast('已授权通知'); return; }
  try {
    const res = await Notification.requestPermission();
    showToast(res==='granted'?'通知已开启':'通知权限被拒绝');
  } catch(e) { showToast('请求通知失败'); }
}

/* 即将到来课程列表 */
function renderUpcoming() {
  const list = $('#upcomingList');
  const now = new Date();
  const curWeek = getCurrentWeekNumber();
  const upcoming = [];

  // 收集今天及未来7天的课程
  for (let dayOffset=0; dayOffset<7; dayOffset++) {
    const d = new Date(now); d.setDate(d.getDate()+dayOffset);
    const dayNum = d.getDay()===0?7:d.getDay();
    STATE.courses.forEach(c => {
      const weeks = parseWeeks(c.weeks);
      // 简化：用当前周判断，跨周不深入
      if (!weeks.has(curWeek)) return;
      if (c.day !== dayNum) return;
      const [sh,sm] = STATE.periods[c.start-1].s.split(':').map(Number);
      const courseDate = new Date(d); courseDate.setHours(sh,sm,0,0);
      if (courseDate < now) return;
      upcoming.push({ course: c, date: courseDate, dayOffset });
    });
  }
  upcoming.sort((a,b)=>a.date-b.date);

  if (!upcoming.length) {
    list.innerHTML = '<div style="text-align:center;color:#bbb;padding:30px;font-size:13px">近期没有课程安排 🎉</div>';
    return;
  }
  list.innerHTML = upcoming.slice(0,8).map(u => {
    const diff = u.date - now;
    const mins = Math.floor(diff/60000);
    let cd;
    if (mins < 60) cd = `${mins}分钟后`;
    else if (mins < 1440) cd = `${Math.floor(mins/60)}小时后`;
    else cd = `${Math.floor(mins/1440)}天后`;
    const dayLabel = u.dayOffset===0?'今天':u.dayOffset===1?'明天':DAY_NAMES[u.course.day-1];
    return `<div class="upcoming-card">
      <div class="time-badge"><div class="t">${pad(u.date.getHours())}:${pad(u.date.getMinutes())}</div><div>${u.course.start}-${u.course.end}节</div></div>
      <div class="info"><div class="n">${escapeHTML(u.course.name)}</div><div class="d">${dayLabel} · ${u.course.room||'无地点'}${u.course.teacher?' · '+u.course.teacher:''}</div></div>
      <div class="countdown">${cd}</div>
    </div>`;
  }).join('');
}

/* ---------- OCR 截图识别 ---------- */
let selectedImage = null;
$('#fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    selectedImage = ev.target.result;
    $('#previewArea').innerHTML = `<img src="${selectedImage}" alt="预览">`;
    $('#btnRecognize').disabled = false;
    $('#ocrResult').style.display = 'none';
  };
  reader.readAsDataURL(file);
});

/* 图片预处理：仅放大到合适尺寸，不做二值化（Paddle OCR 内部自带预处理） */
function preprocessImage(dataUrl, maxWidth=2200) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w < 1600) { const s = 1600 / w; w = 1600; h = Math.round(h * s); }
      else if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ---------- OCR 引擎管理（Paddle.js 优先，Tesseract.js 兜底） ---------- */
let ocrEngine = null;           // 'paddle' | 'tesseract' | null
let paddleInitPromise = null;
let tesseractWorker = null;
let tesseractInitPromise = null;

/* 带超时的 Promise */
function withTimeout(promise, ms, msg='操作超时') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); },
                  e => { clearTimeout(timer); reject(e); });
  });
}

/* 尝试初始化 Paddle.js（中文识别质量高，但依赖 WebGL，部分环境不可用） */
function initPaddle() {
  if (paddleInitPromise) return paddleInitPromise;
  paddleInitPromise = (async () => {
    if (typeof paddlejs === 'undefined' || !paddlejs.ocr) throw new Error('Paddle.js 未加载');
    await withTimeout(paddlejs.ocr.init(), 25000, 'Paddle OCR 初始化超时');
    return 'paddle';
  })();
  return paddleInitPromise;
}

/* 初始化 Tesseract.js（基于 WebAssembly，兼容性好，中文识别稍弱） */
function initTesseract() {
  if (tesseractInitPromise) return tesseractInitPromise;
  tesseractInitPromise = (async () => {
    if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js 未加载');
    const worker = await Tesseract.createWorker('chi_sim+eng', 1, {
      logger: () => {}
    });
    tesseractWorker = worker;
    return 'tesseract';
  })();
  return tesseractInitPromise;
}

/* 统一初始化：先 Paddle，失败则 Tesseract */
async function ensureOCRInit() {
  if (ocrEngine) return ocrEngine;
  try {
    ocrEngine = await initPaddle();
  } catch (e) {
    console.warn('Paddle.js OCR 不可用，切换到 Tesseract.js：', e.message);
    ocrEngine = await initTesseract();
  }
  return ocrEngine;
}

/* Paddle.js 结果转统一 word 格式 */
function paddleResultToWords(result) {
  const words = [];
  const texts = result.text || [];
  const points = result.points || [];
  for (let i = 0; i < texts.length; i++) {
    const text = (texts[i] || '').trim();
    if (!text) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const pt = points[i];
    if (pt && pt.length >= 8) {
      for (let k = 0; k < 4; k++) {
        x0 = Math.min(x0, pt[k*2]);
        y0 = Math.min(y0, pt[k*2+1]);
        x1 = Math.max(x1, pt[k*2]);
        y1 = Math.max(y1, pt[k*2+1]);
      }
    } else {
      x0 = 0; y0 = 0; x1 = 0; y1 = 0;
    }
    words.push({ text, bbox: { x0, y0, x1, y1 } });
  }
  return words;
}

/* Tesseract.js 结果转统一 word 格式 */
function tesseractResultToWords(result) {
  const words = [];
  const blocks = result.data.words || [];
  for (const w of blocks) {
    const text = (w.text || '').trim();
    if (!text) continue;
    const b = w.bbox || { x0:0, y0:0, x1:0, y1:0 };
    words.push({ text, bbox: { x0:b.x0, y0:b.y0, x1:b.x1, y1:b.y1 } });
  }
  return words;
}

/* 对单个 canvas 运行 OCR（根据当前引擎选择） */
async function ocrCanvas(canvas) {
  const dataUrl = canvas.toDataURL('image/png');
  if (ocrEngine === 'paddle') {
    const img = await loadImage(dataUrl);
    const result = await paddlejs.ocr.recognize(img);
    return paddleResultToWords(result);
  } else if (ocrEngine === 'tesseract') {
    const result = await tesseractWorker.recognize(dataUrl);
    return tesseractResultToWords(result);
  }
  throw new Error('OCR 引擎未初始化');
}

/* 检测表格的垂直网格线（深色像素占比高的列） */
function detectVerticalLines(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const colCounts = new Array(w).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      if (gray < 128) colCounts[x]++;
    }
  }
  const threshold = h * 0.3;
  const lines = [];
  for (let x = 0; x < w; x++) {
    if (colCounts[x] > threshold) {
      if (lines.length === 0 || x - lines[lines.length-1] > 3) {
        lines.push(x);
      } else {
        lines[lines.length-1] = x; // extend
      }
    }
  }
  return lines;
}

/* 检测表格的水平网格线 */
function detectHorizontalLines(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const rowCounts = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      if (gray < 128) rowCounts[y]++;
    }
  }
  const threshold = w * 0.3;
  const lines = [];
  for (let y = 0; y < h; y++) {
    if (rowCounts[y] > threshold) {
      if (lines.length === 0 || y - lines[lines.length-1] > 3) {
        lines.push(y);
      } else {
        lines[lines.length-1] = y;
      }
    }
  }
  return lines;
}

/* 从 canvas 中裁剪指定区域 */
function cropCanvas(canvas, x, y, w, h) {
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

/* 加载图片 */
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

/* ===== 主识别流程：按列分割 + 分别 OCR =====
 * 思路：检测表格网格线 → 按列(星期)裁剪 → 每列单独 OCR →
 * 列内按行(节次)解析，避免文本检测器跨列合并。
 */
$('#btnRecognize').addEventListener('click', async () => {
  if (!selectedImage) return;
  $('#ocrProgress').style.display = 'block';
  $('#ocrResult').style.display = 'none';
  const progressFill = $('#progressFill');
  const progressText = $('#progressText');

  try {
    progressText.textContent = '加载 OCR 模型...';
    progressFill.style.width = '15%';
    await ensureOCRInit();

    progressText.textContent = '预处理图片...';
    progressFill.style.width = '30%';
    const processed = await preprocessImage(selectedImage);
    const img = await loadImage(processed);

    // 绘制到 canvas 供网格检测
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);

    progressText.textContent = '检测表格结构...';
    progressFill.style.width = '45%';
    const vLines = detectVerticalLines(canvas);
    const hLines = detectHorizontalLines(canvas);

    // 计算列边界（垂直线之间的区域）
    // 第一条垂直线通常是表格左边界，最后一条是右边界
    const colBounds = [];
    if (vLines.length >= 2) {
      for (let i = 0; i < vLines.length - 1; i++) {
        colBounds.push({ left: vLines[i], right: vLines[i+1] });
      }
    }

    // 计算行边界（水平线之间的区域）
    const rowBounds = [];
    if (hLines.length >= 2) {
      for (let i = 0; i < hLines.length - 1; i++) {
        rowBounds.push({ top: hLines[i], bottom: hLines[i+1] });
      }
    }

    const courses = [];
    if (colBounds.length >= 2 && rowBounds.length >= 2) {
      // 网格检测成功：按列裁剪后拼接（列间插白条），单次 OCR
      progressText.textContent = '识别课程中...';
      progressFill.style.width = '60%';

      const startCol = 0;
      const startRow = 1;
      const dayMap = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7,'天':7 };
      const GAP = 100;

      // 裁剪每列（含表头），记录位置
      const colCanvases = [];
      for (let c = startCol; c < colBounds.length; c++) {
        const col = colBounds[c];
        const colW = col.right - col.left;
        if (colW < 15) continue;
        const colTop = rowBounds[0].top;
        const colBottom = rowBounds[rowBounds.length-1].bottom;
        const colCanvas = cropCanvas(canvas, col.left, colTop, colW, colBottom - colTop);
        colCanvases.push({ canvas: colCanvas, colIndex: c });
      }

      // 垂直堆叠所有列，列间插入白条（防止 OCR 跨列合并）
      const totalW = Math.max(...colCanvases.map(cc => cc.canvas.width));
      const totalH = colCanvases.reduce((s, cc) => s + cc.canvas.height + GAP, 0) - GAP;
      const combined = document.createElement('canvas');
      combined.width = totalW; combined.height = totalH;
      const cctx = combined.getContext('2d');
      cctx.fillStyle = '#ffffff';
      cctx.fillRect(0, 0, totalW, totalH);
      let offsetY = 0;
      const colYMap = [];
      for (const cc of colCanvases) {
        cctx.drawImage(cc.canvas, 0, offsetY);
        colYMap.push({
          colIndex: cc.colIndex,
          startY: offsetY,
          endY: offsetY + cc.canvas.height
        });
        offsetY += cc.canvas.height + GAP;
      }

      // 单次 OCR
      const words = await ocrCanvas(combined);
      const headerH = rowBounds[0].bottom - rowBounds[0].top;

      // 合并被拆分的表头词（如 "周" + "四" -> "周四"），Tesseract 常拆分
      // 也处理"周"被误识为"局"的情况
      const dayChars = '一二三四五六日天';
      const mergedWords = [];
      for (let i = 0; i < words.length; i++) {
        const cur = words[i];
        const next = words[i+1];
        const t1 = (cur.text||'').trim();
        if ((t1 === '周' || t1 === '局') && next) {
          const t2 = (next.text||'').trim();
          if (dayChars.includes(t2)) {
            mergedWords.push({
              text: '周' + t2,
              bbox: { x0: cur.bbox.x0, y0: Math.min(cur.bbox.y0, next.bbox.y0),
                      x1: next.bbox.x1, y1: Math.max(cur.bbox.y1, next.bbox.y1) }
            });
            i++;
            continue;
          }
        }
        mergedWords.push(cur);
      }

      // 检测节次列：该列含"X-Y节"/"节"/纯数字等节次特征
      let periodCol = -1;
      for (const cm of colYMap) {
        let score = 0;
        const colWords = [];
        for (const w of mergedWords) {
          const t = (w.text || '').trim();
          const cy = (w.bbox.y0 + w.bbox.y1) / 2;
          if (cy < cm.startY || cy >= cm.endY) continue;
          colWords.push(t);
          if (/[节时间第]/.test(t)) score += 3;
          if (/^\d{1,2}$/.test(t)) score += 2;
          if (/\d{1,2}\s*[-~～到至]\s*\d{1,2}/.test(t)) score += 4;
        }
        if (score >= 3) { periodCol = cm.colIndex; break; }
      }

      // 回退：若未检测到节次列，检查首列是否明显比其他列稀疏（节次列通常文字最少）
      if (periodCol < 0) {
        const colWordCounts = colYMap.map(cm => {
          let cnt = 0;
          for (const w of mergedWords) {
            const cy = (w.bbox.y0 + w.bbox.y1) / 2;
            if (cy >= cm.startY && cy < cm.endY) cnt++;
          }
          return { colIndex: cm.colIndex, count: cnt };
        });
        const avg = colWordCounts.reduce((s, c) => s + c.count, 0) / colWordCounts.length;
        // 首列词数 < 平均的一半 → 判定为节次列
        if (colWordCounts[0] && colWordCounts[0].count < avg * 0.5) {
          periodCol = colWordCounts[0].colIndex;
        }
      }

      // 基于节次列位置确定每列星期（节次列之后第一列为周一）
      const colDays = {};
      const baseDayCol = periodCol >= 0 ? periodCol + 1 : startCol;
      for (const cm of colYMap) {
        if (cm.colIndex >= baseDayCol) {
          colDays[cm.colIndex] = cm.colIndex - baseDayCol + 1;
        }
      }

      // 尝试用表头词"周X"校正（若检测到）。Tesseract 常将"周"误识为"局"，一并处理。
      const headerDays = {};
      for (const cm of colYMap) {
        for (const w of mergedWords) {
          const t = (w.text || '').trim();
          const cy = (w.bbox.y0 + w.bbox.y1) / 2;
          if (cy < cm.startY || cy > cm.startY + headerH) continue;
          const dm = t.match(/[周局]([一二三四五六日天])|星期([一二三四五六日天])/);
          if (dm) {
            const key = dm[1] || dm[2];
            headerDays[cm.colIndex] = dayMap[key];
            break;
          }
        }
      }
      // 若表头检测到的天数 >= 2，信任表头结果
      if (Object.keys(headerDays).length >= 2) {
        Object.assign(colDays, headerDays);
      }

      // 从节次列提取每行的节次范围（如 "1-2节" → {start:1, end:2}）
      const rowPeriodMap = {};
      for (const w of mergedWords) {
        const t = (w.text || '').trim();
        if (!t) continue;
        const cy = (w.bbox.y0 + w.bbox.y1) / 2;
        let colInfo = null;
        for (const cm of colYMap) {
          if (cy >= cm.startY && cy < cm.endY) { colInfo = cm; break; }
        }
        if (!colInfo || colInfo.colIndex !== periodCol) continue;
        const localY = cy - colInfo.startY;
        if (localY < headerH) continue;
        const origCy = localY + rowBounds[0].top;
        let rowIdx = -1;
        for (let r = startRow; r < rowBounds.length; r++) {
          if (origCy >= rowBounds[r].top && origCy < rowBounds[r].bottom) { rowIdx = r; break; }
        }
        if (rowIdx < 0) continue;
        const rm = t.match(/(\d{1,2})\s*[-~～到至]\s*(\d{1,2})/);
        if (rm) {
          rowPeriodMap[rowIdx] = { start: parseInt(rm[1]), end: parseInt(rm[2]) };
        } else {
          const sm = t.match(/^(\d{1,2})$/);
          if (sm && !rowPeriodMap[rowIdx]) {
            rowPeriodMap[rowIdx] = { start: parseInt(sm[1]), end: parseInt(sm[1]) };
          }
        }
      }

      // 若节次范围不完整，根据已知行推断每行节次（假设每行节数相同）
      const knownRows = Object.keys(rowPeriodMap).map(Number).sort((a,b)=>a-b);
      if (knownRows.length > 0) {
        const refRow = knownRows[0];
        const ref = rowPeriodMap[refRow];
        const span = ref.end - ref.start + 1;
        for (let r = startRow; r < rowBounds.length; r++) {
          if (!rowPeriodMap[r]) {
            const offset = r - refRow;
            rowPeriodMap[r] = {
              start: Math.max(1, ref.start + offset * span),
              end: ref.end + offset * span
            };
          }
        }
      } else {
        // 节次列无文字可识别：假设每行跨 2 节（课表最常见的排布）
        for (let r = startRow; r < rowBounds.length; r++) {
          const idx = r - startRow;
          rowPeriodMap[r] = { start: idx * 2 + 1, end: idx * 2 + 2 };
        }
      }

      // 按列和行分组
      const cellMap = {};
      for (const w of mergedWords) {
        const t = (w.text || '').trim();
        if (!t) continue;
        const cy = (w.bbox.y0 + w.bbox.y1) / 2;

        // 找到所属列
        let colInfo = null;
        for (const cm of colYMap) {
          if (cy >= cm.startY && cy < cm.endY) { colInfo = cm; break; }
        }
        if (!colInfo) continue;
        // 跳过节次列（不生成课程）
        if (periodCol >= 0 && colInfo.colIndex === periodCol) continue;

        // 跳过表头
        const localY = cy - colInfo.startY;
        if (localY < headerH) continue;

        const day = colDays[colInfo.colIndex] || (colInfo.colIndex - baseDayCol + 1);
        // 转换 y 到原始图片坐标
        const origCy = localY + rowBounds[0].top;
        let rowIdx = -1;
        for (let r = startRow; r < rowBounds.length; r++) {
          if (origCy >= rowBounds[r].top && origCy < rowBounds[r].bottom) { rowIdx = r; break; }
        }
        if (rowIdx < 0) {
          let minDist = Infinity;
          for (let r = startRow; r < rowBounds.length; r++) {
            const rc = (rowBounds[r].top + rowBounds[r].bottom) / 2;
            const d = Math.abs(origCy - rc);
            if (d < minDist) { minDist = d; rowIdx = r; }
          }
        }
        if (rowIdx < 0) continue;

        const key = `${day}-${rowIdx}`;
        if (!cellMap[key]) cellMap[key] = { day, row: rowIdx, words: [] };
        cellMap[key].words.push(w);
      }

      // 解析每个单元格
      for (const key in cellMap) {
        const cell = cellMap[key];
        const cws = cell.words.sort((a,b) => a.bbox.x0 - b.bbox.x0);
        let text = cws.map(w => (w.text||'').trim()).join('').replace(/\s+/g, '');
        if (text.length < 2) continue;

        // 优先从节次列获取节次范围，其次从单元格文本中匹配
        let startP = cell.row, endP = cell.row;
        if (rowPeriodMap[cell.row]) {
          startP = rowPeriodMap[cell.row].start;
          endP = rowPeriodMap[cell.row].end;
        }
        const rangeMatch = text.match(/(\d{1,2})\s*[-~～到至]\s*(\d{1,2})\s*节?/);
        if (rangeMatch) {
          startP = parseInt(rangeMatch[1]);
          endP = parseInt(rangeMatch[2]);
        }

        const room = extractRoom(text);
        let name = text.replace(/[（(][^）)]*[）)]/g, '');
        if (room) name = name.replace(room, '');
        name = name.replace(/\d{1,2}\s*[-~～到至]\s*\d{1,2}\s*节?|第?\s*\d{1,2}\s*节/g, '');
        name = name.replace(/[,，。.\s|｜\-]+$/g, '').trim();

        if (!name || name.length < 2) continue;
        if (startP < 1) startP = 1;
        if (startP > STATE.periods.length) startP = STATE.periods.length;
        if (endP < startP) endP = startP;
        if (endP > STATE.periods.length) endP = STATE.periods.length;

        courses.push({
          id: uid(), name, room, teacher: '',
          day: cell.day, start: startP, end: endP,
          weeks: '1-16',
          color: COLORS[courses.length % COLORS.length]
        });
      }
    }

    // 如果网格检测失败或结果为空，回退到全图 OCR + 空间解析
    if (courses.length === 0) {
      progressText.textContent = '识别文字中...';
      progressFill.style.width = '60%';
      const fullWords = await ocrCanvas(canvas);
      progressText.textContent = '智能解析课程...';
      progressFill.style.width = '90%';
      const parsed = parseBySpatialGrid(fullWords);
      if (parsed && parsed.length > 0) {
        courses.push(...parsed);
      } else {
        const fullText = fullWords.map(w => w.text).join('\n');
        const textParsed = parseOCRText(fullText);
        courses.push(...textParsed);
      }
    }

    progressText.textContent = '解析完成';
    progressFill.style.width = '100%';

    // 去重
    const seen = new Set(), unique = [];
    for (const c of courses) {
      const k = `${c.name}-${c.day}-${c.start}`;
      if (!seen.has(k)) { seen.add(k); unique.push(c); }
    }

    STATE.recognizedCourses = unique;
    renderOCRResult();
    $('#ocrProgress').style.display = 'none';

    if (STATE.recognizedCourses.length === 0) {
      showToast('未识别到课程，请手动添加或使用更清晰的截图', 3000);
    }
  } catch(e) {
    console.error(e);
    $('#ocrProgress').style.display = 'none';
    showToast('识别失败：' + e.message, 3000);
  }
});

/* ===== 解析策略 1：空间网格解析（基于 OCR 词级 bbox 坐标）=====
 * 思路：识别表头"周X"确定列(星期)边界，识别节次词确定行(节次)边界，
 * 再将内容词按 x/y 中心坐标归入对应单元格，合并同单元格文本为一门课。
 */
function parseBySpatialGrid(words) {
  if (!words || words.length < 5) return null;

  const dayMap = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7,'天':7 };
  const dayChars = '一二三四五六日天';

  // 过滤空词，按 y 再 x 排序
  let valid = words.filter(w => (w.text||'').trim());

  // 1. 合并被拆分的表头词（如 "周" + "四" -> "周四"）
  const merged = [];
  for (let i = 0; i < valid.length; i++) {
    const cur = valid[i];
    const next = valid[i+1];
    const t1 = (cur.text||'').trim();
    if (t1 === '周' && next) {
      const t2 = (next.text||'').trim();
      if (dayChars.includes(t2) && Math.abs(cur.bbox.y0 - next.bbox.y0) < 30 && (next.bbox.x0 - cur.bbox.x1) < 60) {
        merged.push({
          text: '周' + t2,
          bbox: { x0: cur.bbox.x0, y0: Math.min(cur.bbox.y0, next.bbox.y0),
                  x1: next.bbox.x1, y1: Math.max(cur.bbox.y1, next.bbox.y1) },
          confidence: cur.confidence
        });
        i++; // 跳过下一个
        continue;
      }
    }
    merged.push(cur);
  }

  // 2. 分离表头词与内容词
  const headerWords = [];
  const contentWords = [];
  for (const w of merged) {
    const t = (w.text || '').trim();
    const dm = t.match(/周([一二三四五六日天])|星期([一二三四五六日天])/);
    if (dm) {
      const key = dm[1] || dm[2];
      headerWords.push({ ...w, day: dayMap[key] });
    } else {
      contentWords.push(w);
    }
  }
  if (headerWords.length < 2) return null;

  // 3. 按表头 x 坐标确定列分界
  headerWords.sort((a,b) => a.bbox.x0 - b.bbox.x0);
  // 去重同一天（取 x 最小的）
  const uniqueHeaders = [];
  const seenDays = new Set();
  for (const h of headerWords) {
    if (!seenDays.has(h.day)) { seenDays.add(h.day); uniqueHeaders.push(h); }
  }
  const colBounds = [];
  for (let i = 0; i < uniqueHeaders.length; i++) {
    const cx = (uniqueHeaders[i].bbox.x0 + uniqueHeaders[i].bbox.x1) / 2;
    const left = i === 0 ? 0 : ((uniqueHeaders[i-1].bbox.x0+uniqueHeaders[i-1].bbox.x1)/2 + cx) / 2;
    const right = i === uniqueHeaders.length-1 ? Infinity : (cx + (uniqueHeaders[i+1].bbox.x0+uniqueHeaders[i+1].bbox.x1)/2) / 2;
    colBounds.push({ day: uniqueHeaders[i].day, left, right });
  }

  // 4. 行检测：优先节次词，否则按 y 聚类
  const periodWords = [];
  const otherWords = [];
  for (const w of contentWords) {
    const t = (w.text || '').trim();
    const pm = t.match(/第?\s*(\d{1,2})\s*节/);
    if (pm) {
      periodWords.push({ ...w, period: parseInt(pm[1]) });
    } else {
      otherWords.push(w);
    }
  }

  let rowBounds = [];
  if (periodWords.length >= 2) {
    periodWords.sort((a,b) => a.bbox.y0 - b.bbox.y0);
    const rowCenters = periodWords.map(p => ({
      period: p.period,
      cy: (p.bbox.y0 + p.bbox.y1) / 2
    }));
    for (let i = 0; i < rowCenters.length; i++) {
      const top = i === 0 ? -Infinity : (rowCenters[i-1].cy + rowCenters[i].cy) / 2;
      const bot = i === rowCenters.length-1 ? Infinity : (rowCenters[i].cy + rowCenters[i+1].cy) / 2;
      rowBounds.push({ period: rowCenters[i].period, top, bot });
    }
  } else {
    // 按 y 中心聚类，用更合理的阈值（基于图片高度）
    const allY = contentWords.map(w => (w.bbox.y0 + w.bbox.y1) / 2);
    const imgH = Math.max(...contentWords.map(w => w.bbox.y1)) - Math.min(...contentWords.map(w => w.bbox.y0));
    const threshold = Math.max(20, imgH * 0.08);
    const clusters = cluster1D(allY.sort((a,b)=>a-b), threshold);
    rowBounds = clusters.map((cy, i) => {
      const top = i === 0 ? -Infinity : (clusters[i-1] + cy) / 2;
      const bot = i === clusters.length-1 ? Infinity : (cy + clusters[i+1]) / 2;
      return { period: i+1, top, bot };
    });
  }
  if (rowBounds.length < 1) return null;

  // 5. 将内容词分配到单元格（过滤异常宽词）
  const cells = {};
  const avgWordW = contentWords.reduce((s,w) => s + (w.bbox.x1 - w.bbox.x0), 0) / contentWords.length;
  for (const w of otherWords) {
    const t = (w.text || '').trim();
    if (!t) continue;
    const ww = w.bbox.x1 - w.bbox.x0;
    // 跳过宽度异常大的词（可能是 OCR 合并错误），改为用其中心点归属
    const cx = (w.bbox.x0 + w.bbox.x1) / 2;
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;

    const col = colBounds.find(c => cx >= c.left && cx < c.right);
    if (!col) continue;
    const row = rowBounds.find(r => cy >= r.top && cy < r.bot);
    if (!row) continue;

    // 跳过纯符号/单字符无意义词
    if (t.length === 1 && /[|｜\-\-~～]/.test(t)) continue;

    const key = `${col.day}-${row.period}`;
    if (!cells[key]) cells[key] = [];
    cells[key].push(w);
  }

  // 6. 合并单元格内词为课程
  const courses = [];
  for (const key in cells) {
    const [day, period] = key.split('-').map(Number);
    const cws = cells[key].sort((a,b) => a.bbox.x0 - b.bbox.x0);
    let text = cws.map(w => (w.text||'').trim()).join('').replace(/\s+/g, '');
    if (text.length < 2) continue;

    const rangeMatch = text.match(/(\d{1,2})\s*[-~～到至]\s*(\d{1,2})\s*节?/);
    let startP = period, endP = period;
    if (rangeMatch) {
      startP = parseInt(rangeMatch[1]);
      endP = parseInt(rangeMatch[2]);
      text = text.replace(rangeMatch[0], '');
    }

    const room = extractRoom(text);
    if (room) text = text.replace(room, '');

    let name = text.replace(/[（(][^）)]*[）)]/g, '').replace(/[,，。.\s|｜\-]+$/g, '').trim();
    if (!name || name.length < 2) continue;

    if (startP < 1) startP = 1;
    if (startP > STATE.periods.length) startP = STATE.periods.length;
    if (endP < startP) endP = startP;
    if (endP > STATE.periods.length) endP = STATE.periods.length;

    courses.push({
      id: uid(), name, room, teacher: '',
      day, start: startP, end: endP,
      weeks: '1-16',
      color: COLORS[courses.length % COLORS.length]
    });
  }

  const seen = new Set(), unique = [];
  for (const c of courses) {
    const k = `${c.name}-${c.day}-${c.start}`;
    if (!seen.has(k)) { seen.add(k); unique.push(c); }
  }
  return unique.length > 0 ? unique : null;
}

/* 一维聚类 */
function cluster1D(values, threshold) {
  if (values.length === 0) return [];
  const clusters = [[values[0]]];
  for (let i = 1; i < values.length; i++) {
    const last = clusters[clusters.length-1];
    const avg = last.reduce((a,b)=>a+b,0) / last.length;
    if (Math.abs(values[i] - avg) < threshold) last.push(values[i]);
    else clusters.push([values[i]]);
  }
  return clusters.map(c => c.reduce((a,b)=>a+b,0) / c.length);
}

/* 提取教室信息 */
function extractRoom(text) {
  const m = text.match(/(教[一二三四五六七八九十\d]+[-－]?\d*[A-Za-z]?\d*|[A-Za-z]?\d{1,3}号楼?[-－]?\d*|[\u4e00-\u9fa5]*\d{2,4}\s*室|实验楼[A-Za-z]?\d*|外语楼\d*|操场|体育馆)/);
  return m ? m[0] : '';
}

/* ===== 解析策略 2：文本解析（fallback，处理非表格的清单式截图）===== */
function parseOCRText(text) {
  const courses = [];
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const dayMap = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7,'天':7,
                   '1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7 };

  for (const line of lines) {
    if (line.length < 2) continue;
    const periodMatch = line.match(/(\d{1,2})\s*[-~～到至]\s*(\d{1,2})\s*节?|第?\s*(\d{1,2})\s*节/);
    let dayNum = null;
    const dm = line.match(/周([一二三四五六日天1-7])|星期([一二三四五六日天1-7])/);
    if (dm) {
      const key = dm[1] || dm[2];
      dayNum = dayMap[key];
    }
    if (!dayNum || !periodMatch) continue;

    let startP, endP;
    if (periodMatch[1] && periodMatch[2]) {
      startP = parseInt(periodMatch[1]); endP = parseInt(periodMatch[2]);
    } else {
      startP = endP = parseInt(periodMatch[3]);
    }
    if (startP < 1 || startP > STATE.periods.length) continue;
    if (endP < startP || endP > STATE.periods.length) continue;

    let name = line
      .replace(/周[一二三四五六日天1-7]|星期[一二三四五六日天1-7]/g, '')
      .replace(/\d{1,2}\s*[-~～到至]\s*\d{1,2}\s*节?|第?\s*\d{1,2}\s*节/g, '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .trim();
    const room = extractRoom(line);
    name = name.replace(room, '').replace(/[,，。.\s]+$/g, '').trim();
    if (!name) name = '未命名课程';

    courses.push({
      id: uid(), name, room, teacher: '',
      day: dayNum, start: startP, end: endP,
      weeks: '1-16',
      color: COLORS[courses.length % COLORS.length]
    });
  }
  return courses;
}

function renderOCRResult() {
  const list = $('#resultList');
  if (STATE.recognizedCourses.length === 0) {
    $('#ocrResult').style.display = 'none';
    return;
  }
  $('#ocrResult').style.display = 'block';
  list.innerHTML = STATE.recognizedCourses.map((c, idx) => `
    <div class="result-item" data-idx="${idx}">
      <div class="ri-main">
        <input value="${escapeHTML(c.name)}" data-field="name">
        <input value="${escapeHTML(c.room)}" placeholder="地点" data-field="room" style="max-width:90px">
      </div>
      <div class="ri-sub">
        <select data-field="day">
          ${DAY_NAMES.map((d,i)=>`<option value="${i+1}" ${c.day===i+1?'selected':''}>${d}</option>`).join('')}
        </select>
        <select data-field="start">
          ${STATE.periods.map((_,i)=>`<option value="${i+1}" ${c.start===i+1?'selected':''}>第${i+1}节起</option>`).join('')}
        </select>
        <select data-field="end">
          ${STATE.periods.map((_,i)=>`<option value="${i+1}" ${c.end===i+1?'selected':''}>第${i+1}节止</option>`).join('')}
        </select>
        <button class="ri-remove" data-idx="${idx}">删除</button>
      </div>
    </div>
  `).join('');

  // 绑定编辑与删除
  list.querySelectorAll('.result-item').forEach(item => {
    const idx = parseInt(item.dataset.idx);
    item.querySelectorAll('input,select').forEach(el => {
      el.addEventListener('change', () => {
        const field = el.dataset.field;
        let v = el.value;
        if (field==='day'||field==='start'||field==='end') v = parseInt(v);
        STATE.recognizedCourses[idx][field] = v;
      });
    });
  });
  list.querySelectorAll('.ri-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      STATE.recognizedCourses.splice(idx,1);
      renderOCRResult();
    });
  });
}

$('#btnImportAll').addEventListener('click', () => {
  if (!STATE.recognizedCourses.length) return;
  STATE.recognizedCourses.forEach(c => STATE.courses.push({...c}));
  saveData();
  renderSchedule();
  updateMeStat();
  showToast(`已导入 ${STATE.recognizedCourses.length} 门课程`);
  STATE.recognizedCourses = [];
  $('#ocrResult').style.display = 'none';
  $('#previewArea').innerHTML = '<div class="preview-placeholder">尚未选择图片</div>';
  $('#btnRecognize').disabled = true;
  $('#fileInput').value = '';
});

/* ---------- 课程增删改查 ---------- */
function openCourseModal(id=null) {
  STATE.editingId = id;
  const modal = $('#courseModal');
  const c = id ? STATE.courses.find(x=>x.id===id) : null;
  $('#modalTitle').textContent = c ? '编辑课程' : '添加课程';
  $('#courseName').value = c?.name || '';
  $('#courseRoom').value = c?.room || '';
  $('#courseTeacher').value = c?.teacher || '';
  $('#courseDay').value = c?.day || 1;
  $('#courseWeeks').value = c?.weeks || '1-16';
  // 填充节次下拉
  const startSel = $('#courseStart'); const endSel = $('#courseEnd');
  startSel.innerHTML = STATE.periods.map((_,i)=>`<option value="${i+1}">第${i+1}节</option>`).join('');
  endSel.innerHTML = STATE.periods.map((_,i)=>`<option value="${i+1}">第${i+1}节</option>`).join('');
  startSel.value = c?.start || 1;
  endSel.value = c?.end || 1;
  // 颜色选择器
  const cp = $('#colorPicker');
  const curColor = c?.color || COLORS[STATE.courses.length % COLORS.length];
  cp.innerHTML = COLORS.map(col=>`<div class="color-dot${col===curColor?' selected':''}" style="background:${col}" data-color="${col}"></div>`).join('');
  cp.querySelectorAll('.color-dot').forEach(dot=>{
    dot.addEventListener('click', ()=>{
      cp.querySelectorAll('.color-dot').forEach(d=>d.classList.remove('selected'));
      dot.classList.add('selected');
    });
  });
  $('#btnDeleteCourse').style.display = c ? 'block' : 'none';
  modal.classList.add('show');
}

function closeCourseModal() { $('#courseModal').classList.remove('show'); STATE.editingId = null; }

$('#btnAddCourse').addEventListener('click', ()=>openCourseModal());
$('#modalClose').addEventListener('click', closeCourseModal);
$('#courseModal .modal-mask').addEventListener('click', closeCourseModal);

$('#btnSaveCourse').addEventListener('click', () => {
  const name = $('#courseName').value.trim();
  if (!name) { showToast('请输入课程名称'); return; }
  const start = parseInt($('#courseStart').value);
  const end = parseInt($('#courseEnd').value);
  if (end < start) { showToast('结束节次不能早于开始节次'); return; }
  const color = $('#colorPicker .color-dot.selected')?.dataset.color || COLORS[0];
  const data = {
    name,
    room: $('#courseRoom').value.trim(),
    teacher: $('#courseTeacher').value.trim(),
    day: parseInt($('#courseDay').value),
    start, end,
    weeks: $('#courseWeeks').value.trim() || '1-16',
    color
  };
  if (STATE.editingId) {
    Object.assign(STATE.courses.find(x=>x.id===STATE.editingId), data);
    showToast('已更新课程');
  } else {
    STATE.courses.push({ id: uid(), ...data });
    showToast('已添加课程');
  }
  saveData();
  renderSchedule();
  updateMeStat();
  closeCourseModal();
});

$('#btnDeleteCourse').addEventListener('click', () => {
  if (!STATE.editingId) return;
  if (!confirm('确定删除该课程吗？')) return;
  STATE.courses = STATE.courses.filter(x=>x.id!==STATE.editingId);
  saveData();
  renderSchedule();
  updateMeStat();
  closeCourseModal();
  showToast('已删除');
});

/* ---------- 时间表设置 ---------- */
function openTimeModal() {
  const table = $('#timeTable');
  table.innerHTML = STATE.periods.map((p,i)=>`
    <div class="time-row">
      <div class="idx">${i+1}</div>
      <input type="time" value="${p.s}" data-idx="${i}" data-field="s">
      <input type="time" value="${p.e}" data-idx="${i}" data-field="e">
    </div>
  `).join('');
  $('#timeModal').classList.add('show');
}
function closeTimeModal() { $('#timeModal').classList.remove('show'); }
$('#timeClose').addEventListener('click', closeTimeModal);
$('#timeModal .modal-mask').addEventListener('click', closeTimeModal);

$('#btnSaveTime').addEventListener('click', () => {
  const inputs = $('#timeTable').querySelectorAll('input');
  inputs.forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    STATE.periods[idx][inp.dataset.field] = inp.value;
  });
  saveData();
  renderSchedule();
  closeTimeModal();
  showToast('时间表已保存');
});
$('#btnResetTime').addEventListener('click', () => {
  if (confirm('恢复默认时间表？')) {
    STATE.periods = defaultPeriods();
    openTimeModal();
  }
});

/* ---------- 我的页 ---------- */
function updateMeStat() {
  $('#meStat').textContent = `共 ${STATE.courses.length} 门课程`;
}
$('#menuTimeTable').addEventListener('click', openTimeModal);
$('#menuClearData').addEventListener('click', () => {
  if (confirm('确定清空所有课程数据吗？此操作不可恢复。')) {
    STATE.courses = [];
    saveData();
    renderSchedule();
    updateMeStat();
    showToast('已清空数据');
  }
});
$('#menuAbout').addEventListener('click', () => {
  showToast('我的课表 v1.0 · PWA 应用', 3000);
});

/* PWA 安装提示 */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});
$('#menuInstall').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  } else {
    showToast('请在浏览器菜单中选择「添加到主屏幕」', 3000);
  }
});

/* ---------- 导航切换 ---------- */
$$('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    $$('.nav-item').forEach(i=>i.classList.remove('active'));
    item.classList.add('active');
    const page = item.dataset.page;
    $$('.page').forEach(p=>p.classList.remove('active'));
    $('#'+page).classList.add('active');
    if (page === 'pageSchedule') renderSchedule();
    if (page === 'pageReminder') renderUpcoming();
  });
});

/* 周切换 */
$('#btnPrevWeek').addEventListener('click', () => {
  if (STATE.currentWeek > 1) { STATE.currentWeek--; renderSchedule(); }
});
$('#btnNextWeek').addEventListener('click', () => {
  if (STATE.currentWeek < 25) { STATE.currentWeek++; renderSchedule(); }
});

/* 提醒设置 */
$('#reminderToggle').addEventListener('change', (e) => {
  STATE.settings.reminderEnabled = e.target.checked;
  saveData();
  if (e.target.checked) { requestNotificationPermission(); startReminderLoop(); }
  showToast(e.target.checked?'提醒已开启':'提醒已关闭');
});
$('#reminderAdvance').addEventListener('change', (e) => {
  STATE.settings.advanceMinutes = parseInt(e.target.value); saveData();
});
$('#reminderSound').addEventListener('change', (e) => {
  STATE.settings.sound = e.target.value; saveData();
});
$('#btnNotifyPermit').addEventListener('click', requestNotificationPermission);

/* ---------- 初始化 ---------- */
function init() {
  loadData();
  STATE.currentWeek = getCurrentWeekNumber();
  // 同步设置到UI
  $('#reminderToggle').checked = STATE.settings.reminderEnabled;
  $('#reminderAdvance').value = STATE.settings.advanceMinutes;
  $('#reminderSound').value = STATE.settings.sound;

  renderSchedule();
  updateClock();
  setInterval(updateClock, 1000);
  // 每分钟刷新课表（更新当前节次高亮）
  setInterval(()=>{ renderSchedule(); }, 60000);
  startReminderLoop();
  updateMeStat();

  // 请求通知权限（用户首次交互后）
  document.addEventListener('click', function once() {
    if (STATE.settings.reminderEnabled && 'Notification' in window && Notification.permission === 'default') {
      requestNotificationPermission();
    }
    document.removeEventListener('click', once);
  }, { once: true });

  // 注册 Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
}

init();
