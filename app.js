/* ЕГЭ по Мелстрою — main app logic */
(function () {
  "use strict";

  /** @type {Array<{file:string,label:string}>} */
  const MEMES = window.MEMES || [];
  const POOL_SIZE = MEMES.length;
  const QUESTIONS_PER_GAME = Math.min(50, POOL_SIZE);
  const STORAGE_KEY = "ege_melstroy_history_v1";

  // All distinct answer labels. Memes that share a label (e.g. files
  // "аааааа.png" and "аааааа2.png") collapse onto a single label, so we
  // never end up with two duplicate options inside the same question.
  const ALL_LABELS = (function () {
    const set = new Set();
    MEMES.forEach((m) => set.add(m.label));
    return Array.from(set);
  })();

  // ---------------------------------------------------------------
  // Utility helpers
  // ---------------------------------------------------------------

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pickDistractorLabels(correctLabel, n) {
    const pool = ALL_LABELS.filter((lbl) => lbl !== correctLabel);
    return shuffle(pool).slice(0, n);
  }

  function imageUrl(file) {
    return "images/" + encodeURIComponent(file) + ".png";
  }

  // ---------------------------------------------------------------
  // Image preloading
  // ---------------------------------------------------------------
  // Decoded <img> elements are cached in the browser. Re-using a cached
  // element (or its URL) skips the network + decode delay on each
  // question render.
  const preloaded = new Map();

  function preloadAll() {
    MEMES.forEach((m) => {
      if (preloaded.has(m.file)) return;
      const img = new Image();
      img.decoding = "async";
      img.src = imageUrl(m.file);
      if (img.decode) {
        img.decode().catch(() => {
          /* ignore — fallback to lazy decode on first render */
        });
      }
      preloaded.set(m.file, img);
    });
  }

  function scoreFor(timeMs, correct) {
    if (!correct) return 0;
    const t = timeMs / 1000;
    if (t <= 3) return 2;
    const v = 2 - (t - 3) / 10;
    return v > 1 ? v : 1;
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    return (
      pad(d.getDate()) +
      "." +
      pad(d.getMonth() + 1) +
      "." +
      d.getFullYear() +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      // ignore quota errors
    }
  }

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------

  /**
   * @type {Array<{
   *   memeIndex:number,
   *   correctLabel:string,
   *   options:string[],
   *   correctOptionIndex:number,
   *   selected:number|null,
   *   timeMs:number|null,
   *   firstShownAt:number|null,
   * }>}
   */
  let questions = [];
  let currentIndex = 0;

  // ---------------------------------------------------------------
  // Screen management
  // ---------------------------------------------------------------

  const screens = {
    menu: document.getElementById("screen-menu"),
    quiz: document.getElementById("screen-quiz"),
    results: document.getElementById("screen-results"),
    history: document.getElementById("screen-history"),
  };

  function showScreen(name) {
    Object.keys(screens).forEach((key) => {
      screens[key].classList.toggle("active", key === name);
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  // ---------------------------------------------------------------
  // Quiz lifecycle
  // ---------------------------------------------------------------

  function buildQuiz() {
    // Pick QUESTIONS_PER_GAME random memes from the full pool.
    const allIndices = Array.from({ length: POOL_SIZE }, (_, i) => i);
    const chosen = shuffle(allIndices).slice(0, QUESTIONS_PER_GAME);

    questions = chosen.map((memeIndex) => {
      const correctLabel = MEMES[memeIndex].label;
      const distractors = pickDistractorLabels(correctLabel, 3);
      const options = shuffle([correctLabel, ...distractors]);
      const correctOptionIndex = options.indexOf(correctLabel);
      return {
        memeIndex,
        correctLabel,
        options,
        correctOptionIndex,
        selected: null,
        timeMs: null,
        firstShownAt: null,
      };
    });
    currentIndex = 0;
  }

  function startQuiz() {
    buildQuiz();
    showScreen("quiz");
    renderQuestion();
  }

  function renderQuestion() {
    const q = questions[currentIndex];
    const meme = MEMES[q.memeIndex];

    document.getElementById("quiz-current").textContent = String(
      currentIndex + 1
    );
    document.getElementById("quiz-total").textContent = String(
      QUESTIONS_PER_GAME
    );

    const progressFill = document.getElementById("progress-fill");
    progressFill.style.width =
      ((currentIndex + 1) / QUESTIONS_PER_GAME) * 100 + "%";

    const img = document.getElementById("quiz-image");
    const cached = preloaded.get(meme.file);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      img.src = cached.src;
    } else {
      img.src = imageUrl(meme.file);
    }
    img.alt = "";

    const optionsContainer = document.getElementById("quiz-options");
    optionsContainer.innerHTML = "";
    q.options.forEach((label, i) => {
      const btn = document.createElement("button");
      btn.className = "option";
      if (q.selected === i) btn.classList.add("selected");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => onSelectOption(i));
      optionsContainer.appendChild(btn);
    });

    if (q.firstShownAt === null) {
      q.firstShownAt = performance.now();
    }

    const backBtn = document.getElementById("nav-back");
    backBtn.disabled = currentIndex === 0;

    const isLast = currentIndex === QUESTIONS_PER_GAME - 1;
    const forwardBtn = document.getElementById("nav-forward");
    const finishBtn = document.getElementById("nav-finish");
    forwardBtn.style.display = isLast ? "none" : "";
    finishBtn.style.display = isLast ? "" : "none";
  }

  function onSelectOption(optionIndex) {
    const q = questions[currentIndex];
    if (q.timeMs === null && q.firstShownAt !== null) {
      q.timeMs = performance.now() - q.firstShownAt;
    }
    q.selected = optionIndex;
    renderQuestion();
  }

  function goBack() {
    if (currentIndex > 0) {
      currentIndex -= 1;
      renderQuestion();
    }
  }

  function goForward() {
    if (currentIndex < QUESTIONS_PER_GAME - 1) {
      currentIndex += 1;
      renderQuestion();
    }
  }

  function tryFinish() {
    const answered = questions.filter((q) => q.selected !== null).length;
    if (answered < QUESTIONS_PER_GAME) {
      const ok = window.confirm(
        "Вы ответили на " +
          answered +
          " из " +
          QUESTIONS_PER_GAME +
          " вопросов. Завершить тест? Неотвеченные засчитаются как неверные."
      );
      if (!ok) return;
    }
    finishQuiz();
  }

  // ---------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------

  function buildResultEntry() {
    const detailed = questions.map((q) => {
      const selectedLabel =
        q.selected != null ? q.options[q.selected] : null;
      const correct = selectedLabel === q.correctLabel;
      const pts = scoreFor(q.timeMs == null ? 999999 : q.timeMs, correct);
      return {
        correctLabel: q.correctLabel,
        selectedLabel,
        correct,
        timeMs: q.timeMs,
        points: pts,
      };
    });
    const total = detailed.reduce((a, x) => a + x.points, 0);
    const score = Math.round(total);
    return {
      timestamp: Date.now(),
      score,
      questions: detailed,
    };
  }

  let lastResult = null;

  function finishQuiz() {
    lastResult = buildResultEntry();
    const history = loadHistory();
    history.unshift(lastResult);
    saveHistory(history.slice(0, 50));
    renderResults(lastResult);
    showScreen("results");
  }

  function renderResults(result) {
    document.getElementById("score-value").textContent = String(result.score);

    const grid = document.getElementById("score-grid");
    grid.innerHTML = "";
    result.questions.forEach((q, i) => {
      const cell = document.createElement("div");
      cell.className = "score-cell " + (q.correct ? "correct" : "wrong");
      cell.textContent = String(i + 1);
      cell.title = "Вопрос " + (i + 1) + ": " + q.correctLabel;
      cell.addEventListener("click", () => showReview(i, result));
      grid.appendChild(cell);
    });

    document.getElementById("review-card").style.display = "none";
  }

  function showReview(i, result) {
    const q = result.questions[i];
    const card = document.getElementById("review-card");
    card.style.display = "block";
    document.getElementById("review-q").textContent = "Вопрос " + (i + 1);
    document.getElementById("review-correct").textContent =
      "Правильно: " + q.correctLabel;
    const userEl = document.getElementById("review-user");
    if (q.selectedLabel == null) {
      userEl.textContent = "Ваш ответ: —";
      userEl.classList.add("wrong");
    } else {
      userEl.textContent = "Ваш ответ: " + q.selectedLabel;
      userEl.classList.toggle("wrong", !q.correct);
    }
  }

  // ---------------------------------------------------------------
  // History
  // ---------------------------------------------------------------

  function renderHistory() {
    const list = loadHistory();
    const empty = document.getElementById("history-empty");
    const container = document.getElementById("history-list");
    container.innerHTML = "";

    if (list.length === 0) {
      empty.style.display = "block";
      container.style.display = "none";
      return;
    }

    empty.style.display = "none";
    container.style.display = "flex";

    list.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "history-item";

      const top = document.createElement("div");
      top.className = "history-item__top";

      const date = document.createElement("div");
      date.className = "history-item__date";
      date.textContent = formatDate(entry.timestamp);

      const score = document.createElement("div");
      score.className = "history-item__score";
      score.innerHTML =
        String(entry.score) + '<span class="of"> / 100</span>';

      top.appendChild(date);
      top.appendChild(score);
      item.appendChild(top);

      const grid = document.createElement("div");
      grid.className = "history-grid";
      entry.questions.forEach((q, i) => {
        const cell = document.createElement("div");
        cell.className = "history-cell" + (q.correct ? "" : " wrong");
        cell.textContent = String(i + 1);
        const lbl = q.correctLabel != null ? q.correctLabel : "";
        cell.title = "Вопрос " + (i + 1) + ": " + lbl;
        grid.appendChild(cell);
      });
      item.appendChild(grid);

      container.appendChild(item);
    });
  }

  // ---------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------

  function init() {
    preloadAll();

    document
      .getElementById("btn-start")
      .addEventListener("click", startQuiz);

    document
      .getElementById("btn-history")
      .addEventListener("click", () => {
        renderHistory();
        showScreen("history");
      });

    document
      .getElementById("btn-history-back")
      .addEventListener("click", () => showScreen("menu"));

    document.getElementById("nav-back").addEventListener("click", goBack);
    document
      .getElementById("nav-forward")
      .addEventListener("click", goForward);
    document
      .getElementById("nav-finish")
      .addEventListener("click", tryFinish);

    document
      .getElementById("btn-restart")
      .addEventListener("click", startQuiz);

    document
      .getElementById("btn-to-menu")
      .addEventListener("click", () => showScreen("menu"));

    showScreen("menu");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
