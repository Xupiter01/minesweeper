// Difficulty presets (ponytail: hardcoded config, no separate file needed)
const DIFFICULTY = {
  easy:   { rows: 6,  cols: 6,  mines: 5  },
  medium: { rows: 9,  cols: 9,  mines: 10 },
  hard:   { rows: 14, cols: 14, mines: 30 }
};
let difficulty = 'medium';
let ROWS = DIFFICULTY[difficulty].rows;
let COLS = DIFFICULTY[difficulty].cols;
let MINES = DIFFICULTY[difficulty].mines;
const colors = ['', '#4ecca3', '#3b82f6', '#e94560', '#9b59b6', '#1abc9c', '#f39c12', '#e74c3c', '#95a5a6'];
let board, revealed, flags, minePos;
let gameOver = false, firstClick = true, timer = 0, timerInterval;
let score = [0, 0];
let mySeat = null;
let isHost = false;
let isSolo = false;
let peer = null;
let conn = null;
let roomCode = null;
let oppName = 'ฝั่งตรงข้าม';
let myName = '';
let musicEnabled = true;
// Power-ups state (ponytail: simple object, per-player count)
let powerups = { scan: 1, shield: 1, paper: 1 };
let shieldActive = false;
const $ = id => document.getElementById(id);
const boardEl = $('board');
const mineCountEl = $('mineCount');
const timerEl = $('timer');
const gameEl = $('gameEl');
const bgmAudio = $('bgmAudio');
const musicToggle = $('musicToggle');
function setDifficulty(level) {
  if (!DIFFICULTY[level]) return;
  difficulty = level;
  ROWS = DIFFICULTY[level].rows;
  COLS = DIFFICULTY[level].cols;
  MINES = DIFFICULTY[level].mines;
  // Sync board size to CSS (ponytail: only if hard mode to avoid breaking default)
  document.documentElement.style.setProperty('--cell-size', level === 'hard' ? '30px' : '38px');
  // Update UI active state
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('active', b.dataset.diff === level));
}

function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(id).classList.add('active'); }

// Power-ups: scan=random safe cell, shield=block 1 mine hit, paper=reveal 3x3
function usePowerup(type) {
  if (gameOver || powerups[type] <= 0) return;
  if (type === 'scan') powerupScan();
  else if (type === 'shield') powerupShield();
  else if (type === 'paper') { showToast('🔍 เลือกช่องที่จะใช้เปเปอร์ (เปิด 3×3)', 'info'); pendingPaper = true; return; }
  powerups[type]--;
  updatePowerupUI(type);
  // Animate
  const btn = document.getElementById('pu-' + type);
  if (btn) { btn.classList.add('used'); setTimeout(() => btn.classList.remove('used'), 600); }
  // Sync to opponent in 2P mode
  if (!isSolo && conn) conn.send({ type: 'powerup_used', pu: type });
}

let pendingPaper = false;
function powerupScan() {
  // Find random unrevealed cell that is not a mine
  const candidates = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!revealed[r][c] && !flags[r][c] && !minePos.has(r+','+c)) candidates.push([r,c]);
  }
  if (candidates.length === 0) { showToast('ไม่มีช่องปลอดภัยให้สแกน', 'error'); return; }
  const [r, c] = candidates[Math.floor(Math.random() * candidates.length)];
  // First click handling: ensure mines placed
  if (firstClick) { firstClick = false; placeMines(r, c); startTimer(); }
  const playerIdx = isSolo ? 0 : (mySeat === 'left' ? 0 : 1);
  processClick(r, c, playerIdx);
  if (isHost || isSolo) renderBoard();
  showToast('🎯 สแกนเจอช่องปลอดภัย!', 'info');
}

function powerupShield() {
  shieldActive = true;
  showToast('🛡️ โล่พร้อม! เหยียบระเบิดครั้งต่อไปจะไม่แพ้', 'info');
  // Visual indicator
  document.body.classList.add('shield-ready');
}

