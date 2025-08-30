/* Wordle-ish game logic (improved win message & reveal timing) */
(() => {
  // ===== Utilities =====
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // Animation timing & input lock
  const REVEAL_STEP_MS = 220;     // per tile flip delay
  const REVEAL_FINISH_MS = 1200;  // total reveal duration buffer
  let inputLocked = false;

  const TZ = "Asia/Manila";
  const todayLocal = () => {
    const now = new Date();
    // Normalize to local date in Asia/Manila
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = fmt.formatToParts(now).reduce((acc, p) => (acc[p.type]=p.value, acc), {});
    return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00${offsetForTZ(TZ)}`);
  };
  function offsetForTZ(tz) {
    const d = new Date();
    const loc = new Date(d.toLocaleString('en-US', { timeZone: tz }));
    const offsetMinutes = (loc - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60000;
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes);
    const hh = String(Math.floor(abs/60)).padStart(2, "0");
    const mm = String(abs%60).padStart(2, "0");
    return `${sign}${hh}:${mm}`;
  }

  const STORAGE_KEY = "wordleish-v1";
  const loadState = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  };
  const saveState = (s) => localStorage.setItem(STORAGE_KEY, JSON.stringify(s));

  const state = Object.assign({
    dark: window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches,
    contrast: false,
    hard: false,
    stats: { played:0, wins:0, streak:0, maxStreak:0, dist:[0,0,0,0,0,0,0] },
    history: {} // by solution + date seed
  }, loadState());

  // apply themes
  document.documentElement.classList.toggle('dark', !!state.dark);
  document.documentElement.classList.toggle('contrast', !!state.contrast);

  // ===== Words / Daily seed =====
  const ANSWERS = window.WORDLEISH_ANSWERS || [
  "ARISE","TEACH","LIGHT","SHARE","CRANE","PLANT","BRAVE","QUICK","SWEET","SMILE",
  "TRACK","CLOUD","MANGO","NERVE","DRINK","SUGAR","METAL","RIVER","ROUTE","SCORE",
  "EARTH","HEART","POINT","SOUND","NINJA","PARTY","FAITH","CHAIR","STONE","TIGER",
  "PANDA","WATER","HONEY","PIXEL","FRAME","PEACH","BREAD","PHONE","CABLE","ULTRA",
  "ALPHA","NORTH","SOUTH","EASTS","WESTS","OTHER","WORDS","LOREM","IPSUM","ABACK", "ABASE", "ABBEY", "ABBOT", "ABIDE", "ABLED", "ABOUT", "ABOVE", "ABUSE",
"ACORN", "ACRID", "ACTOR", "ACUTE", "ADAGE", "ADAPT", "ADEPT", "ADMIN", "ADMIT", "ADOPT",
"ADULT", "AFFIX", "AGAIN", "AGENT", "AGILE", "AGING", "AGREE", "AHEAD", "AISLE", "ALARM",
"ALBUM", "ALERT", "ALIEN", "ALIGN", "ALIKE", "ALIVE", "ALLOY", "ALLOW", "ALONE", "ALONG",
"ALTAR", "ALTER", "AMAZE", "AMBER", "AMPLE", "ANGEL", "ANGER", "ANGLE", "ANGRY", "APART",
"APPLE", "APPLY", "APRON", "ARENA", "ARGUE", "ARISE", "ARMOR", "AROSE", "ARRAY", "ARROW",
"ASIDE", "ASSET", "AUDIO", "AUDIT", "AVOID", "AWAKE", "AWARD", "AWARE", "AWFUL", "AXIOM",
"BACON", "BADGE", "BAGEL", "BAKER", "BALMY", "BANJO", "BASIC", "BATCH", "BEACH", "BEARD",
"BEAST", "BEGIN", "BEING", "BELLY", "BELOW", "BENCH", "BERRY", "BIRTH", "BLACK", "BLADE",
"BLAME", "BLANK", "BLAST", "BLAZE", "BLEAK", "BLEND", "BLESS", "BLIND", "BLINK", "BLOCK",
"BLOOD", "BLOOM", "BLOWN", "BOARD", "BOAST", "BONUS", "BOOST", "BOOTH", "BOUND", "BRAIN",
"BRAKE", "BRAND", "BRAVE", "BREAD", "BREAK", "BREED", "BRICK", "BRIDE", "BRIEF", "BRING",
"BROAD", "BROKE", "BROWN", "BRUSH", "BUDDY", "BUILD", "BUILT", "BUNCH", "BURST", "BUYER",
"CABIN", "CABLE", "CAMEL", "CANDY", "CANOE", "CARRY", "CARVE", "CAUSE", "CEASE", "CHAIN",
"CHAIR", "CHANT", "CHAOS", "CHARM", "CHART", "CHASE", "CHEAP", "CHEAT", "CHECK", "CHEEK",
"CHEER", "CHESS", "CHEST", "CHIEF", "CHILD", "CHILL", "CHINA", "CHOIR", "CHOSE", "CHUNK",
"CIGAR", "CLAIM", "CLASS", "CLEAN", "CLEAR", "CLERK", "CLICK", "CLIFF", "CLIMB", "CLOCK",
"CLOSE", "CLOTH", "CLOUD", "COACH", "COAST", "COLOR", "COMIC", "CORAL", "COUCH", "COULD",
"COUNT", "COURT", "COVER", "CRACK", "CRAFT", "CRASH", "CRAZY", "CREAM", "CREEK", "CREST",
"CRIME", "CRISP", "CROSS", "CROWD", "CROWN", "CRUSH", "CURVE", "CYCLE"
  ].filter(w => w.length === 5);

  const VALIDATE_STRICT = false; // set true if you later supply a large dictionary
  const VALID_SET = new Set(ANSWERS);

  function dailyIndex() {
    const epoch = new Date("2021-06-19T00:00:00+08:00"); // first Wordle-like date
    const t0 = epoch.getTime();
    const tn = todayLocal().getTime();
    const diffDays = Math.floor((tn - t0) / (24*3600*1000));
    return ((diffDays % ANSWERS.length) + ANSWERS.length) % ANSWERS.length;
  }

  const solution = ANSWERS[dailyIndex()];
  const seedId = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, dateStyle: 'short' }).format(todayLocal()) + ":" + solution;
  const past = state.history[seedId] || { rows: [], done:false, win:false };
  // --- Hint fetch + lightweight cache (uses dictionaryapi.dev) ---
const HINT_CACHE_KEY = "wordle-hints-v1";

function getHintCache() {
  try { return JSON.parse(localStorage.getItem(HINT_CACHE_KEY) || "{}"); }
  catch (e) { return {}; }
}
function setHintCache(word, hint) {
  try {
    const c = getHintCache();
    c[word] = hint;
    localStorage.setItem(HINT_CACHE_KEY, JSON.stringify(c));
  } catch (e) { /* ignore */ }
}

/**
 * Load a short hint (first sentence) for `word` and put it into #hint.
 * Uses dictionaryapi.dev (no API key). Caches the result in localStorage.
 */
async function loadHint(word) {
  const el = document.getElementById("hint");
  if (!el) return;
  if (!word) { el.textContent = ""; return; }

  const cache = getHintCache();
  if (cache[word]) {
    el.textContent = cache[word];
    return;
  }

  el.textContent = "Loading hint…";
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`);
    if (!res.ok) throw new Error("no entry");
    const data = await res.json();
    const def = data?.[0]?.meanings?.[0]?.definitions?.[0]?.definition;
    if (def) {
      // Use only the first sentence (so the hint is short)
      const first = def.split(/[.?!]/)[0].trim();
      const hintText = first ? (first.charAt(0).toUpperCase() + first.slice(1)) : "";
      el.textContent = hintText;
      setHintCache(word, hintText);
    } else {
      el.textContent = ""; // or "No hint available."
      setHintCache(word, "");
    }
  } catch (err) {
    console.warn("Hint fetch failed", err);
    el.textContent = ""; // silent failure so UI isn't noisy
  }
}

