'use strict';

// Pi to 320 digits: position 1 = "3", position 2 = "1", ... position 320 = "7"
// Stored without the decimal point; "." is rendered after position 1.
const PI_DIGITS = "314159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798214808651328230664709384460955058223172535940812848111745028410270193852110555964462294895493038196442881097566593344612847564823378678316527120190914564856692346034861045432664821339360726024914127372458700660631558817";
const TARGET = 300;

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
        <p class="sub">All 300 digits mastered. You're a pi master!</p>
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
          <h2>${who}: 300 digits! Perfect run.</h2>
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
// =========================================================================
// Input dispatch
// =========================================================================
function handleDigit(d) {
  if (!state.currentMode) return;
  if (state.currentMode === 'learn')     learnHandleDigit(d);
  else if (state.currentMode === 'test') testHandleDigit(d);
  else if (state.currentMode === 'typeahead') typeaheadHandleDigit(d);
  else if (state.currentMode === 'blanks') blanksHandleDigit(d);
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
