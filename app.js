'use strict';

// Pi to 250 digits: position 1 = "3", position 2 = "1", ... position 250 = "9"
// Stored without the decimal point; "." is rendered after position 1.
const PI_DIGITS = "3141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342117067982148086513282306647093844609550582231725359408128481117450284102701938521105559644622948954930381964428810975665933446128475648233786783165271201909";
const TARGET = 200;

// -------- State --------
const state = {
  mastered: parseInt(localStorage.getItem('pidg_mastered') || '0', 10),
  bestRun: parseInt(localStorage.getItem('pidg_best_run') || '0', 10),
  soundEnabled: localStorage.getItem('pidg_sound') !== 'off',
  currentMode: null,
  learn: null,
  test: null,
  typeahead: null,
  blanks: null,
};

const $ = id => document.getElementById(id);
const homeEl = $('home');
const gameEl = $('game');

function digitAt(pos) { return PI_DIGITS[pos - 1]; }

// -------- Persistence --------
function save() {
  localStorage.setItem('pidg_mastered', String(state.mastered));
  localStorage.setItem('pidg_best_run', String(state.bestRun));
  localStorage.setItem('pidg_sound', state.soundEnabled ? 'on' : 'off');
}
function updateMastered(pos) {
  if (pos > state.mastered) { state.mastered = Math.min(pos, TARGET); save(); }
}
function updateBestRun(run) {
  if (run > state.bestRun) { state.bestRun = run; save(); }
}

// -------- Audio --------
let audioCtx = null;
function tone(freq, duration, type = 'sine', volume = 0.1) {
  if (!state.soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = freq; osc.type = type;
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.start(); osc.stop(audioCtx.currentTime + duration);
  } catch (e) { /* no-op */ }
}
const sounds = {
  correct: () => tone(880, 0.08, 'sine', 0.08),
  wrong:   () => tone(180, 0.18, 'sawtooth', 0.07),
  milestone: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.10), i * 80)),
};

// -------- Confetti --------
const canvas = $('confetti-canvas');
const cctx = canvas.getContext('2d');
let particles = [];
let animRunning = false;
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function confetti(intensity = 50) {
  const colors = ['#DCFF1A', '#ffffff', '#FF2D2D', '#cccccc', '#8aff00'];
  for (let i = 0; i < intensity; i++) {
    particles.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 240,
      y: window.innerHeight / 2 + (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 1) * 14 - 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 7 + 4,
      life: 1.0,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.35,
    });
  }
  if (!animRunning) { animRunning = true; requestAnimationFrame(animateConfetti); }
}
function animateConfetti() {
  cctx.clearRect(0, 0, canvas.width, canvas.height);
  particles = particles.filter(p => p.life > 0 && p.y < canvas.height + 50);
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.35; p.vx *= 0.99;
    p.life -= 0.012; p.rot += p.vRot;
    cctx.save();
    cctx.globalAlpha = Math.max(0, p.life);
    cctx.translate(p.x, p.y);
    cctx.rotate(p.rot);
    cctx.fillStyle = p.color;
    cctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
    cctx.restore();
  });
  if (particles.length > 0) requestAnimationFrame(animateConfetti);
  else { animRunning = false; cctx.clearRect(0, 0, canvas.width, canvas.height); }
}

// -------- Screen management --------
const MODE_NAMES = {
  learn:     '📚 Learn',
  test:      '🎯 Test',
  typeahead: '⌨️ Type-Ahead',
  blanks:    '❓ Fill Blanks',
};