// Call it for the daily word:
loadHint(solution);


  // ===== DOM build =====
  const board = $("#board");
  board.innerHTML = "";
  for (let r=0; r<6; r++) {
    const row = document.createElement("div");
    row.className = "row";
    for (let c=0; c<5; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.setAttribute("role","gridcell");
      tile.setAttribute("aria-label", `Row ${r+1} column ${c+1}`);
      row.appendChild(tile);
    }
    board.appendChild(row);
  }

  // Keyboard
  const layout = ["QWERTYUIOP","ASDFGHJKL","⌫ZXCVBNM⏎"];
  const keyboard = $("#keyboard");
  layout.forEach((line, i) => {
    const row = document.createElement("div");
    row.className = "krow";
    [...line].forEach(ch => {
      const key = document.createElement("button");
      key.className = "key";
      key.dataset.key = ch;
      key.textContent = ch === "⌫" ? "Back" : (ch === "⏎" ? "Enter" : ch);
      key.setAttribute("aria-label", key.textContent);
      if (ch === "⌫" || ch === "⏎") key.classList.add("wide");
      row.appendChild(key);
    });
    keyboard.appendChild(row);
  });

  // ===== Game state =====
  let rowIndex = past.rows.length;
  let colIndex = past.rows[rowIndex]?.length || 0;
  let grid = Array.from({length:6}, (_, r) => Array.from({length:5}, (_, c) => (past.rows[r]?.[c] || "")));
  let locks = Array(5).fill(null); // hard mode: required letters by position
  let known = {}; // hard mode: known present letters with min count

  function render() {
    $$(".row").forEach((rowEl, r) => {
      const word = grid[r].join("");
      [...rowEl.children].forEach((tile, c) => {
        const ch = grid[r][c] || "";
        tile.textContent = ch;
        tile.classList.toggle("filled", !!ch);
      });
    });
  }
  render();

  // restore evaluated rows if any
  if (past.rows.length) {
    past.rows.forEach((word, r) => revealRow(word, r, false));
    if (past.done) {
      lockGame(past.win);
      if (past.win) setTimeout(()=>toast("Already solved today’s word ✅"), 250);
    }
  }

  function setThemeHandlers() {
    $("#darkMode").checked = !!state.dark;
    $("#highContrast").checked = !!state.contrast;
    $("#hardMode").checked = !!state.hard;
    $("#darkMode").addEventListener("change", e => {
      state.dark = e.target.checked; saveState(state);
      document.documentElement.classList.toggle('dark', state.dark);
    });
    $("#highContrast").addEventListener("change", e => {
      state.contrast = e.target.checked; saveState(state);
      document.documentElement.classList.toggle('contrast', state.contrast);
    });
    $("#hardMode").addEventListener("change", e => {
      state.hard = e.target.checked; saveState(state);
      toast(state.hard ? "Hard mode on" : "Hard mode off");
    });
  }
  setThemeHandlers();

  // dialogs
  $("#btn-help").addEventListener("click", () => $("#helpDialog").showModal());
  $("#btn-stats").addEventListener("click", () => { updateStats(); $("#statsDialog").showModal(); });
  $("#btn-settings").addEventListener("click", () => $("#settingsDialog").showModal());

  // input handlers
  keyboard.addEventListener("click", (e) => {
    const key = e.target.closest(".key"); if (!key) return;
    handleKey(key.dataset.key);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Backspace") handleKey("⌫");
    else if (e.key === "Enter") handleKey("⏎");
    else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
  });

  function handleKey(k) {
    if (inputLocked) return;
    if (past.done) return;
    if (k === "⌫") {
      if (colIndex>0) {
        colIndex--; grid[rowIndex][colIndex] = "";
        render();
      }
      return;
    }
    if (k === "⏎") {
      submitRow();
      return;
    }
    if (/^[A-Z]$/.test(k) && colIndex < 5) {
      grid[rowIndex][colIndex++] = k;
      const tile = $$(".row")[rowIndex].children[colIndex-1];
      tile.classList.add("pop");
      setTimeout(()=>tile.classList.remove("pop"),120);
      render();
    }
  }

  function submitRow() {
    if (inputLocked) return;
    inputLocked = true;

    const word = grid[rowIndex].join("");
    if (word.length < 5) { shakeRow(rowIndex); toast("Not enough letters"); inputLocked = false; return; }
    if (VALIDATE_STRICT && !VALID_SET.has(word)) { shakeRow(rowIndex); toast("Not in word list"); inputLocked = false; return; }

    if (state.hard && rowIndex>0) {
      // enforce known hints
      for (let i=0;i<5;i++) {
        if (locks[i] && word[i] !== locks[i]) {
          shakeRow(rowIndex); toast("Hard mode: keep revealed letters"); inputLocked = false;
          return;
        }
      }
      for (let ch in known) {
        const count = [...word].filter(c => c===ch).length;
        if (count < known[ch]) { shakeRow(rowIndex); toast(`Hard: include ${ch}`); inputLocked = false; return; }
      }
    }

    revealRow(word, rowIndex, true);
    past.rows[rowIndex] = word;
    saveProgress();

    if (word === solution) {
      setTimeout(() => endGame(true, rowIndex + 1), REVEAL_FINISH_MS);
    } else if (rowIndex === 5) {
      setTimeout(() => endGame(false, 6), REVEAL_FINISH_MS);
    } else {
      setTimeout(() => { inputLocked = false; rowIndex++; colIndex=0; }, REVEAL_FINISH_MS);
    }
  }

  function computeFeedback(guess, target) {
    // returns array: 'correct' | 'present' | 'absent'
    const res = Array(5).fill('absent');
    const remaining = {};
    // first pass: mark corrects and count remaining letters
    for (let i=0;i<5;i++) {
      if (guess[i] === target[i]) {
        res[i] = 'correct';
      } else {
        remaining[target[i]] = (remaining[target[i]]||0) + 1;
      }
    }
    // second pass: present
    for (let i=0;i<5;i++) {
      if (res[i] === 'correct') continue;
      const ch = guess[i];
      if (remaining[ch] > 0) {
        res[i] = 'present';
        remaining[ch]--;
      }
    }
    return res;
  }

  function revealRow(word, r, animate) {
    const rowEl = $$(".row")[r];
    const fb = computeFeedback(word, solution);
    // update hard mode hints
    fb.forEach((f, i) => {
      if (f === 'correct') locks[i] = word[i];
      if (f !== 'absent') known[word[i]] = Math.max(known[word[i]]||0, 1);
    });
    [...rowEl.children].forEach((tile, i) => {
      const status = fb[i];
      setTimeout(() => {
        tile.classList.add("flip");
        setTimeout(() => {
          tile.classList.remove("flip");
          tile.classList.add(status);
        }, 250);
      }, animate ? i*REVEAL_STEP_MS : 0);
    });
    // keyboard status
    for (let i=0;i<5;i++) {
      const ch = word[i];
      const key = keyboard.querySelector(`[data-key="${ch}"]`);
      if (!key) continue;
      const prev = key.dataset.status;
      const rank = { absent:0, present:1, correct:2 };
      if (!prev || rank[fb[i]] > rank[prev]) {
        key.dataset.status = fb[i];
        key.classList.remove("status-absent","status-present","status-correct");
        key.classList.add(`status-${fb[i]}`);
      }
    }
  }

  function shakeRow(r) {
    const rowEl = $$(".row")[r];
    rowEl.querySelectorAll(".tile").forEach(t => {
      t.classList.add("shake");
      setTimeout(()=>t.classList.remove("shake"), 360);
    });
  }

  function toast(msg, ms=1100) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(()=>el.classList.remove("show"), ms);
  }

  function endGame(win, tries) {
    past.done = true; past.win = !!win;
    lockGame(win);
    if (win) {
      toast(`Correct! Solved in ${tries}/6 🎉`, 1500);
    } else {
      toast(`The word was ${solution}`, 1800);
    }
    // update stats
    state.stats.played += 1;
    if (win) {
      state.stats.wins += 1;
      state.stats.streak += 1;
      state.stats.maxStreak = Math.max(state.stats.maxStreak, state.stats.streak);
      const t = tries || (rowIndex+1);
      state.stats.dist[t] = (state.stats.dist[t]||0) + 1;
      setTimeout(()=>{ share(t); }, 1050);
    } else {
      state.stats.streak = 0;
    }
    saveState(state);
    saveProgress();
    setTimeout(()=>{ updateStats(); $("#statsDialog").showModal(); }, 1200);
    inputLocked = false;
  }

  function lockGame(win) {
    // disable keyboard
    $$("#keyboard .key").forEach(k => k.disabled = true);
  }

  function saveProgress() {
    state.history[seedId] = past;
    saveState(state);
  }

  function updateStats() {
    const s = state.stats;
    const pct = s.played ? Math.round(100*s.wins/s.played) : 0;
    $("#stats").innerHTML = `
      <div class="statgrid">
        <div><div class="num">${s.played}</div><div class="lab">Played</div></div>
        <div><div class="num">${pct}</div><div class="lab">Win %</div></div>
        <div><div class="num">${s.streak}</div><div class="lab">Streak</div></div>
        <div><div class="num">${s.maxStreak}</div><div class="lab">Max Streak</div></div>
      </div>
      <h3>Guess Distribution</h3>
      <div class="bars">
        ${[1,2,3,4,5,6].map(i => {
          const v = s.dist[i]||0;
          const max = Math.max(...s.dist.slice(1),1);
          const w = Math.max(8, Math.round(240 * v / max));
          return `<div class="bar"><span class="i">${i}</span><span class="b" style="width:${w}px">${v}</span></div>`;
        }).join("")}
      </div>
      <button id="shareBtn">Share</button>
    `;
    $("#shareBtn").addEventListener("click", () => {
      const tries = past.win ? (rowIndex+1) : "X";
      share(tries);
    });
  }

  function share(tries) {
    const rows = past.rows.length;
    const lines = past.rows.map(w => {
      const fb = computeFeedback(w, solution);
      return fb.map(s => s==='correct'?'🟩':s==='present'?'🟨':'⬛').join('');
    }).join('\n');
    const idx = dailyIndex();
    const header = `Wordle-ish ${idx} ${tries}/6`;
    const text = `${header}\n${lines}`;
    if (navigator.share) {
      navigator.share({ text });
    } else {
      navigator.clipboard.writeText(text);
      toast("Result copied to clipboard");
    }
  }

  // expose for console debugging
  window._wordleish = { solution, dailyIndex: dailyIndex() };

})();