function applyPowerupPaper(r, c) {
  if (!pendingPaper) return false;
  pendingPaper = false;
  const playerIdx = isSolo ? 0 : (mySeat === 'left' ? 0 : 1);
  for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
    const nr=r+dr, nc=c+dc;
    if (nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
    if (board[nr][nc] !== -1 && !revealed[nr][nc]) {
      const seen = new Set();
      floodFill(nr, nc, seen);
    }
  }
  checkWin(playerIdx);
  renderBoard();
  // Decrement paper (ponytail: inline)
  powerups.paper--;
  updatePowerupUI('paper');
  const btn = document.getElementById('pu-paper');
  if (btn) { btn.classList.add('used'); setTimeout(() => btn.classList.remove('used'), 600); }
  showToast('🔍 เปเปอร์เปิด 3×3 แล้ว!', 'info');
  return true;
}

function updatePowerupUI(type) {
  const btn = document.getElementById('pu-' + type);
  if (!btn) return;
  const count = powerups[type];
  btn.querySelector('.pu-count').textContent = '×' + count;
  btn.disabled = count <= 0;
}

// Helper: get current player (for 2P turn tracking — ponytail: simple heuristic)
function getCurrentPlayerSeat() {
  // Alternates per click; first player starts
  return totalClicks % 2 === 0 ? 'left' : 'right';
}
let totalClicks = 0;
(function(){ const c = $('bgParticles'); for(let i=0;i<40;i++){ const p=document.createElement('div');p.className='bg-particle';p.style.left=Math.random()*100+'%';p.style.width=p.style.height=(1+Math.random()*3)+'px';p.style.animationDuration=(10+Math.random()*20)+'s';p.style.animationDelay=(Math.random()*15)+'s';c.appendChild(p); } })();
function updateMusicToggle() { musicToggle.textContent = musicEnabled ? '🎵 เพลง: เปิด' : '🔇 เพลง: ปิด'; }
function tryStartMusic() {
  if (!musicEnabled || !bgmAudio) return;
  bgmAudio.volume = 0.18;
  bgmAudio.play().catch(() => {});
}
function restartMusic() {
  if (!musicEnabled || !bgmAudio) return;
  bgmAudio.currentTime = 0;
  tryStartMusic();
}
function toggleMusic() {
  musicEnabled = !musicEnabled;
  if (!musicEnabled) bgmAudio.pause();
  else tryStartMusic();
  updateMusicToggle();
}
musicToggle.addEventListener('click', toggleMusic);
window.addEventListener('pointerdown', tryStartMusic, { once: true });
window.addEventListener('keydown', tryStartMusic, { once: true });
bgmAudio.addEventListener('error', () => {
  musicEnabled = false;
  updateMusicToggle();
});
updateMusicToggle();
function startSolo() {
  tryStartMusic();
  cleanupNetwork();
  isSolo = true; isHost = false; mySeat = null;
  $('resetBtn').textContent = '🙂';
  $('backBtn').style.display = 'inline-block';
  document.getElementById('gameEl').classList.add('solo-mode');
  initLocal(null, null, [0,0], 0, true);
  renderBoard();
  updateScoresUI();
  showScreen('gameScreen');
}
function backToLobby() {
  clearInterval(timerInterval); gameOver = true;
  cleanupNetwork();
  isSolo = false; isHost = false; mySeat = null; peer = null; conn = null;
  $('backBtn').style.display = 'none';
  document.getElementById('gameEl').classList.remove('solo-mode');
  if (peer) { try { peer.destroy(); } catch(e) {} peer = null; }
  showScreen('lobbyScreen');
}
function cleanupNetwork() {
  if (conn) { try { conn.close(); } catch(e) {} conn = null; }
  if (peer) { try { peer.destroy(); } catch(e) {} peer = null; }
}
function generateCode() { const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c=''; for(let i=0;i<4;i++) c+=chars[Math.floor(Math.random()*chars.length)]; return c; }
async function createRoom() {
  tryStartMusic();
  isSolo = false;
  document.getElementById('gameEl').classList.remove('solo-mode');
  $('backBtn').style.display = 'none';
  roomCode = generateCode();
  const peerId = 'ms2p-' + roomCode;
  isHost = true;
  showScreen('waitingScreen');
  $('roomCodeDisplay').textContent = roomCode;
  const url = window.location.origin + window.location.pathname + '?room=' + roomCode;
  $('shareUrl').textContent = url;
  $('waitStatus').textContent = 'กำลังรอผู้เล่นคนที่สอง...';
  try {
    peer = new Peer(peerId);
    await new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); setTimeout(() => rej('timeout'), 10000); });
    peer.on('connection', incoming => {
      conn = incoming;
      conn.on('open', () => {
        conn.on('data', handleData);
        showScreen('seatScreen');
      });
    });
  } catch (e) {
    showScreen('lobbyScreen');
    showToast('ไม่สามารถสร้างห้องได้ (peerId ซ้ำหรือ timeout)', 'error');
  }
}
async function joinRoom() {
  tryStartMusic();
  isSolo = false;
  document.getElementById('gameEl').classList.remove('solo-mode');
  $('backBtn').style.display = 'none';
  let code = $('roomCodeInput').value.trim().toUpperCase();
  if (code.length !== 4) { showToast('กรุณากรอกรหัส 4 ตัว', 'error'); return; }
  roomCode = code;
  isHost = false;
  showScreen('waitingScreen');
  $('roomCodeDisplay').textContent = code;
  $('waitStatus').textContent = 'กำลังเชื่อมต่อ...';
  $('shareLink').style.display = 'none';
  try {
    peer = new Peer();
    await new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); setTimeout(() => rej('timeout'), 10000); });
    const hostId = 'ms2p-' + code;
    conn = peer.connect(hostId, { reliable: true });
    await new Promise((res, rej) => { conn.on('open', res); conn.on('error', rej); setTimeout(() => rej('timeout'), 15000); });
    conn.on('data', handleData);
    conn.send({ type: 'join' });
  } catch (e) {
    showScreen('lobbyScreen');
    showToast('ไม่สามารถเชื่อมต่อห้องได้ (รหัสผิดหรือเจ้าห้องออก)', 'error');
  }
}
function handleData(data) {
  switch (data.type) {
    case 'join': if (isHost) showScreen('seatScreen'); break;
    case 'seat_confirm':
      if (!isHost) {
        mySeat = data.seat;
        oppName = data.oppName;
        if (data.difficulty) setDifficulty(data.difficulty);
        if (data.board) initBoardFrom(data.board, data.mines, data.scores, data.timer, data.firstClick);
        else initLocal(null, null, [0,0], 0, true);
        startGame();
        showScreen('gameScreen');
      }
      break;
    case 'click':
      if (isHost) {
        const _r = processClick(data.r, data.c, data.player);
        if (_r && !gameOver) conn.send({ type: 'state_sync', board: board.map(r=>[...r]), revealed: revealed.map(r=>[...r]), flags: flags.map(r=>[...r]), minePos: [...minePos], score, timer, firstClick, gameOver });
      }
      break;
    case 'flag':
      if (isHost) {
        processFlag(data.r, data.c);
        conn.send({ type: 'state_sync', board: board.map(r=>[...r]), revealed: revealed.map(r=>[...r]), flags: flags.map(r=>[...r]), minePos: [...minePos], score, timer, firstClick, gameOver });
      }
      break;
    case 'state_sync': applyState(data); break;
    case 'game_over':
      gameOver = true;
      clearInterval(timerInterval);
      if (data.board) {
        board = data.board;
        revealed = data.revealed;
        flags = data.flags;
        minePos = new Set(data.minePos || []);
        score = data.scores || data.score || score;
      }
      timer = data.timer != null ? data.timer : timer;
      timerEl.textContent = String(timer).padStart(3, '0');
      renderBoard();
      if (data.hitR !== undefined) animateMineExplosion(data.hitR, data.hitC);
      $('resetBtn').textContent = data.loser === mySeat ? '💀' : '😎';
      if (data.loser) {
        if (data.loser === mySeat) { showToast('💀 คุณเหยียบระเบิด!', 'error'); showPopup('💀 แพ้'); }
        else { showToast('🎉 คู่ต่อสู้เหยียบระเบิด! คุณชนะ!', 'info'); showPopup('🎉 ชนะ!'); createConfetti(); }
      } else {
        if (data.tie) { showToast('🤝 เสมอกัน!', 'info'); showPopup('🤝 เสมอ!'); }
        else if (data.winner === mySeat) { showToast('🎉 คุณชนะ!', 'info'); showPopup('🎉 ชนะ!'); createConfetti(); }
        else { showToast('😔 คุณแพ้!', 'error'); showPopup('😔 แพ้'); }
      }
      updateScoresUI();
      break;
    case 'reset_game':
      initLocal(data.board, data.mines, data.scores, data.timer, true);
      renderBoard();
      updateScoresUI();
      $('resetBtn').textContent = '🙂';
      gameOver = false;
      firstClick = false;
      restartMusic();
      break;
    case 'reset_request': if (isHost) resetGame(); break;
    case 'opponent_left':
      showToast('👋 คู่ต่อสู้ออกจากเกม', 'error');
      gameOver = true;
      clearInterval(timerInterval);
      break;
  }
}
let selectedSeat = null;
function selectSeat(seat) {
  selectedSeat = seat;
  document.querySelectorAll('.seat-btn').forEach(b => b.classList.remove('selected'));
  $(seat === 'left' ? 'seatLeft' : 'seatRight').classList.add('selected');
  $('seatConfirmBtn').disabled = false;
}
function confirmSeat() {
  if (!selectedSeat) return;
  mySeat = selectedSeat;
  myName = 'ฉัน';
  if (isHost) {
    const guestSeat = mySeat === 'left' ? 'right' : 'left';
    conn.send({ type: 'seat_confirm', seat: guestSeat, oppName: myName, board: null, mines: [], scores: [0, 0], timer: 0, firstClick: true, difficulty: difficulty });
    initLocal(null, null, [0,0], 0, true);
    startGame();
    showScreen('gameScreen');
  }
}
function initLocal(existingBoard, existingMines, scores, t, fc) {
  if (existingBoard) {
    board = existingBoard; revealed = []; flags = [];
    for (let r = 0; r < ROWS; r++) { revealed[r] = []; flags[r] = []; for (let c = 0; c < COLS; c++) { revealed[r][c] = false; flags[r][c] = false; } }
    minePos = new Set(existingMines);
  } else {
    board = []; revealed = []; flags = []; minePos = new Set();
    for (let r = 0; r < ROWS; r++) { board[r] = []; revealed[r] = []; flags[r] = []; for (let c = 0; c < COLS; c++) { board[r][c] = 0; revealed[r][c] = false; flags[r][c] = false; } }
  }
  score = scores || [0, 0];
  timer = t || 0;
  timerEl.textContent = String(timer).padStart(3, '0');
  firstClick = fc;
  gameOver = false;
  shieldActive = false;
  pendingPaper = false;
  totalClicks = 0;
  powerups = { scan: 1, shield: 1, paper: 1 };
  document.body.classList.remove('shield-ready');
  ['scan','shield','paper'].forEach(updatePowerupUI);
  clearInterval(timerInterval);
  if (!fc) timerInterval = setInterval(() => { timer++; timerEl.textContent = String(timer).padStart(3,'0'); timerEl.classList.remove('pulse'); void timerEl.offsetWidth; timerEl.classList.add('pulse'); }, 1000);
}
function initBoardFrom(bd, mines, scores, t, fc) {
  board = bd; minePos = new Set(mines); score = scores; timer = t; firstClick = fc;
  revealed = []; flags = [];
  for (let r = 0; r < ROWS; r++) { revealed[r] = []; flags[r] = []; for (let c = 0; c < COLS; c++) { revealed[r][c] = false; flags[r][c] = false; } }
}
function startGame() {
  $('nameLeft').textContent = mySeat === 'left' ? 'ฉัน 👈' : (isHost ? 'คุณ' : oppName);
  $('nameRight').textContent = mySeat === 'right' ? 'ฉัน 👈' : (isHost ? 'คุณ' : oppName);
  $('scoreLeft').textContent = '0';
  $('scoreRight').textContent = '0';
  $('resetBtn').textContent = '🙂';
  updateMineCount();
  if (!isHost && firstClick) renderBoard();
}
function placeMines(exR, exC) {
  let placed = 0;
  while (placed < MINES) {
    const r = Math.floor(Math.random() * ROWS);
    const c = Math.floor(Math.random() * COLS);
    if (board[r][c] === -1 || (Math.abs(r-exR)<=1 && Math.abs(c-exC)<=1)) continue;
    board[r][c] = -1; minePos.add(r+','+c); placed++;
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (board[r][c] === -1) continue;
    let cnt = 0;
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) { const nr=r+dr,nc=c+dc; if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&board[nr][nc]===-1) cnt++; }
    board[r][c] = cnt;
  }
}
function floodFill(r, c, seen) {
  if (r<0||r>=ROWS||c<0||c>=COLS||revealed[r][c]||flags[r][c]) return 0;
  const key = r+','+c;
  if (seen.has(key)) return 0;
  seen.add(key);
  revealed[r][c] = true;
  let count = 1;
  if (board[r][c] === 0) for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) count += floodFill(r+dr, c+dc, seen);
  return count;
}
function processClick(r, c, playerIdx) {
  if (gameOver || revealed[r][c] || flags[r][c]) return null;
  if (firstClick) { firstClick = false; placeMines(r, c); startTimer(); }
  if (board[r][c] === -1) {
    // Shield blocks mine hit once (ponytail: simple inline check)
    if (shieldActive) {
      shieldActive = false;
      document.body.classList.remove('shield-ready');
      showToast('🛡️ โล่ป้องกันระเบิด!', 'info');
      // Mark cell as revealed but safe
      revealed[r][c] = true;
      renderBoard();
      totalClicks++;
      return { revealedCount: 1, newScore: score[playerIdx] };
    }
    const winnerSeat = playerIdx === 0 ? 'right' : 'left';
    const loserSeat = playerIdx === 0 ? 'left' : 'right';
    gameOver = true; clearInterval(timerInterval);
    for (const pos of minePos) { const [mr,mc]=pos.split(',').map(Number); revealed[mr][mc]=true; }
    if (isHost) conn.send({ type: 'game_over', winner: winnerSeat, loser: loserSeat, hitR: r, hitC: c, scores: score, board: board.map(r=>[...r]), revealed: revealed.map(r=>[...r]), flags: flags.map(r=>[...r]), minePos: [...minePos] });
    renderBoard();
    animateMineExplosion(r, c);
    updateScoresUI();
    $('resetBtn').textContent = '💀';
    if (isSolo) { showToast('💀 เกมโอเวอร์!', 'error'); showPopup('💀 เกมโอเวอร์'); }
    else {
      const isMe = (playerIdx === 0 && mySeat === 'left') || (playerIdx === 1 && mySeat === 'right');
      if (isMe) { showToast('💀 คุณเหยียบระเบิด!', 'error'); showPopup('💀 แพ้'); }
      else { showToast('🎉 คู่ต่อสู้เหยียบระเบิด! คุณชนะ!', 'info'); showPopup('🎉 ชนะ!'); createConfetti(); }
    }
    return null;
  }
  const seen = new Set();
  const revealedCount = floodFill(r, c, seen);
  score[playerIdx] += revealedCount;
  totalClicks++;
  renderBoard();
  animateReveal();
  updateScoresUI();
  checkWin(playerIdx);
  return { revealedCount, newScore: score[playerIdx] };
}
function processFlag(r, c) {
  if (gameOver || revealed[r][c]) return;
  flags[r][c] = !flags[r][c];
  renderBoard();
  updateMineCount();
}
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => { timer++; timerEl.textContent = String(timer).padStart(3,'0'); timerEl.classList.remove('pulse'); void timerEl.offsetWidth; timerEl.classList.add('pulse'); }, 1000);
}
function checkWin(playerIdx) {
  let count = 0;
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (revealed[r][c]) count++;
  if (count === ROWS*COLS - MINES) {
    gameOver = true; clearInterval(timerInterval); $('resetBtn').textContent = '😎';
    const winnerIdx = score[0] > score[1] ? 0 : (score[1] > score[0] ? 1 : -1);
    const isTie = winnerIdx === -1;
    if (isHost) conn.send({ type: 'game_over', winner: winnerIdx === 0 ? 'left' : 'right', tie: isTie, scores: score, board: board.map(r=>[...r]), revealed: revealed.map(r=>[...r]), flags: flags.map(r=>[...r]), minePos: [...minePos] });
    if (isSolo) { showToast('🎉 ชนะแล้ว!', 'info'); showPopup('🎉 ชนะ!'); createConfetti(); }
    else if (isTie) { showToast('🤝 เสมอกัน!', 'info'); showPopup('🤝 เสมอ!'); }
    else {
      const winnerSeat = winnerIdx === 0 ? 'left' : 'right';
      if (winnerSeat === mySeat) { showToast('🎉 คุณชนะ!', 'info'); const pts=Math.max(1000-timer*5,100); showPopup('🎉 ชนะ! +'+pts); createConfetti(); }
      else { showToast('😔 คุณแพ้!', 'error'); showPopup('😔 แพ้'); }
    }
    document.querySelectorAll('.cell').forEach((el,i)=>{ setTimeout(()=>el.classList.add('win-cell'), i*12); });
  }
}
function onCellClick(e, r, c) {
  e.stopPropagation();
  if (gameOver) return;
  // Paper powerup takes priority (ponytail: simple inline check)
  if (pendingPaper) {
    if (applyPowerupPaper(r, c)) { totalClicks++; return; }
  }
  if (isSolo) { processClick(r, c, 0); return; }
  if (isHost) {
    const playerIdx = mySeat === 'left' ? 0 : 1;
    const result = processClick(r, c, playerIdx);
    if (result) conn.send({ type: 'state_sync', board, revealed: revealed.map(row=>[...row]), flags: flags.map(row=>[...row]), minePos: [...minePos], score, timer, firstClick, gameOver });
  } else {
    const playerIdx = mySeat === 'left' ? 0 : 1;
    conn.send({ type: 'click', r, c, player: playerIdx });
    const cell = document.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    if (cell) cell.classList.add('pending');
  }
}
function onCellRightClick(e, r, c) {
  e.preventDefault();
  if (gameOver) return;
  if (isSolo) { processFlag(r, c); return; }
  if (isHost) {
    processFlag(r, c);
    conn.send({ type: 'state_sync', board, revealed: revealed.map(row=>[...row]), flags: flags.map(row=>[...row]), minePos: [...minePos], score, timer, firstClick, gameOver });
  } else conn.send({ type: 'flag', r, c });
}
function applyState(data) {
  board = data.board;
  revealed = data.revealed;
  flags = data.flags;
  minePos = new Set(data.minePos);
  score = data.score;
  timer = data.timer;
  firstClick = data.firstClick;
  gameOver = data.gameOver;
  timerEl.textContent = String(timer).padStart(3, '0');
  renderBoard();
  animateReveal();
  updateScoresUI();
  updateMineCount();
}
function renderBoard() {
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, 38px)`;
  boardEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r; cell.dataset.c = c;
      if (revealed[r][c]) {
        cell.classList.add('revealed');
        if (board[r][c] === -1) { cell.textContent = '💣'; cell.classList.add('mine'); }
        else if (board[r][c] > 0) { cell.innerHTML = '<span class="num">' + board[r][c] + '</span>'; cell.style.color = colors[board[r][c]]; }
      } else {
        cell.classList.add('hidden');
        if (flags[r][c]) { cell.textContent = '🚩'; cell.classList.add('flag'); }
      }
      cell.addEventListener('click', (ev) => onCellClick(ev, r, c));
      cell.addEventListener('contextmenu', (ev) => onCellRightClick(ev, r, c));
      boardEl.appendChild(cell);
    }
  }
}
function animateReveal() {
  const cells = boardEl.querySelectorAll('.cell.revealed');
  cells.forEach((el, i) => {
    el.style.animation = 'none'; void el.offsetWidth;
    el.style.animation = `revealAnim 0.3s ease forwards`;
    el.style.animationDelay = (i * 10) + 'ms';
    const num = el.querySelector('.num');
    if (num) { num.style.animation = 'none'; void num.offsetWidth; num.style.animation = 'numPop 0.3s ease'; }
  });
}
function animateMineExplosion(hitR, hitC) {
  gameEl.classList.remove('shake'); void gameEl.offsetWidth; gameEl.classList.add('shake');
  let idx = 0;
  for (const pos of minePos) {
    const [mr, mc] = pos.split(',').map(Number);
    setTimeout(() => {
      const el = document.querySelector(`[data-r="${mr}"][data-c="${mc}"]`);
      if (!el) return;
      if (mr === hitR && mc === hitC) { el.classList.add('mine-hit'); explodeParticles(el); }
      else { el.classList.add('mine'); }
    }, idx * 70);
    idx++;
  }
}
function explodeParticles(el) {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.style.cssText = `position:fixed;width:5px;height:5px;border-radius:50%;background:${['#e94560','#ff6b6b','#ffd93d','#ff8c00','#fff'][Math.floor(Math.random()*5)]};pointer-events:none;z-index:99;left:${cx}px;top:${cy}px`;
    document.body.appendChild(p);
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 120;
    p.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${Math.cos(angle)*dist}px,${Math.sin(angle)*dist}px) scale(0)`,opacity:0}],{duration:400+Math.random()*400,easing:'ease-out'}).onfinish = ()=>p.remove();
  }
}
function updateScoresUI() { $('scoreLeft').textContent = score[0]; $('scoreRight').textContent = score[1]; }
function updateMineCount() {
  let cnt = MINES;
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (flags[r][c]) cnt--;
  mineCountEl.textContent = String(cnt).padStart(3,'0');
}
function showToast(msg, type) {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '0.3s'; setTimeout(()=>t.remove(),300); }, 2500);
}
function showPopup(text) {
  const p = document.createElement('div'); p.className = 'popup'; p.textContent = text;
  gameEl.appendChild(p); setTimeout(() => p.remove(), 1400);
}
function createConfetti() {
  const cc = document.createElement('div'); cc.className = 'confetti-container';
  document.body.appendChild(cc);
  for (let i = 0; i < 100; i++) {
    const c = document.createElement('div'); c.className = 'confetti';
    c.style.left = Math.random()*100+'%';
    c.style.background = ['#e94560','#4ecca3','#3b82f6','#ffd93d','#9b59b6','#ff6b6b','#ff8c00','#1abc9c'][Math.floor(Math.random()*8)];
    c.style.width = (4+Math.random()*10)+'px'; c.style.height = (4+Math.random()*10)+'px';
    c.style.borderRadius = Math.random()>0.5?'50%':'2px';
    c.style.setProperty('--rot', (360+Math.random()*720)+'deg');
    c.style.animationDuration = (1.5+Math.random()*2.5)+'s';
    c.style.animationDelay = (Math.random()*2)+'s';
    cc.appendChild(c);
  }
  setTimeout(()=>cc.remove(), 5000);
}
function copyLink() {
  const url = $('shareUrl').textContent;
  navigator.clipboard.writeText(url).then(() => showToast('✅ คัดลอกลิงก์แล้ว!', 'info')).catch(() => {});
}
function resetGame() {
  restartMusic();
  if (isSolo) {
    initLocal(null, null, [0,0], 0, true);
    renderBoard();
    updateScoresUI();
    $('resetBtn').textContent = '🙂';
    gameOver = false;
    return;
  }
  if (isHost) {
    initLocal(null, null, [0,0], 0, true);
    renderBoard();
    updateScoresUI();
    $('resetBtn').textContent = '🙂';
    gameOver = false;
    conn.send({ type: 'reset_game', board, mines: [...minePos], scores: [0,0], timer: 0 });
  } else {
    conn.send({ type: 'reset_request' });
  }
}
(function(){
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room && room.length === 4) {
    $('roomCodeInput').value = room.toUpperCase();
    setTimeout(joinRoom, 500);
  }
})();