function renderHome() {
  $('mastered-stat').textContent = state.mastered;
  $('best-stat').textContent = state.bestRun;
  $('home-progress').style.width = `${(state.mastered / TARGET) * 100}%`;
  $('sound-toggle').checked = state.soundEnabled;
}
function showHome() {
  if (state.currentMode === 'defend' && typeof stopDefendLoop === 'function') stopDefendLoop();
  state.currentMode = null;
  homeEl.classList.remove('hidden');
  gameEl.classList.add('hidden');
  renderHome();
}
function showGame(mode) {
  state.currentMode = mode;
  homeEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  $('game-mode-title').textContent = MODE_NAMES[mode];
  MODE_INIT[mode]();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function scrollActiveIntoView() {
  const el = document.querySelector('.digit.current, .digit.hidden-slot.next');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const pad = 60;
  if (r.top < pad || r.bottom > window.innerHeight - pad - 200 /* leave room for pad */) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// -------- Leaderboard (Test mode) --------
function loadLeaderboard() {
  try { return JSON.parse(localStorage.getItem('pidg_leaderboard') || '[]'); }
  catch (e) { return []; }
}
function saveLeaderboard(arr) {
  arr.sort((a, b) => (b.digits - a.digits) || ((a.ts || 0) - (b.ts || 0)));
  localStorage.setItem('pidg_leaderboard', JSON.stringify(arr.slice(0, 50)));
}
function addLeaderboardEntry(name, digits) {
  if (!digits || digits < 1) return null;
  const entry = { name: (name || 'Player').slice(0, 24), digits, ts: Date.now() };
  const arr = loadLeaderboard();
  arr.push(entry);
  saveLeaderboard(arr);
  return entry;
}
function renderLeaderboardHtml(highlight) {
  const arr = loadLeaderboard();
  if (arr.length === 0) {
    return '<div class="leaderboard-empty">No runs yet — be the first!</div>';
  }
  let html = '<table class="leaderboard"><thead><tr><th>#</th><th>Name</th><th>Digits</th><th>When</th></tr></thead><tbody>';
  arr.slice(0, 10).forEach((e, i) => {
    const isHi = highlight && e.ts === highlight.ts && e.name === highlight.name && e.digits === highlight.digits;
    const d = new Date(e.ts);
    const dateStr = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    html += `<tr class="${isHi ? 'highlight' : ''}"><td>${i + 1}</td><td>${escapeHtml(e.name)}</td><td><b>${e.digits}</b></td><td>${dateStr}</td></tr>`;
  });
  html += '</tbody></table>';
  return html;
}

// Render a digit sequence with class per position
function renderStream(from, to, classOf, opts = {}) {
  let html = '<div class="digit-stream">';
  for (let i = from; i <= to; i++) {
    const cls = classOf(i) || '';
    if (opts.useText && cls === 'hidden-slot') {
      html += `<span class="digit hidden-slot${i === opts.nextBlank ? ' next' : ''}">?</span>`;
    } else {
      html += `<span class="digit ${cls}">${digitAt(i)}</span>`;
    }
    if (i === 1) html += '<span class="digit dot">.</span>';
  }
  html += '</div>';
  return html;
}

// =========================================================================
// LEARN MODE — chunk-and-test, 5 digits at a time from mastered+1
// =========================================================================
const MODE_INIT = {};

MODE_INIT.learn = function() {
  const startPos = state.mastered + 1;
  state.learn = {
    startPos, chunkSize: 5,
    currentChunk: 0,
    phase: 'study',  // 'study' | 'recall'
    typed: '',
    chunkErrors: 0,
  };
  renderLearn();
};

function learnChunkRange() {
  const s = state.learn;
  const start = s.startPos + s.currentChunk * s.chunkSize;
  const end = Math.min(start + s.chunkSize - 1, TARGET);
  return [start, end];
}

function renderLearn() {
  const s = state.learn;
  const [chunkStart, chunkEnd] = learnChunkRange();

  if (chunkStart > TARGET) {
    $('game-stat-display').textContent = `${TARGET} / ${TARGET}`;
    $('game-content').innerHTML = `
      <div class="result-card">
        <div class="result-emoji">🏆</div>
        <h2>You did it!</h2>
        <p class="sub">All 200 digits mastered. You're a pi master!</p>
        <div class="btn-row" style="margin-top: 16px;">
          <button class="action-btn" id="celebrate-btn">🎉 Celebrate again</button>
          <button class="action-btn secondary" id="home-from-win">Home</button>
        </div>
      </div>`;
    $('celebrate-btn').onclick = () => { confetti(140); sounds.milestone(); };
    $('home-from-win').onclick = showHome;
    confetti(140); sounds.milestone();
    return;
  }

  $('game-stat-display').textContent = `Chunk ${chunkStart}–${chunkEnd}`;
  const contextStart = Math.max(1, chunkStart - 5);
  const jumpRow = `
    <div class="jump-row">
      <label for="jump-input">📍 Jump to digit:</label>
      <input type="number" id="jump-input" min="1" max="${TARGET}" value="${chunkStart}" inputmode="numeric" />
      <button class="jump-btn" id="jump-go">Go</button>
      <button class="jump-btn secondary" id="jump-resume" title="Resume at mastered + 1">Resume</button>
    </div>`;

  if (s.phase === 'study') {
    let html = jumpRow;
    html += `<div class="position-label">Study digits <b>${chunkStart}–${chunkEnd}</b> (highlighted), then hide & recall</div>`;
    html += renderStream(contextStart, chunkEnd, i => i < chunkStart ? 'mastered' : 'current');
    html += '<div class="btn-row"><button class="action-btn" id="hide-btn">Hide & Recall →</button></div>';
    $('game-content').innerHTML = html;
    $('hide-btn').onclick = () => { state.learn.phase = 'recall'; state.learn.typed = ''; renderLearn(); };
    wireJumpRow();
    requestAnimationFrame(scrollActiveIntoView);
    return;
  }

  // Recall phase
  let html = jumpRow;
  html += `<div class="position-label">From memory: type digits <b>${chunkStart}–${chunkEnd}</b></div>`;
  html += '<div class="digit-stream">';
  for (let i = contextStart; i < chunkStart; i++) {
    html += `<span class="digit mastered">${digitAt(i)}</span>`;
    if (i === 1) html += '<span class="digit dot">.</span>';
  }
  for (let i = 0; i < (chunkEnd - chunkStart + 1); i++) {
    const typed = s.typed[i];
    if (typed === undefined) {
      const isNext = i === s.typed.length;
      html += `<span class="digit hidden-slot${isNext ? ' next' : ''}">?</span>`;
    } else {
      const correct = typed === digitAt(chunkStart + i);
      html += `<span class="digit ${correct ? 'correct' : 'wrong'}">${typed}</span>`;
    }
  }
  html += '</div>';
  html += `<div class="feedback" id="learn-feedback"></div>`;
  html += '<div class="btn-row"><button class="action-btn secondary" id="back-study">← Peek again</button></div>';
  $('game-content').innerHTML = html;
  $('back-study').onclick = () => { state.learn.phase = 'study'; state.learn.typed = ''; renderLearn(); };
  wireJumpRow();
  requestAnimationFrame(scrollActiveIntoView);
}

function wireJumpRow() {
  const input = $('jump-input');
  if (!input) return;
  const go = () => {
    let v = parseInt(input.value, 10);
    if (isNaN(v)) return;
    v = Math.max(1, Math.min(TARGET, v));
    state.learn.startPos = v;
    state.learn.currentChunk = 0;
    state.learn.phase = 'study';
    state.learn.typed = '';
    input.blur();
    renderLearn();
  };
  $('jump-go').onclick = go;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  $('jump-resume').onclick = () => {
    state.learn.startPos = Math.min(state.mastered + 1, TARGET);
    state.learn.currentChunk = 0;
    state.learn.phase = 'study';
    state.learn.typed = '';
    renderLearn();
  };
}

function learnHandleDigit(d) {
  const s = state.learn;
  if (s.phase !== 'recall') return;
  const [chunkStart, chunkEnd] = learnChunkRange();
  const idx = s.typed.length;
  const expected = digitAt(chunkStart + idx);

  if (d === expected) {
    sounds.correct();
    s.typed += d;
    renderLearn();
    if (s.typed.length === chunkEnd - chunkStart + 1) {
      // chunk complete
      const newMastered = chunkEnd;
      const previousMastered = state.mastered;
      updateMastered(newMastered);
      const fb = $('learn-feedback');
      if (fb) { fb.textContent = `🎉 Chunk ${chunkStart}–${chunkEnd} locked in!`; fb.className = 'feedback good'; }

      // Milestone every 10 mastered digits
      if (Math.floor(newMastered / 10) > Math.floor(previousMastered / 10)) {
        confetti(50); sounds.milestone();
      }
      setTimeout(() => {
        s.currentChunk++;
        s.phase = 'study';
        s.typed = '';
        s.chunkErrors = 0;
        renderLearn();
      }, 900);
    }
  } else {
    sounds.wrong();
    s.typed += d;
    s.chunkErrors++;
    renderLearn();
    const fb = $('learn-feedback');
    if (fb) { fb.textContent = `Not quite — it was ${expected}. Let's study it again.`; fb.className = 'feedback bad'; }
    setTimeout(() => {
      s.typed = '';
      s.phase = 'study';
      renderLearn();
    }, 1500);
  }
}

// =========================================================================
// TEST MODE — recall run from digit 1 until first mistake
// =========================================================================
MODE_INIT.test = function() {
  state.test = { pos: 0, started: false, ended: false, name: localStorage.getItem('pidg_test_name') || '' };
  renderTest();
};

function renderTest() {
  const s = state.test;
  $('game-stat-display').textContent = `Best: ${state.bestRun}`;

  if (!s.started) {
    const cachedName = localStorage.getItem('pidg_test_name') || '';
    $('game-content').innerHTML = `
      <div class="position-label">Recall Run</div>
      <div class="instruction">Type the digits of π from memory, starting with <b>3</b>. One mistake ends the run.</div>
      <div class="name-row">
        <label for="player-name">Your name:</label>
        <input type="text" id="player-name" maxlength="24" value="${escapeHtml(cachedName)}" placeholder="Player" autocomplete="off" />
      </div>
      <div class="btn-row"><button class="action-btn" id="start-test">Start →</button></div>
      <div class="leaderboard-section">
        <h3>🏆 Leaderboard</h3>
        ${renderLeaderboardHtml()}
      </div>`;
    $('start-test').onclick = () => {
      const nameVal = ($('player-name').value || '').trim().slice(0, 24) || 'Player';
      localStorage.setItem('pidg_test_name', nameVal);
      state.test.name = nameVal;
      state.test.started = true;
      renderTest();
    };
    return;
  }

  if (s.ended) return; // result screen handles itself

  // Show last ~16 correct + the "?" slot
  const showFrom = Math.max(1, s.pos - 14);
  let html = `<div class="position-label">Digit ${s.pos + 1} of ${TARGET}</div>`;
  html += '<div class="digit-stream">';
  for (let i = showFrom; i <= s.pos; i++) {
    html += `<span class="digit correct">${digitAt(i)}</span>`;
    if (i === 1) html += '<span class="digit dot">.</span>';
  }
  if (s.pos < TARGET) html += '<span class="digit current">?</span>';
  html += '</div>';
  html += `<div class="feedback good" id="test-feedback">Streak: ${s.pos}</div>`;
  html += '<div class="btn-row"><button class="action-btn secondary" id="give-up">End run</button></div>';
  $('game-content').innerHTML = html;
  $('give-up').onclick = endTestRun;
}

function endTestRun(wrongDigit) {
  const s = state.test;
  s.ended = true;
  const reached = s.pos;
  const isNewBest = reached > state.bestRun;
  updateBestRun(reached);
  updateMastered(Math.min(reached, state.mastered));  // never decreases

  const entry = addLeaderboardEntry(s.name || localStorage.getItem('pidg_test_name') || 'Player', reached);

  let extra = '';
  if (wrongDigit !== undefined) {
    extra = `<p class="sub">You typed <b style="color:var(--wrong)">${wrongDigit}</b> at digit ${reached + 1}; the correct one was <b style="color:var(--correct)">${digitAt(reached + 1)}</b>.</p>`;
  }
  const who = escapeHtml(s.name || 'You');
  $('game-content').innerHTML = `
    <div class="result-card">
      <div class="result-emoji">${isNewBest ? '🏆' : (reached >= 100 ? '⭐' : '👍')}</div>
      <h2>${who} reached digit ${reached}</h2>
      ${extra}
      <p class="sub">Best: ${state.bestRun}${isNewBest ? ' (new record!)' : ''}</p>
      <div class="btn-row" style="margin-top: 16px;">
        <button class="action-btn" id="retry-test">Try again</button>
        <button class="action-btn secondary" id="home-test">Home</button>
      </div>
      <div class="leaderboard-section">
        <h3>🏆 Leaderboard</h3>
        ${renderLeaderboardHtml(entry)}
      </div>
    </div>`;
  $('retry-test').onclick = () => MODE_INIT.test();
  $('home-test').onclick = showHome;
  if (isNewBest) { confetti(80); sounds.milestone(); }
}

function testHandleDigit(d) {
  const s = state.test;
  if (!s.started || s.ended) return;
  const expected = digitAt(s.pos + 1);
  if (d === expected) {
    s.pos++;
    sounds.correct();
    if (s.pos % 10 === 0) { confetti(35); sounds.milestone(); }
    if (s.pos === TARGET) {
      updateBestRun(TARGET);
      updateMastered(TARGET);
      s.ended = true;
      const entry = addLeaderboardEntry(s.name || localStorage.getItem('pidg_test_name') || 'Player', TARGET);
      const who = escapeHtml(s.name || 'You');
      $('game-content').innerHTML = `
        <div class="result-card">
          <div class="result-emoji">🏆🥧🏆</div>
          <h2>${who}: 200 digits! Perfect run.</h2>
          <p class="sub">You're a pi master.</p>
          <div class="btn-row" style="margin-top: 16px;">
            <button class="action-btn" id="retry-perfect">Do it again</button>
            <button class="action-btn secondary" id="home-perfect">Home</button>
          </div>
          <div class="leaderboard-section">
            <h3>🏆 Leaderboard</h3>
            ${renderLeaderboardHtml(entry)}
          </div>
        </div>`;
      $('retry-perfect').onclick = () => MODE_INIT.test();
      $('home-perfect').onclick = showHome;
      confetti(180); sounds.milestone();
    } else {
      renderTest();
      requestAnimationFrame(scrollActiveIntoView);
    }
  } else {
    sounds.wrong();
    setTimeout(() => endTestRun(d), 200);
  }
}

// =========================================================================
// TYPE-AHEAD MODE — guided practice; wrong reveals and continues
// =========================================================================
MODE_INIT.typeahead = function() {
  state.typeahead = { pos: 0, streak: 0, bestStreak: 0, wrongCount: 0, locked: false };
  renderTypeahead();
};

function renderTypeahead() {
  const s = state.typeahead;
  $('game-stat-display').textContent = `Streak: ${s.streak} • Errors: ${s.wrongCount}`;

  let html = '<div class="position-label">Type the next digit. Wrong = shown, then continue.</div>';
  const showFrom = Math.max(1, s.pos - 12);
  html += '<div class="digit-stream">';
  for (let i = showFrom; i <= s.pos; i++) {
    html += `<span class="digit mastered">${digitAt(i)}</span>`;
    if (i === 1) html += '<span class="digit dot">.</span>';
  }
  if (s.pos < TARGET) html += '<span class="digit current">?</span>';
  html += '</div>';
  html += `<div class="position-label">Digit ${s.pos + 1} of ${TARGET}</div>`;
  html += '<div class="feedback" id="ta-feedback"></div>';
  html += '<div class="btn-row"><button class="action-btn secondary" id="ta-restart">Restart</button></div>';
  $('game-content').innerHTML = html;
  $('ta-restart').onclick = () => MODE_INIT.typeahead();
}

function typeaheadHandleDigit(d) {
  const s = state.typeahead;
  if (s.locked || s.pos >= TARGET) return;
  const expected = digitAt(s.pos + 1);
  if (d === expected) {
    s.pos++;
    s.streak++;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    sounds.correct();
    updateMastered(s.pos);
    if (s.pos % 10 === 0) { confetti(35); sounds.milestone(); }
    if (s.pos === TARGET) {
      confetti(180); sounds.milestone();
    }
    renderTypeahead();
  } else {
    s.wrongCount++;
    s.streak = 0;
    sounds.wrong();
    s.locked = true;
    const fb = $('ta-feedback');
    if (fb) { fb.textContent = `Nope — it's ${expected}. Moving on.`; fb.className = 'feedback bad'; }
    // briefly show the correct digit as the position advances
    setTimeout(() => {
      s.pos++;
      s.locked = false;
      renderTypeahead();
    }, 1300);
  }
}

// =========================================================================
// FILL BLANKS MODE — show range, hide ~25% randomly, fill in
// =========================================================================
MODE_INIT.blanks = function() {
  const end = Math.max(50, Math.min(state.mastered, TARGET));
  const start = 1;
  const blanks = [];
  for (let i = start; i <= end; i++) {
    if (Math.random() < 0.25) blanks.push(i);
  }
  if (blanks.length === 0) blanks.push(Math.floor((start + end) / 2));

  state.blanks = {
    range: [start, end],
    blanks,
    blankSet: new Set(blanks),
    revealed: new Set(),
    currentIdx: 0,
    correct: 0,
    wrong: 0,
  };
  renderBlanks();
};

function renderBlanks() {
  const s = state.blanks;
  $('game-stat-display').textContent = `${s.correct}/${s.blanks.length} ✓ • ${s.wrong} ✗`;

  const done = s.currentIdx >= s.blanks.length;
  const nextBlank = done ? -1 : s.blanks[s.currentIdx];

  let html = `<div class="position-label">Range: digits <b>${s.range[0]}–${s.range[1]}</b>. ${done ? 'Round complete!' : 'Type the highlighted digit.'}</div>`;
  html += '<div class="digit-stream">';
  for (let i = s.range[0]; i <= s.range[1]; i++) {
    const isBlank = s.blankSet.has(i);
    const isRevealed = s.revealed.has(i);
    if (isBlank && !isRevealed) {
      html += `<span class="digit hidden-slot${i === nextBlank ? ' next' : ''}">?</span>`;
    } else if (isBlank && isRevealed) {
      html += `<span class="digit revealed">${digitAt(i)}</span>`;
    } else {
      html += `<span class="digit mastered">${digitAt(i)}</span>`;
    }
    if (i === 1) html += '<span class="digit dot">.</span>';
  }
  html += '</div>';
  html += `<div class="feedback" id="bl-feedback"></div>`;

  if (done) {
    const pct = Math.round((s.correct / s.blanks.length) * 100);
    html += `<div class="result-card" style="padding: 4px;">
      <div class="result-emoji">${pct === 100 ? '🎯' : (pct >= 80 ? '⭐' : '👍')}</div>
      <h2>Score: ${s.correct} / ${s.blanks.length}  (${pct}%)</h2>
    </div>`;
    html += '<div class="btn-row"><button class="action-btn" id="bl-again">New Round</button><button class="action-btn secondary" id="bl-home">Home</button></div>';
  }
  $('game-content').innerHTML = html;
  if (done) {
    $('bl-again').onclick = () => MODE_INIT.blanks();
    $('bl-home').onclick = showHome;
    if (s.correct === s.blanks.length) { confetti(80); sounds.milestone(); }
  } else {
    requestAnimationFrame(scrollActiveIntoView);
  }
}

function blanksHandleDigit(d) {
  const s = state.blanks;
  if (s.currentIdx >= s.blanks.length) return;
  const pos = s.blanks[s.currentIdx];
  const expected = digitAt(pos);
  if (d === expected) {
    s.correct++;
    sounds.correct();
  } else {
    s.wrong++;
    sounds.wrong();
    const fb = $('bl-feedback');
    if (fb) { fb.textContent = `Position ${pos} was ${expected}`; fb.className = 'feedback bad'; }
  }
  s.revealed.add(pos);
  s.currentIdx++;
  renderBlanks();
}

// =========================================================================
// DEFEND MODE — Pi Defender: shoot enemies carrying the correct pi digit
// =========================================================================
MODE_INIT.defend = function() {
  state.defend = {
    pos: 1,                       // current pi digit position to defend (1..TARGET)
    lives: 3,
    bestPos: parseInt(localStorage.getItem('pidg_defend_best') || '0', 10),
    enemies: [],
    particles: [],
    lasers: [],
    shake: 0,
    flash: 0,                     // red flash on wrong key, ms
    waveT: 0,                     // ms since last spawn
    spawnDelay: 1400,
    speed: 0.6,                   // px/ms downward
    started: false,
    ended: false,
    rafId: 0,
    lastT: 0,
  };
  renderDefend();
};

function renderDefend() {
  const s = state.defend;
  $('game-stat-display').textContent = `Best: ${s.bestPos}`;

  if (!s.started) {
    $('game-content').innerHTML = `
      <div class="position-label">π Defender</div>
      <div class="instruction">Enemies carrying digits fall from above. Press the digit that matches the next π position to <b>blast it</b> before it reaches the core. Wrong key = damage. Three lives.</div>
      <div class="defend-rules">
        <span>🛡️ ${s.lives} lives</span>
        <span>🎯 starts at digit 1</span>
        <span>⚡ speed climbs every 10 digits</span>
      </div>
      <div class="btn-row"><button class="action-btn" id="defend-start">Defend! →</button></div>`;
    $('defend-start').onclick = () => {
      state.defend.started = true;
      buildDefendStage();
    };
    return;
  }
}

function buildDefendStage() {
  const s = state.defend;
  $('game-content').innerHTML = `
    <div class="defend-hud">
      <div class="defend-target">Defending digit <b id="defend-pos">${s.pos}</b> of ${TARGET}</div>
      <div class="defend-lives" id="defend-lives"></div>
    </div>
    <div class="defend-stage" id="defend-stage">
      <canvas id="defend-canvas"></canvas>
      <div class="defend-flash" id="defend-flash"></div>
    </div>
    <div class="feedback" id="defend-feedback">Spawning…</div>`;

  renderDefendLives();
  startDefendLoop();
}

function renderDefendLives() {
  const s = state.defend;
  const el = $('defend-lives');
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < s.lives; i++) {
    const heart = document.createElement('span');
    heart.className = 'defend-heart';
    heart.textContent = '♥';
    el.appendChild(heart);
  }
}

function startDefendLoop() {
  const s = state.defend;
  const canvas = $('defend-canvas');
  if (!canvas) return;
  const dctx = canvas.getContext('2d');

  function resize() {
    const stage = $('defend-stage');
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.cw = r.width;
    s.ch = r.height;
  }
  resize();
  s.resize = resize;
  window.addEventListener('resize', resize);

  s.lastT = performance.now();
  s.enemies = [];
  s.particles = [];
  s.lasers = [];
  s.waveT = 0;
  s.shake = 0;
  s.flash = 0;
  s.speed = 0.06;        // px per ms (slow)
  s.spawnDelay = 1400;

  const loop = (t) => {
    if (state.currentMode !== 'defend' || !state.defend || state.defend.ended) return;
    const dt = Math.min(48, t - s.lastT);
    s.lastT = t;
    updateDefend(dt);
    drawDefend(dctx);
    s.rafId = requestAnimationFrame(loop);
  };
  s.rafId = requestAnimationFrame(loop);
}

function stopDefendLoop() {
  const s = state.defend;
  if (!s) return;
  if (s.rafId) cancelAnimationFrame(s.rafId);
  s.rafId = 0;
  if (s.resize) window.removeEventListener('resize', s.resize);
}

function spawnDefendEnemy() {
  const s = state.defend;
  const correctDigit = digitAt(s.pos);

  // Decide if this enemy carries the correct digit (~30% chance, or guarantee if none on screen)
  const hasCorrect = s.enemies.some(e => e.digit === correctDigit);
  let digit;
  if (!hasCorrect && Math.random() < 0.55) {
    digit = correctDigit;
  } else if (Math.random() < 0.28) {
    digit = correctDigit;
  } else {
    // pick a decoy that's not the correct digit
    do { digit = String(Math.floor(Math.random() * 10)); } while (digit === correctDigit && Math.random() < 0.6);
  }

  const r = 22;
  const margin = r + 8;
  s.enemies.push({
    digit,
    x: margin + Math.random() * (s.cw - margin * 2),
    y: -r,
    vx: (Math.random() - 0.5) * 0.04,
    vy: s.speed + Math.random() * 0.02,
    r,
    spin: Math.random() * Math.PI * 2,
    born: performance.now(),
  });
}

function updateDefend(dt) {
  const s = state.defend;

  // Spawn timing
  s.waveT += dt;
  if (s.waveT >= s.spawnDelay) {
    s.waveT = 0;
    spawnDefendEnemy();
  }

  // Move enemies
  for (let i = s.enemies.length - 1; i >= 0; i--) {
    const e = s.enemies[i];
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.spin += dt * 0.003;
    if (e.x < e.r) { e.x = e.r; e.vx = Math.abs(e.vx); }
    if (e.x > s.cw - e.r) { e.x = s.cw - e.r; e.vx = -Math.abs(e.vx); }
    // Reached the core?
    if (e.y - e.r > s.ch) {
      s.enemies.splice(i, 1);
      if (e.digit === digitAt(s.pos)) {
        defendLoseLife(`Digit ${s.pos} (${e.digit}) slipped past!`);
      }
    }
  }

  // Lasers
  for (let i = s.lasers.length - 1; i >= 0; i--) {
    const L = s.lasers[i];
    L.age += dt;
    if (L.age >= L.life) s.lasers.splice(i, 1);
  }

  // Particles
  for (let i = s.particles.length - 1; i >= 0; i--) {
    const p = s.particles[i];
    p.x += p.vx * dt * 0.06;
    p.y += p.vy * dt * 0.06;
    p.vy += 0.5 * dt * 0.06;     // gravity
    p.age += dt;
    if (p.age >= p.life) s.particles.splice(i, 1);
  }

  // Shake & flash decay
  s.shake *= 0.88;
  if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);
}

