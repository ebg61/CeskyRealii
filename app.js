(() => {
  const state = {
    all: [],
    filtered: [],
    /** checkbox row indices that are checked (reliable; no string mismatch) */
    selectedIndices: new Set(),
    /** normCat(label) -> index in categoryLabels */
    normCatToIdx: null,
    current: null,
    answered: false,
    correctCount: 0,
    wrongCount: 0,
    pool: [],
    /** question ids answered incorrectly at least once */
    failedIds: new Set(),
    redoMode: false,
    /** null | 'main' | 'redo' — round finished; user picks retry wrong or quiz again */
    endScreen: null,
    /** quiz runs only after Start quiz */
    started: false,
    /** category title per checkbox index (avoids broken data-cat attributes) */
    categoryLabels: [],
  };

  const els = {
    catList: null,
    selectAll: null,
    selectNone: null,
    statCorrect: null,
    statTotal: null,
    statWrong: null,
    meta: null,
    text: null,
    answers: null,
    feedback: null,
    btnSubmit: null,
    btnNext: null,
    btnRedoFailed: null,
    btnExitRedo: null,
    btnQuizAgain: null,
    redoBanner: null,
    btnStartQuiz: null,
    main: null,
    loadOverlay: null,
  };

  function cacheDom() {
    els.catList = document.getElementById("cat-list");
    els.selectAll = document.getElementById("select-all");
    els.selectNone = document.getElementById("select-none");
    els.statCorrect = document.getElementById("stat-correct");
    els.statTotal = document.getElementById("stat-total");
    els.statWrong = document.getElementById("stat-wrong");
    els.meta = document.getElementById("question-meta");
    els.text = document.getElementById("question-text");
    els.answers = document.getElementById("answers");
    els.feedback = document.getElementById("feedback");
    els.btnSubmit = document.getElementById("btn-submit");
    els.btnNext = document.getElementById("btn-next");
    els.btnRedoFailed = document.getElementById("btn-redo-failed");
    els.btnExitRedo = document.getElementById("btn-exit-redo");
    els.btnQuizAgain = document.getElementById("btn-quiz-again");
    els.redoBanner = document.getElementById("redo-banner");
    els.btnStartQuiz = document.getElementById("btn-start-quiz");
    els.main = document.getElementById("quiz-main");
    els.loadOverlay = document.getElementById("load-overlay");
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Same text as in questions.json (handles odd spaces / NBSP / Unicode) */
  function normCat(s) {
    if (s == null || s === "") return "";
    try {
      return String(s)
        .normalize("NFC")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      return String(s)
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  function categoriesFromQuestions(qs) {
    const set = new Set();
    for (const q of qs) {
      const c = normCat(q.category);
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => {
      const na = parseInt(a, 10) || 0;
      const nb = parseInt(b, 10) || 0;
      return na - nb || a.localeCompare(b, "cs");
    });
  }

  function failedInFilter() {
    return state.filtered.filter((q) => state.failedIds.has(q.id));
  }

  function setCategoryLocked(locked) {
    els.catList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.disabled = locked;
    });
    els.selectAll.disabled = locked;
    els.selectNone.disabled = locked;
  }

  /** Read checkbox row index: data-idx, dataset.idx, or value fallback */
  function indexFromCheckbox(cb) {
    let idx = parseInt(String(cb.getAttribute("data-idx") ?? ""), 10);
    if (Number.isNaN(idx)) idx = parseInt(String(cb.dataset?.idx ?? ""), 10);
    if (Number.isNaN(idx)) idx = parseInt(String(cb.value ?? ""), 10);
    if (Number.isNaN(idx) || idx < 0) return -1;
    return idx;
  }

  /** How many category checkboxes are checked (DOM — source of truth for enabling Start) */
  function countCheckedCategories() {
    if (!els.catList) return 0;
    let n = 0;
    els.catList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      if (cb.checked) n += 1;
    });
    return n;
  }

  function syncSelectedIndicesFromDom() {
    state.selectedIndices.clear();
    if (!els.catList || !state.categoryLabels.length) return;
    els.catList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      if (!cb.checked) return;
      const idx = indexFromCheckbox(cb);
      if (idx >= 0 && idx < state.categoryLabels.length) state.selectedIndices.add(idx);
    });
  }

  function getStartButton() {
    return document.getElementById("btn-start-quiz");
  }

  function syncStartButtons() {
    const btn = getStartButton();
    if (!btn) return;
    els.btnStartQuiz = btn;
    btn.hidden = false;
    btn.removeAttribute("hidden");
    btn.disabled = false;
    if (state.started) {
      btn.textContent = "End quiz";
      btn.className = "secondary-btn start-btn start-btn--end";
      btn.setAttribute("aria-label", "End quiz and return to category selection");
    } else {
      btn.textContent = "Start quiz";
      btn.className = "primary start-btn";
      const nChecked = countCheckedCategories();
      btn.classList.toggle("start-btn--needs-cats", nChecked === 0);
      btn.setAttribute("aria-label", "Start quiz");
    }
  }

  function computeFiltered() {
    syncSelectedIndicesFromDom();
    const map = state.normCatToIdx;
    if (!map || !state.all.length) {
      state.filtered = [];
      return;
    }
    state.filtered = state.all.filter((q) => {
      const idx = map.get(normCat(q.category));
      return idx !== undefined && state.selectedIndices.has(idx);
    });
  }

  function updateFilter() {
    computeFiltered();
    state.statTotal.textContent = String(state.filtered.length);

    if (!state.started) {
      rebuildPool();
      updateRedoUi();
      renderStartScreen();
      return;
    }

    if (state.filtered.length === 0) {
      state.current = null;
      exitRedoMode(false);
      updateRedoUi();
      renderEmpty();
      return;
    }

    if (state.endScreen) {
      updateRedoUi();
      return;
    }

    rebuildPool();
    updateRedoUi();

    if (state.redoMode && failedInFilter().length === 0) {
      exitRedoMode(false);
      rebuildPool();
      updateRedoUi();
    }
    pickNext();
  }

  function startQuiz() {
    computeFiltered();
    if (els.statTotal) els.statTotal.textContent = String(state.filtered.length);
    if (state.filtered.length === 0) {
      els.feedback.textContent = "Select at least one category first.";
      els.feedback.className = "feedback bad";
      return;
    }
    state.started = true;
    state.endScreen = null;
    state.correctCount = 0;
    state.wrongCount = 0;
    state.failedIds.clear();
    state.redoMode = false;
    els.statCorrect.textContent = "0";
    els.statWrong.textContent = "0";
    setCategoryLocked(true);
    syncStartButtons();
    rebuildPool();
    updateRedoUi();
    els.redoBanner.hidden = true;
    els.feedback.textContent = "";
    els.feedback.className = "feedback";
    pickNext();
  }

  function stopQuiz() {
    state.started = false;
    state.endScreen = null;
    state.current = null;
    state.correctCount = 0;
    state.wrongCount = 0;
    state.failedIds.clear();
    state.redoMode = false;
    els.statCorrect.textContent = "0";
    els.statWrong.textContent = "0";
    exitRedoMode(false);
    setCategoryLocked(false);
    updateFilter();
    syncStartButtons();
    requestAnimationFrame(() => {
      syncStartButtons();
      document.querySelector(".cat-actions")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      getStartButton()?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function rebuildPool() {
    if (state.redoMode) {
      const ids = failedInFilter().map((q) => q.id);
      state.pool = shuffle(ids);
    } else {
      state.pool = shuffle(state.filtered.map((q) => q.id));
    }
  }

  function updateRedoUi() {
    const n = failedInFilter().length;
    const onEnd = state.endScreen === "main" || state.endScreen === "redo";

    els.btnRedoFailed.textContent = n > 0 ? `Retry wrong (${n})` : "Retry wrong";
    els.btnRedoFailed.hidden = !state.started || !onEnd;
    els.btnRedoFailed.disabled = onEnd && n === 0;

    if (els.btnQuizAgain) {
      els.btnQuizAgain.hidden = !state.started || !onEnd;
    }

    els.redoBanner.hidden = !state.redoMode || !state.started || onEnd;
    els.btnExitRedo.hidden = !state.redoMode || !state.started || onEnd;
  }

  function exitRedoMode(reshuffle) {
    state.redoMode = false;
    if (reshuffle) rebuildPool();
    updateRedoUi();
  }

  function enterRedoMode() {
    if (!state.started || failedInFilter().length === 0) return;
    state.endScreen = null;
    state.redoMode = true;
    rebuildPool();
    updateRedoUi();
    pickNext();
  }

  function restartFullQuiz() {
    if (!state.started) return;
    state.endScreen = null;
    state.redoMode = false;
    state.correctCount = 0;
    state.wrongCount = 0;
    state.failedIds.clear();
    els.statCorrect.textContent = "0";
    els.statWrong.textContent = "0";
    rebuildPool();
    updateRedoUi();
    els.redoBanner.hidden = true;
    pickNext();
  }

  function renderMainRoundComplete(fromRedoExit) {
    state.current = null;
    state.answered = false;
    state.endScreen = "main";
    els.meta.textContent = "";
    els.text.textContent = fromRedoExit
      ? "Wrong-answer practice ended. You can review mistakes again or restart the full quiz on the same categories."
      : `You have completed all ${state.filtered.length} question(s) in your selected categories — each once this round.`;
    els.answers.innerHTML = "";
    els.feedback.textContent = `Correct: ${state.correctCount} · Wrong: ${state.wrongCount}`;
    els.feedback.className = "feedback";
    els.btnSubmit.disabled = true;
    els.btnNext.disabled = true;
    if (els.btnQuizAgain) els.btnQuizAgain.hidden = false;
    updateRedoUi();
  }

  function renderRedoRoundComplete() {
    state.current = null;
    state.answered = false;
    state.endScreen = "redo";
    const n = failedInFilter().length;
    els.meta.textContent = "";
    els.text.textContent =
      n === 0
        ? "You cleared every mistake in this review round."
        : "You have reviewed each wrong answer once in this round.";
    els.answers.innerHTML = "";
    els.feedback.textContent =
      n > 0
        ? `Still wrong: ${n}. Retry those again or start a full new round.`
        : "No wrong answers left in this filter.";
    els.feedback.className = "feedback";
    els.btnSubmit.disabled = true;
    els.btnNext.disabled = true;
    if (els.btnQuizAgain) els.btnQuizAgain.hidden = false;
    updateRedoUi();
  }

  function renderStartScreen() {
    state.current = null;
    els.meta.textContent = "";
    els.text.textContent =
      state.filtered.length === 0
        ? "Select at least one category."
        : "Choose one or more categories, then press Start quiz.";
    els.answers.innerHTML = "";
    els.feedback.textContent = "";
    els.feedback.className = "feedback";
    els.btnSubmit.disabled = true;
    els.btnNext.disabled = true;
    els.btnRedoFailed.disabled = true;
    els.redoBanner.hidden = true;
    if (els.btnQuizAgain) els.btnQuizAgain.hidden = true;
    syncStartButtons();
  }

  function renderEmpty() {
    els.meta.textContent = "";
    if (state.redoMode && failedInFilter().length === 0) {
      els.text.textContent =
        "No wrong answers in the selected categories. Try another filter or end practice.";
    } else {
      els.text.textContent =
        state.all.length === 0
          ? "No data loaded."
          : "Select at least one category.";
    }
    els.answers.innerHTML = "";
    els.feedback.textContent = "";
    els.feedback.className = "feedback";
    els.btnSubmit.disabled = true;
    els.btnNext.disabled = true;
    if (els.btnQuizAgain) els.btnQuizAgain.hidden = true;
  }

  function pickNext() {
    if (!state.started || state.endScreen) return;

    if (state.pool.length === 0) {
      if (state.redoMode) {
        exitRedoMode(false);
        renderRedoRoundComplete();
      } else {
        renderMainRoundComplete(false);
      }
      return;
    }

    state.answered = false;
    els.feedback.textContent = "";
    els.feedback.className = "feedback";
    els.btnSubmit.disabled = false;
    els.btnNext.disabled = true;
    if (els.btnQuizAgain) els.btnQuizAgain.hidden = true;

    const id = state.pool.pop();
    state.current = state.all.find((q) => q.id === id) || null;
    if (!state.current) {
      pickNext();
      return;
    }
    renderQuestion();
    updateRedoUi();
  }

  function renderQuestion() {
    const q = state.current;
    els.meta.textContent = [q.major, q.category].filter(Boolean).join(" · ");
    els.text.textContent = q.question;
    els.answers.innerHTML = "";
    const opts = q.options.slice().sort((a, b) => a.letter.localeCompare(b.letter));
    for (const o of opts) {
      const id = `opt-${o.letter}`;
      const label = document.createElement("label");
      label.className = "answer";
      label.innerHTML = `<input type="radio" name="answer" value="${o.letter}" id="${id}" /> <span><strong>${o.letter})</strong> ${escapeHtml(o.text)}</span>`;
      els.answers.appendChild(label);
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function onSubmit() {
    if (!state.current || state.answered) return;
    const picked = els.answers.querySelector('input[name="answer"]:checked');
    if (!picked) return;
    state.answered = true;
    const letter = picked.value;
    const ok = letter === state.current.correct;
    if (ok) {
      state.correctCount += 1;
      state.failedIds.delete(state.current.id);
    } else {
      state.wrongCount += 1;
      state.failedIds.add(state.current.id);
    }
    els.statCorrect.textContent = String(state.correctCount);
    els.statWrong.textContent = String(state.wrongCount);
    updateRedoUi();

    const labels = els.answers.querySelectorAll(".answer");
    labels.forEach((lab) => {
      const inp = lab.querySelector("input");
      const L = inp.value;
      lab.classList.remove("correct-pick", "wrong-pick", "reveal-correct");
      if (L === state.current.correct) lab.classList.add("reveal-correct");
      if (L === letter && L === state.current.correct) lab.classList.add("correct-pick");
      if (L === letter && L !== state.current.correct) lab.classList.add("wrong-pick");
      inp.disabled = true;
    });

    els.feedback.className = "feedback " + (ok ? "ok" : "bad");
    els.feedback.textContent = ok ? "Correct." : `Wrong. Correct answer: ${state.current.correct}.`;
    els.btnSubmit.disabled = true;
    els.btnNext.disabled = false;
  }

  function buildCategoryUI(cats) {
    els.catList.innerHTML = "";
    cats.forEach((c, index) => {
      const id = `cat-row-${index}`;
      const label = document.createElement("label");
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.id = id;
      inp.checked = false;
      inp.setAttribute("data-idx", String(index));
      inp.value = String(index);
      inp.setAttribute("autocomplete", "off");
      const span = document.createElement("span");
      span.textContent = ` ${c}`;
      label.appendChild(inp);
      label.appendChild(span);
      els.catList.appendChild(label);
      inp.addEventListener("change", () => updateFilter());
    });
  }

  function loadQuizData() {
    if (
      typeof window.CZ_QUIZ_DATA !== "undefined" &&
      window.CZ_QUIZ_DATA &&
      Array.isArray(window.CZ_QUIZ_DATA.questions) &&
      window.CZ_QUIZ_DATA.questions.length > 0
    ) {
      return window.CZ_QUIZ_DATA;
    }
    return null;
  }

  async function init() {
    try {
      let data = null;
      try {
        const res = await fetch("questions.json", { cache: "no-store" });
        if (res.ok) data = await res.json();
      } catch (_) {
        /* file:// or network blocked */
      }
      if (!data) data = loadQuizData();
      if (!data || !Array.isArray(data.questions)) throw new Error("no data");
      state.all = data.questions || [];
      state.categoryLabels = categoriesFromQuestions(state.all);
      state.normCatToIdx = new Map();
      state.categoryLabels.forEach((label, i) => {
        state.normCatToIdx.set(normCat(label), i);
      });
      buildCategoryUI(state.categoryLabels);
      document.body.classList.add("app-ready");
      els.statCorrect.textContent = "0";
      els.statWrong.textContent = "0";
      state.failedIds.clear();
      state.redoMode = false;
      state.endScreen = null;
      state.started = false;
      updateRedoUi();
      updateFilter();
    } catch (e) {
      if (els.loadOverlay) {
        const msg = els.loadOverlay.querySelector(".load-overlay__text");
        if (msg) {
          msg.textContent =
            "Could not load questions. Include questions.js (or run a local server and use questions.json).";
        }
        els.loadOverlay.classList.add("load-overlay--error");
      }
    }
  }

  function bindEvents() {
  els.selectAll.addEventListener("click", () => {
    els.catList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = true;
    });
    updateFilter();
  });

  els.selectNone.addEventListener("click", () => {
    els.catList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = false;
    });
    updateFilter();
  });

  const btnStart = getStartButton();
  if (btnStart) {
    btnStart.addEventListener("click", (e) => {
      e.preventDefault();
      if (state.started) stopQuiz();
      else startQuiz();
    });
  }

  els.btnSubmit.addEventListener("click", onSubmit);
  els.btnNext.addEventListener("click", () => pickNext());
  els.btnRedoFailed.addEventListener("click", () => enterRedoMode());
  if (els.btnQuizAgain) {
    els.btnQuizAgain.addEventListener("click", () => restartFullQuiz());
  }
  els.btnExitRedo.addEventListener("click", () => {
    exitRedoMode(false);
    state.pool = [];
    renderMainRoundComplete(true);
  });
  }


  function boot() {
    cacheDom();
    if (!getStartButton() || !els.catList || !els.main) {
      const ov = document.getElementById("load-overlay");
      if (ov) {
        const t = ov.querySelector(".load-overlay__text");
        if (t) t.textContent = "Page failed to initialise. Check the console.";
        ov.classList.add("load-overlay--error");
      }
      return;
    }
    bindEvents();
    init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
