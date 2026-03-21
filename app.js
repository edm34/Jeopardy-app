// ===== Jeopardy! Home Buzzer — Main Application =====
//
// Timing model for syncing with a live broadcast:
// - Host reads the clue aloud (~5-8 seconds depending on length).
//   The player triggers "reading" phase by selecting a clue value.
// - After reading time, buzzer window OPENS for ~5 seconds.
//   This mirrors the real show's buzzer lights-on moment.
// - Player presses SPACEBAR or taps the buzzer button.
// - If buzzed in: 5-second response timer starts.
// - If not buzzed in time: window closes, mark what contestants did.
//
// The player manually tracks contestant scores since we can't read
// the broadcast programmatically, but the flow stays in sync with
// the show's natural pacing.

(() => {
  'use strict';

  // ─── State ────────────────────────────────────────────────────
  const state = {
    playerName: 'You',
    contestants: ['Contestant 1', 'Contestant 2', 'Contestant 3'],
    scores: { player: 0, c1: 0, c2: 0, c3: 0 },
    round: 1,          // 1 = Jeopardy, 2 = Double Jeopardy
    clueCount: 0,
    currentValue: 0,
    isDailyDouble: false,
    phase: 'idle',     // idle | reading | open | buzzed | result
    readingDuration: 6000,   // ms — simulates host reading time
    buzzerWindow: 5000,      // ms — window to buzz in
    responseTime: 5000,      // ms — time to answer after buzzing
    timers: {},
    usedClues: new Set(),
  };

  // ─── DOM refs ─────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    setupScreen: $('#setup-screen'),
    gameScreen: $('#game-screen'),
    summaryScreen: $('#summary-screen'),
    playerNameInput: $('#player-name'),
    contestantInputs: [$('#contestant-1'), $('#contestant-2'), $('#contestant-3')],
    startBtn: $('#start-game-btn'),
    scoreboard: {
      player: { name: $('#score-player .score-name'), value: $('#score-player .score-value') },
      c1: { name: $('#score-c1 .score-name'), value: $('#score-c1 .score-value') },
      c2: { name: $('#score-c2 .score-name'), value: $('#score-c2 .score-value') },
      c3: { name: $('#score-c3 .score-name'), value: $('#score-c3 .score-value') },
    },
    roundLabel: $('#round-label'),
    clueCount: $('#clue-count'),
    valueButtons: $('#value-buttons'),
    ddBtn: $('#dd-btn'),
    buzzerBtn: $('#buzzer-btn'),
    statusText: $('#status-text'),
    timerBar: $('#timer-bar'),
    responseArea: $('#response-area'),
    responseTime: $('#response-time'),
    btnCorrect: $('#btn-correct'),
    btnIncorrect: $('#btn-incorrect'),
    contestantBuzzedArea: $('#contestant-buzzed-area'),
    contestantBuzzText: $('#contestant-buzz-text'),
    clueResultArea: $('#clue-result-area'),
    resultText: $('#result-text'),
    btnNextClue: $('#btn-next-clue'),
    ddWagerArea: $('#dd-wager-area'),
    ddWager: $('#dd-wager'),
    ddSubmit: $('#dd-submit'),
    ddResponse: $('#dd-response'),
    ddTime: $('#dd-time'),
    ddCorrect: $('#dd-correct'),
    ddIncorrect: $('#dd-incorrect'),
    ddContestantSelect: $('#dd-contestant-select'),
    ddContestantPicker: $('#dd-contestant-picker'),
    finalArea: $('#final-jeopardy-area'),
    fjPlayerWager: $('#fj-player-wager'),
    fjPlayerMax: $('#fj-player-max'),
    fjContestantWagers: $('#fj-contestant-wagers'),
    fjStartTimer: $('#fj-start-timer'),
    fjTimerDisplay: $('#fj-timer-display'),
    fjTimerValue: $('#fj-timer-value'),
    fjResults: $('#fj-results'),
    fjResultInputs: $('#fj-result-inputs'),
    fjApply: $('#fj-apply'),
    btnRoundToggle: $('#btn-round-toggle'),
    btnFinalJeopardy: $('#btn-final-jeopardy'),
    btnSync: $('#btn-sync'),
    btnEndGame: $('#btn-end-game'),
    adjustModal: $('#adjust-modal'),
    adjustName: $('#adjust-name'),
    adjustCurrent: $('#adjust-current'),
    adjustValue: $('#adjust-value'),
    adjustSave: $('#adjust-save'),
    adjustCancel: $('#adjust-cancel'),
    summaryScores: $('#summary-scores'),
    btnNewGame: $('#btn-new-game'),
  };

  // ─── Helpers ──────────────────────────────────────────────────
  function formatMoney(val) {
    const abs = Math.abs(val);
    const str = '$' + abs.toLocaleString();
    return val < 0 ? '-' + str : str;
  }

  function showScreen(screen) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
  }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function clearTimers() {
    Object.values(state.timers).forEach(t => clearTimeout(t));
    state.timers = {};
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  // ─── Scoreboard ───────────────────────────────────────────────
  function updateScores() {
    for (const key of ['player', 'c1', 'c2', 'c3']) {
      const val = state.scores[key];
      dom.scoreboard[key].value.textContent = formatMoney(val);
      dom.scoreboard[key].value.classList.toggle('negative', val < 0);
    }
  }

  function addScore(who, amount) {
    state.scores[who] += amount;
    updateScores();
  }

  // ─── Value Buttons ────────────────────────────────────────────
  function buildValueGrid() {
    dom.valueButtons.innerHTML = '';
    const multiplier = state.round === 1 ? 1 : 2;
    const values = [200, 400, 600, 800, 1000];

    values.forEach(v => {
      const val = v * multiplier;
      const btn = document.createElement('button');
      btn.className = 'value-btn';
      btn.textContent = '$' + val;
      btn.dataset.value = val;

      const key = `${state.round}-${val}`;
      if (state.usedClues.has(key)) {
        btn.classList.add('used');
      }

      btn.addEventListener('click', () => {
        if (btn.classList.contains('used')) return;
        if (state.phase !== 'idle') return;
        selectClueValue(val, btn);
      });

      dom.valueButtons.appendChild(btn);
    });
  }

  function selectClueValue(value, btnEl) {
    // Deselect others
    $$('.value-btn').forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
    state.currentValue = value;
    startReadingPhase();
  }

  function markClueUsed() {
    const key = `${state.round}-${state.currentValue}`;
    state.usedClues.add(key);
    state.clueCount++;
    dom.clueCount.textContent = `Clue: ${state.clueCount} / ${state.round === 1 ? 30 : 30}`;
    buildValueGrid();
  }

  // ─── Reading Phase ────────────────────────────────────────────
  // Simulates the host reading the clue aloud.
  function startReadingPhase() {
    state.phase = 'reading';
    dom.statusText.textContent = 'Host is reading the clue...';
    dom.statusText.className = 'reading';
    dom.buzzerBtn.disabled = true;
    dom.timerBar.className = 'reading';

    hide(dom.responseArea);
    hide(dom.contestantBuzzedArea);
    hide(dom.clueResultArea);

    // Animate reading timer bar
    const start = Date.now();
    const dur = state.readingDuration;
    state.timerInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / dur) * 100);
      dom.timerBar.style.width = pct + '%';
    }, 50);

    state.timers.reading = setTimeout(() => {
      clearInterval(state.timerInterval);
      dom.timerBar.style.width = '0%';
      openBuzzerWindow();
    }, dur);
  }

  // ─── Buzzer Window ────────────────────────────────────────────
  function openBuzzerWindow() {
    state.phase = 'open';
    dom.statusText.textContent = 'BUZZERS OPEN — Hit SPACE!';
    dom.statusText.className = 'open';
    dom.buzzerBtn.disabled = false;
    dom.timerBar.className = 'open';

    JeopardyAudio.buzzerOpen();

    const start = Date.now();
    const dur = state.buzzerWindow;

    state.timerInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / dur) * 100);
      dom.timerBar.style.width = pct + '%';

      // Turn red in last 1.5s
      if (elapsed > dur - 1500) {
        dom.timerBar.className = 'urgent';
      }
    }, 50);

    state.timers.buzzerClose = setTimeout(() => {
      clearInterval(state.timerInterval);
      buzzerWindowClosed();
    }, dur);
  }

  function buzzerWindowClosed() {
    if (state.phase !== 'open') return;
    state.phase = 'result';
    dom.buzzerBtn.disabled = true;
    dom.statusText.textContent = 'Time expired — You didn\'t buzz in';
    dom.statusText.className = 'locked';
    dom.timerBar.style.width = '0%';

    JeopardyAudio.timeUp();

    // Show options: did a contestant answer?
    dom.contestantBuzzText.textContent = 'Did a contestant answer this clue?';
    show(dom.contestantBuzzedArea);

    // Also show a "no one got it" option
    dom.resultText.textContent = '';
    show(dom.clueResultArea);
    dom.btnNextClue.textContent = 'No One Answered — Next Clue';
  }

  // ─── Buzz In ──────────────────────────────────────────────────
  function buzzIn() {
    if (state.phase !== 'open') return;
    state.phase = 'buzzed';
    clearTimers();

    dom.buzzerBtn.disabled = true;
    dom.buzzerBtn.classList.add('buzzed');
    dom.statusText.textContent = 'YOU BUZZED IN!';
    dom.statusText.className = 'open';
    dom.timerBar.className = 'open';

    JeopardyAudio.buzzIn();

    // Start 5-second response timer
    show(dom.responseArea);
    let remaining = 5;
    dom.responseTime.textContent = remaining;

    const start = Date.now();
    const dur = state.responseTime;

    state.timerInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      remaining = Math.max(0, Math.ceil((dur - elapsed) / 1000));
      dom.responseTime.textContent = remaining;

      const pct = Math.max(0, 100 - (elapsed / dur) * 100);
      dom.timerBar.style.width = pct + '%';

      if (remaining <= 2) {
        dom.timerBar.className = 'urgent';
      }

      if (remaining <= 0) {
        JeopardyAudio.tick();
      }
    }, 100);

    state.timers.responseEnd = setTimeout(() => {
      clearInterval(state.timerInterval);
      // Time ran out — automatic wrong
      handlePlayerResponse(false);
    }, dur);
  }

  function handlePlayerResponse(correct) {
    clearTimers();
    dom.buzzerBtn.classList.remove('buzzed');
    hide(dom.responseArea);

    const value = state.currentValue;

    if (correct) {
      addScore('player', value);
      JeopardyAudio.correct();
      dom.statusText.textContent = `Correct! +${formatMoney(value)}`;
      dom.statusText.className = 'open';
    } else {
      addScore('player', -value);
      JeopardyAudio.incorrect();
      dom.statusText.textContent = `Wrong! -${formatMoney(value)}`;
      dom.statusText.className = 'locked';
    }

    // Show contestant follow-up if incorrect (someone else might answer on TV)
    if (!correct) {
      dom.contestantBuzzText.textContent = 'Did a contestant answer correctly?';
      show(dom.contestantBuzzedArea);
    }

    markClueUsed();
    showNextClueButton('Next Clue');
  }

  function showNextClueButton(text) {
    dom.resultText.textContent = '';
    dom.btnNextClue.textContent = text;
    show(dom.clueResultArea);
  }

  // ─── Contestant Actions ───────────────────────────────────────
  function handleContestantResult(correct) {
    hide(dom.contestantBuzzedArea);

    if (correct) {
      // Ask which contestant
      showContestantPicker('Who answered correctly?', (who) => {
        addScore(who, state.currentValue);
      });
    }
    // If wrong, nothing changes — next clue
  }

  function showContestantPicker(prompt, callback) {
    // Quick inline picker using the contestant buzzed area
    dom.contestantBuzzText.textContent = prompt;
    const buttonsDiv = dom.contestantBuzzedArea.querySelector('.response-buttons');
    buttonsDiv.innerHTML = '';

    ['c1', 'c2', 'c3'].forEach((key, i) => {
      const btn = document.createElement('button');
      btn.className = 'btn-correct';
      btn.textContent = state.contestants[i];
      btn.addEventListener('click', () => {
        callback(key);
        hide(dom.contestantBuzzedArea);
        // Restore original buttons
        restoreContestantButtons();
      });
      buttonsDiv.appendChild(btn);
    });

    show(dom.contestantBuzzedArea);
  }

  function restoreContestantButtons() {
    const buttonsDiv = dom.contestantBuzzedArea.querySelector('.response-buttons');
    buttonsDiv.innerHTML = `
      <button class="btn-correct" data-action="contestant-correct">They got it right</button>
      <button class="btn-incorrect" data-action="contestant-wrong">They got it wrong</button>
    `;
    // Re-bind
    buttonsDiv.querySelector('[data-action="contestant-correct"]')
      .addEventListener('click', () => handleContestantResult(true));
    buttonsDiv.querySelector('[data-action="contestant-wrong"]')
      .addEventListener('click', () => handleContestantResult(false));
  }

  function resetForNextClue() {
    clearTimers();
    state.phase = 'idle';
    state.currentValue = 0;
    state.isDailyDouble = false;
    dom.buzzerBtn.disabled = true;
    dom.buzzerBtn.classList.remove('buzzed');
    dom.statusText.textContent = 'Select a clue to begin';
    dom.statusText.className = '';
    dom.timerBar.style.width = '0%';
    dom.timerBar.className = '';
    hide(dom.responseArea);
    hide(dom.contestantBuzzedArea);
    hide(dom.clueResultArea);
    hide(dom.ddWagerArea);

    $$('.value-btn').forEach(b => b.classList.remove('selected'));
  }

  // ─── Daily Double ─────────────────────────────────────────────
  let ddWho = 'player'; // who found the daily double

  function startDailyDouble() {
    if (state.phase !== 'idle' || state.currentValue === 0) {
      // Need a clue value selected first
      if (state.currentValue === 0) {
        dom.statusText.textContent = 'Select a clue value first, then press Daily Double';
        dom.statusText.className = 'locked';
        return;
      }
    }

    clearTimers();
    state.phase = 'daily-double';
    state.isDailyDouble = true;
    JeopardyAudio.dailyDouble();

    hide(dom.responseArea);
    hide(dom.contestantBuzzedArea);
    hide(dom.clueResultArea);
    show(dom.ddWagerArea);
    hide(dom.ddResponse);

    ddWho = 'player';
    $$('.btn-dd-who').forEach(b => b.classList.remove('active'));
    $$('.btn-dd-who')[0].classList.add('active');
    hide(dom.ddContestantSelect);

    // Set max wager
    const maxWager = Math.max(
      state.round === 1 ? 1000 : 2000,
      state.scores.player
    );
    dom.ddWager.max = maxWager;
    dom.ddWager.value = Math.min(1000, maxWager);

    // Update contestant picker names
    const opts = dom.ddContestantPicker.options;
    opts[0].textContent = state.contestants[0];
    opts[1].textContent = state.contestants[1];
    opts[2].textContent = state.contestants[2];
  }

  function submitDailyDouble() {
    const wager = parseInt(dom.ddWager.value) || 0;
    if (wager <= 0) return;

    hide(dom.ddWagerArea);

    if (ddWho === 'player') {
      // Player answers — show response timer
      state.phase = 'dd-response';
      show(dom.ddWagerArea);
      show(dom.ddResponse);

      let remaining = 10;
      dom.ddTime.textContent = remaining;

      state.timerInterval = setInterval(() => {
        remaining--;
        dom.ddTime.textContent = Math.max(0, remaining);
        if (remaining <= 0) {
          clearInterval(state.timerInterval);
        }
      }, 1000);

      // Wire up correct/incorrect
      dom.ddCorrect.onclick = () => {
        clearTimers();
        addScore('player', wager);
        JeopardyAudio.correct();
        finishDailyDouble(`Correct! +${formatMoney(wager)}`);
      };

      dom.ddIncorrect.onclick = () => {
        clearTimers();
        addScore('player', -wager);
        JeopardyAudio.incorrect();
        finishDailyDouble(`Wrong! -${formatMoney(wager)}`);
      };
    } else {
      // Contestant answers
      const cKey = dom.ddContestantPicker.value;
      state.phase = 'dd-contestant';

      dom.statusText.textContent = 'Waiting for contestant response...';
      dom.statusText.className = 'reading';

      // Show correct/wrong for contestant
      show(dom.ddWagerArea);
      show(dom.ddResponse);
      dom.ddTime.textContent = '...';

      dom.ddCorrect.onclick = () => {
        clearTimers();
        addScore(cKey, wager);
        JeopardyAudio.correct();
        finishDailyDouble(`${state.contestants[['c1','c2','c3'].indexOf(cKey)]} correct! +${formatMoney(wager)}`);
      };

      dom.ddIncorrect.onclick = () => {
        clearTimers();
        addScore(cKey, -wager);
        JeopardyAudio.incorrect();
        finishDailyDouble(`${state.contestants[['c1','c2','c3'].indexOf(cKey)]} wrong! -${formatMoney(wager)}`);
      };
    }
  }

  function finishDailyDouble(message) {
    hide(dom.ddWagerArea);
    hide(dom.ddResponse);
    markClueUsed();
    dom.statusText.textContent = message;
    showNextClueButton('Next Clue');
    state.phase = 'result';
  }

  // ─── Final Jeopardy ──────────────────────────────────────────
  let fjStopMusic = null;

  function startFinalJeopardy() {
    clearTimers();
    state.phase = 'final-jeopardy';

    // Hide normal game elements
    hide($('#clue-selector'));
    hide($('#buzzer-area'));
    hide(dom.ddWagerArea);
    show(dom.finalArea);

    // Set max wagers
    dom.fjPlayerMax.textContent = Math.max(0, state.scores.player).toLocaleString();
    dom.fjPlayerWager.max = Math.max(0, state.scores.player);
    dom.fjPlayerWager.value = 0;

    // Build contestant wager inputs
    dom.fjContestantWagers.innerHTML = '';
    ['c1', 'c2', 'c3'].forEach((key, i) => {
      const div = document.createElement('div');
      div.className = 'fj-contestant-wager';
      div.innerHTML = `
        <span>${state.contestants[i]}</span>
        <label>$<input type="number" id="fj-wager-${key}" min="0" max="${Math.max(0, state.scores[key])}" value="0"></label>
        <span class="fj-max">(Max: $${Math.max(0, state.scores[key]).toLocaleString()})</span>
      `;
      dom.fjContestantWagers.appendChild(div);
    });

    hide(dom.fjTimerDisplay);
    hide(dom.fjResults);
    dom.fjStartTimer.style.display = '';
  }

  function startFinalTimer() {
    dom.fjStartTimer.style.display = 'none';
    show(dom.fjTimerDisplay);

    let remaining = 30;
    dom.fjTimerValue.textContent = remaining;

    // Start think music
    fjStopMusic = JeopardyAudio.finalJeopardyThink(30);

    state.timerInterval = setInterval(() => {
      remaining--;
      dom.fjTimerValue.textContent = Math.max(0, remaining);

      if (remaining <= 0) {
        clearInterval(state.timerInterval);
        if (fjStopMusic) { fjStopMusic(); fjStopMusic = null; }
        JeopardyAudio.timeUp();

        // Show result inputs
        showFinalResults();
      }
    }, 1000);
  }

  function showFinalResults() {
    show(dom.fjResults);
    dom.fjResultInputs.innerHTML = '';

    const players = [
      { key: 'player', name: state.playerName },
      { key: 'c1', name: state.contestants[0] },
      { key: 'c2', name: state.contestants[1] },
      { key: 'c3', name: state.contestants[2] },
    ];

    players.forEach(p => {
      const div = document.createElement('div');
      div.className = 'fj-result-row';
      div.innerHTML = `
        <span>${p.name}</span>
        <button class="fj-result-btn" data-key="${p.key}" data-correct="true">Correct</button>
        <button class="fj-result-btn" data-key="${p.key}" data-correct="false">Wrong</button>
      `;
      dom.fjResultInputs.appendChild(div);

      const btns = div.querySelectorAll('.fj-result-btn');
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          btns.forEach(b => { b.classList.remove('selected-correct', 'selected-wrong'); });
          btn.classList.add(btn.dataset.correct === 'true' ? 'selected-correct' : 'selected-wrong');
        });
      });
    });
  }

  function applyFinalResults() {
    const rows = dom.fjResultInputs.querySelectorAll('.fj-result-row');
    rows.forEach(row => {
      const key = row.querySelector('.fj-result-btn').dataset.key;
      const selected = row.querySelector('.selected-correct, .selected-wrong');
      if (!selected) return;

      const correct = selected.dataset.correct === 'true';
      let wager = 0;

      if (key === 'player') {
        wager = parseInt(dom.fjPlayerWager.value) || 0;
      } else {
        const input = $(`#fj-wager-${key}`);
        wager = input ? parseInt(input.value) || 0 : 0;
      }

      if (correct) {
        addScore(key, wager);
      } else {
        addScore(key, -wager);
      }
    });

    endGame();
  }

  // ─── End Game ─────────────────────────────────────────────────
  function endGame() {
    clearTimers();
    if (fjStopMusic) { fjStopMusic(); fjStopMusic = null; }

    const players = [
      { name: state.playerName, score: state.scores.player, isPlayer: true },
      { name: state.contestants[0], score: state.scores.c1 },
      { name: state.contestants[1], score: state.scores.c2 },
      { name: state.contestants[2], score: state.scores.c3 },
    ];

    players.sort((a, b) => b.score - a.score);

    dom.summaryScores.innerHTML = '';
    players.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'summary-card' + (i === 0 ? ' winner' : '');
      const rank = i === 0 ? 'Champion' : `${i + 1}${['st','nd','rd','th'][i] || 'th'} Place`;
      card.innerHTML = `
        <div class="rank">${rank}</div>
        <div class="name">${p.name}${p.isPlayer ? ' (You)' : ''}</div>
        <div class="final-score">${formatMoney(p.score)}</div>
      `;
      dom.summaryScores.appendChild(card);
    });

    showScreen(dom.summaryScreen);
  }

  // ─── Score Adjustment Modal ───────────────────────────────────
  let adjustTarget = null;

  function openAdjustModal(playerKey) {
    adjustTarget = playerKey;
    const names = { c1: state.contestants[0], c2: state.contestants[1], c3: state.contestants[2], player: state.playerName };
    dom.adjustName.textContent = names[playerKey];
    dom.adjustCurrent.textContent = state.scores[playerKey].toLocaleString();
    dom.adjustValue.value = state.scores[playerKey];
    show(dom.adjustModal);
  }

  function saveAdjustment() {
    if (!adjustTarget) return;
    state.scores[adjustTarget] = parseInt(dom.adjustValue.value) || 0;
    updateScores();
    hide(dom.adjustModal);
    adjustTarget = null;
  }

  // ─── Round Management ────────────────────────────────────────
  function toggleRound() {
    if (state.round === 1) {
      state.round = 2;
      dom.roundLabel.textContent = 'Double Jeopardy!';
      dom.btnRoundToggle.textContent = 'Switch to Jeopardy Round';
      state.clueCount = 0;
    } else {
      state.round = 1;
      dom.roundLabel.textContent = 'Jeopardy! Round';
      dom.btnRoundToggle.textContent = 'Switch to Double Jeopardy';
      state.clueCount = 0;
    }
    state.usedClues.clear();
    dom.clueCount.textContent = `Clue: 0 / 30`;
    resetForNextClue();
    buildValueGrid();
  }

  function syncTiming() {
    // Reset to idle, ready to align with the next clue read
    resetForNextClue();
    dom.statusText.textContent = 'Synced! Select next clue when host starts reading.';
    dom.statusText.className = 'open';
    setTimeout(() => {
      if (state.phase === 'idle') {
        dom.statusText.textContent = 'Select a clue to begin';
        dom.statusText.className = '';
      }
    }, 3000);
  }

  // ─── Start Game ──────────────────────────────────────────────
  function startGame() {
    state.playerName = dom.playerNameInput.value.trim() || 'You';
    state.contestants = dom.contestantInputs.map((inp, i) =>
      inp.value.trim() || `Contestant ${i + 1}`
    );

    state.scores = { player: 0, c1: 0, c2: 0, c3: 0 };
    state.round = 1;
    state.clueCount = 0;
    state.usedClues.clear();
    state.phase = 'idle';

    // Set names
    dom.scoreboard.player.name.textContent = state.playerName;
    dom.scoreboard.c1.name.textContent = state.contestants[0];
    dom.scoreboard.c2.name.textContent = state.contestants[1];
    dom.scoreboard.c3.name.textContent = state.contestants[2];

    updateScores();
    buildValueGrid();
    dom.roundLabel.textContent = 'Jeopardy! Round';
    dom.clueCount.textContent = 'Clue: 0 / 30';
    dom.btnRoundToggle.textContent = 'Switch to Double Jeopardy';

    show($('#clue-selector'));
    show($('#buzzer-area'));
    hide(dom.finalArea);
    resetForNextClue();

    showScreen(dom.gameScreen);

    // Init audio context on user gesture
    JeopardyAudio.buzzerOpen();
  }

  // ─── Event Bindings ───────────────────────────────────────────
  function bindEvents() {
    // Start game
    dom.startBtn.addEventListener('click', startGame);

    // Buzzer — button click
    dom.buzzerBtn.addEventListener('click', buzzIn);

    // Buzzer — spacebar
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && state.phase === 'open') {
        e.preventDefault();
        buzzIn();
      }
    });

    // Response buttons
    dom.btnCorrect.addEventListener('click', () => handlePlayerResponse(true));
    dom.btnIncorrect.addEventListener('click', () => handlePlayerResponse(false));

    // Contestant results
    dom.contestantBuzzedArea.querySelector('[data-action="contestant-correct"]')
      .addEventListener('click', () => handleContestantResult(true));
    dom.contestantBuzzedArea.querySelector('[data-action="contestant-wrong"]')
      .addEventListener('click', () => handleContestantResult(false));

    // Next clue
    dom.btnNextClue.addEventListener('click', resetForNextClue);

    // Daily Double
    dom.ddBtn.addEventListener('click', startDailyDouble);

    $$('.btn-dd-who').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.btn-dd-who').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ddWho = btn.dataset.who;
        if (ddWho === 'contestant') {
          show(dom.ddContestantSelect);
        } else {
          hide(dom.ddContestantSelect);
        }
      });
    });

    dom.ddSubmit.addEventListener('click', submitDailyDouble);

    // Score adjustments
    $$('[data-action="adjust"]').forEach(btn => {
      btn.addEventListener('click', () => openAdjustModal(btn.dataset.player));
    });

    // Add player score adjust
    dom.scoreboard.player.value.addEventListener('click', () => openAdjustModal('player'));

    dom.adjustSave.addEventListener('click', saveAdjustment);
    dom.adjustCancel.addEventListener('click', () => hide(dom.adjustModal));

    // Game controls
    dom.btnRoundToggle.addEventListener('click', toggleRound);
    dom.btnFinalJeopardy.addEventListener('click', startFinalJeopardy);
    dom.btnSync.addEventListener('click', syncTiming);
    dom.btnEndGame.addEventListener('click', endGame);

    // Final Jeopardy
    dom.fjStartTimer.addEventListener('click', startFinalTimer);
    dom.fjApply.addEventListener('click', applyFinalResults);

    // New game
    dom.btnNewGame.addEventListener('click', () => {
      showScreen(dom.setupScreen);
    });

    // Keyboard shortcut hint — show reading duration adjust with +/-
    document.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') {
        state.readingDuration = Math.min(15000, state.readingDuration + 500);
        dom.statusText.textContent = `Reading time: ${(state.readingDuration / 1000).toFixed(1)}s`;
      }
      if (e.key === '-' || e.key === '_') {
        state.readingDuration = Math.max(1000, state.readingDuration - 500);
        dom.statusText.textContent = `Reading time: ${(state.readingDuration / 1000).toFixed(1)}s`;
      }
    });
  }

  // ─── Init ─────────────────────────────────────────────────────
  bindEvents();
})();