function drawDefend(dctx) {
  const s = state.defend;
  const w = s.cw, h = s.ch;

  // Background gradient
  const g = dctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0a0a0a');
  g.addColorStop(1, '#1a0a0a');
  dctx.fillStyle = g;
  dctx.fillRect(0, 0, w, h);

  // Core line (bottom defense)
  dctx.save();
  const coreY = h - 6;
  dctx.strokeStyle = 'rgba(220, 255, 26, 0.5)';
  dctx.lineWidth = 2;
  dctx.shadowColor = '#DCFF1A';
  dctx.shadowBlur = 12;
  dctx.beginPath();
  dctx.moveTo(0, coreY); dctx.lineTo(w, coreY);
  dctx.stroke();
  dctx.restore();

  // Shake
  dctx.save();
  if (s.shake > 0.2) {
    dctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
  }

  // Lasers
  for (const L of s.lasers) {
    const a = 1 - L.age / L.life;
    dctx.strokeStyle = `rgba(220, 255, 26, ${a})`;
    dctx.lineWidth = 3;
    dctx.shadowColor = '#DCFF1A';
    dctx.shadowBlur = 16;
    dctx.beginPath();
    dctx.moveTo(L.x, h);
    dctx.lineTo(L.x, L.y);
    dctx.stroke();
  }

  // Particles
  for (const p of s.particles) {
    const a = 1 - p.age / p.life;
    dctx.globalAlpha = a;
    dctx.fillStyle = p.color;
    dctx.shadowColor = p.color;
    dctx.shadowBlur = 10;
    dctx.beginPath();
    dctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    dctx.fill();
  }
  dctx.globalAlpha = 1;
  dctx.shadowBlur = 0;

  // Enemies (hexagon UFOs)
  const correctDigit = digitAt(s.pos);
  for (const e of s.enemies) {
    const isCorrect = e.digit === correctDigit;
    dctx.save();
    dctx.translate(e.x, e.y);
    dctx.rotate(e.spin);
    dctx.strokeStyle = isCorrect ? '#DCFF1A' : '#ff5577';
    dctx.shadowColor = isCorrect ? '#DCFF1A' : '#ff5577';
    dctx.shadowBlur = 14;
    dctx.lineWidth = 2;
    dctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * e.r, y = Math.sin(a) * e.r;
      if (i === 0) dctx.moveTo(x, y); else dctx.lineTo(x, y);
    }
    dctx.stroke();
    dctx.rotate(-e.spin);
    dctx.fillStyle = isCorrect ? '#DCFF1A' : '#ffffff';
    dctx.shadowBlur = 6;
    dctx.font = '800 22px -apple-system, BlinkMacSystemFont, sans-serif';
    dctx.textAlign = 'center';
    dctx.textBaseline = 'middle';
    dctx.fillText(e.digit, 0, 1);
    dctx.restore();
  }

  dctx.restore();
}

function defendFireAt(digit) {
  const s = state.defend;
  let hitAny = false;
  let hitCorrect = false;
  const correctDigit = digitAt(s.pos);

  // Find all enemies with this digit (target lowest = closest to core first)
  const matches = s.enemies.filter(e => e.digit === digit);
  matches.sort((a, b) => b.y - a.y);

  for (const e of matches) {
    // Spawn laser visual from bottom to enemy
    s.lasers.push({ x: e.x, y: e.y, life: 220, age: 0 });
    // Explosion particles
    const color = (e.digit === correctDigit) ? '#DCFF1A' : '#ff8899';
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      s.particles.push({
        x: e.x, y: e.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        color, size: 2 + Math.random() * 2,
        life: 600, age: 0,
      });
    }
    hitAny = true;
    if (e.digit === correctDigit) hitCorrect = true;
    // Remove enemy
    const idx = s.enemies.indexOf(e);
    if (idx >= 0) s.enemies.splice(idx, 1);
  }

  if (!hitAny) {
    // No enemy with that digit — miss penalty (small): flash, no life lost
    s.flash = 200;
    sounds.wrong();
    const fb = $('defend-feedback');
    if (fb) { fb.textContent = `No digit ${digit} on screen — careful!`; fb.className = 'feedback bad'; }
    return;
  }

  if (hitCorrect) {
    sounds.correct();
    const previousMastered = state.mastered;
    s.pos = Math.min(TARGET, s.pos + 1);
    updateMastered(s.pos - 1);
    $('defend-pos').textContent = s.pos;
    const fb = $('defend-feedback');
    if (fb) { fb.textContent = `🎯 ${digit} hit! Next: digit ${s.pos}`; fb.className = 'feedback good'; }
    // Milestone every 10 digits
    if (Math.floor((s.pos - 1) / 10) > Math.floor((s.pos - 2) / 10)) {
      confetti(40); sounds.milestone();
      // ramp difficulty
      s.spawnDelay = Math.max(450, s.spawnDelay - 90);
      s.speed = Math.min(0.22, s.speed + 0.012);
    }
    // Save best
    if (s.pos - 1 > s.bestPos) {
      s.bestPos = s.pos - 1;
      localStorage.setItem('pidg_defend_best', String(s.bestPos));
      $('game-stat-display').textContent = `Best: ${s.bestPos}`;
    }
    if (s.pos > TARGET) {
      defendWin();
    }
  } else {
    // Hit wrong digit — small flash, no life lost (lasers are free), keep playing
    sounds.hit && sounds.hit();
    const fb = $('defend-feedback');
    if (fb) { fb.textContent = `Hit ${digit} — but π wants ${correctDigit}.`; fb.className = 'feedback bad'; }
  }
}

function defendLoseLife(reason) {
  const s = state.defend;
  s.lives--;
  s.shake = 16;
  s.flash = 350;
  sounds.wrong();
  renderDefendLives();
  const fb = $('defend-feedback');
  if (fb) { fb.textContent = `💥 ${reason}  Lives: ${s.lives}`; fb.className = 'feedback bad'; }
  if (s.lives <= 0) defendGameOver();
}

function defendGameOver() {
  const s = state.defend;
  s.ended = true;
  stopDefendLoop();
  const reached = s.pos - 1;
  const isBest = reached >= s.bestPos && reached > 0;
  $('game-content').innerHTML = `
    <div class="result-card">
      <div class="result-emoji">${isBest ? '🏆' : '💥'}</div>
      <h2>You defended ${reached} digits</h2>
      <p class="sub">${reached >= 50 ? 'Strong defense!' : reached >= 20 ? 'Solid run.' : 'Try again — π needs you.'}</p>
      <p class="sub">Best: ${s.bestPos}${isBest && reached > 0 ? ' (new record!)' : ''}</p>
      <div class="btn-row" style="margin-top: 16px;">
        <button class="action-btn" id="defend-retry">Defend again</button>
        <button class="action-btn secondary" id="defend-home">Home</button>
      </div>
    </div>`;
  $('defend-retry').onclick = () => MODE_INIT.defend();
  $('defend-home').onclick = showHome;
  if (isBest && reached > 0) { confetti(80); sounds.milestone(); }
}

function defendWin() {
  const s = state.defend;
  s.ended = true;
  stopDefendLoop();
  $('game-content').innerHTML = `
    <div class="result-card">
      <div class="result-emoji">🏆🛡️π</div>
      <h2>You defended all 200 digits!</h2>
      <p class="sub">π is safe. Legendary defender.</p>
      <div class="btn-row" style="margin-top: 16px;">
        <button class="action-btn" id="defend-again">Play again</button>
        <button class="action-btn secondary" id="defend-home2">Home</button>
      </div>
    </div>`;
  $('defend-again').onclick = () => MODE_INIT.defend();
  $('defend-home2').onclick = showHome;
  confetti(220); sounds.milestone();
}

function defendHandleDigit(d) {
  const s = state.defend;
  if (!s || !s.started || s.ended) return;
  defendFireAt(d);
}

// =========================================================================
// Input dispatch
// =========================================================================
function handleDigit(d) {
  if (!state.currentMode) return;
  if (state.currentMode === 'learn')     learnHandleDigit(d);
  else if (state.currentMode === 'test') testHandleDigit(d);
  else if (state.currentMode === 'typeahead') typeaheadHandleDigit(d);
  else if (state.currentMode === 'blanks') blanksHandleDigit(d);
  else if (state.currentMode === 'defend') defendHandleDigit(d);
}

// -------- Event wiring --------
document.querySelectorAll('.mode-btn').forEach(b => {
  b.addEventListener('click', () => showGame(b.dataset.mode));
});
$('back-btn').addEventListener('click', showHome);
$('sound-toggle').addEventListener('change', e => { state.soundEnabled = e.target.checked; save(); });
$('reset-btn').addEventListener('click', () => {
  if (confirm('Reset everything? This clears mastered digits, best run, and the leaderboard.')) {
    state.mastered = 0;
    state.bestRun = 0;
    save();
    localStorage.removeItem('pidg_leaderboard');
    renderHome();
  }
});

document.querySelectorAll('.number-pad button').forEach(b => {
  b.addEventListener('click', () => handleDigit(b.dataset.digit));
});

document.addEventListener('keydown', e => {
  // Don't capture digits when the user is typing in an input (jump-to-digit, name)
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (/^[0-9]$/.test(e.key)) handleDigit(e.key);
  else if (e.key === 'Escape') {
    if (state.currentMode) showHome();
  }
});

// Init
renderHome();
