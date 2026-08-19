(() => {
  "use strict";

  const STORE_KEY = "dayarc_tasks_v1";
  const LOG_KEY = "dayarc_log_v1";
  const STREAK_KEY = "dayarc_streak_v1";

  const $ = (id) => document.getElementById(id);
  const timelineEl = $("timeline");
  const emptyState = $("emptyState");
  const ringFill = $("ringFill");
  const scorePct = $("scorePct");
  const streakText = $("streakText");
  const nowMarker = $("nowMarker");
  const toastEl = $("toast");
  const sheet = $("taskSheet");
  const sheetBackdrop = $("sheetBackdrop");
  const sheetTitle = $("sheetTitle");
  const deleteBtn = $("deleteBtn");

  const RING_CIRCUMFERENCE = 2 * Math.PI * 30;

  let tasks = loadTasks();
  let editingId = null;
  let reminderTimers = [];

  function loadTasks() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveTasks() {
    localStorage.setItem(STORE_KEY, JSON.stringify(tasks));
  }

  function loadLog() {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveLog(log) {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  }

  function todayKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- Date header ----------

  function renderDate() {
    const now = new Date();
    $("dayName").textContent = now.toLocaleDateString(undefined, { weekday: "long" });
    $("dateFull").textContent = now.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  }

  // ---------- Timeline color by time-of-day ----------

  function dotColor(hhmm) {
    const [h] = hhmm.split(":").map(Number);
    if (h >= 5 && h < 11) return "#FF8966"; // dawn
    if (h >= 11 && h < 17) return "#FFB84D"; // day
    if (h >= 17 && h < 21) return "#6B5B95"; // dusk
    return "#1B1B3A"; // night
  }

  // ---------- Render ----------

  function render() {
    const log = loadLog();
    const key = todayKey();
    const doneIds = new Set((log[key] && log[key].doneIds) || []);

    const sorted = [...tasks].sort((a, b) => a.time.localeCompare(b.time));

    timelineEl.innerHTML = "";
    emptyState.style.display = sorted.length === 0 ? "block" : "none";

    for (const t of sorted) {
      const done = doneIds.has(t.id);
      const li = document.createElement("li");
      li.className = "task-row" + (done ? " done" : "");

      const dot = document.createElement("span");
      dot.className = "task-dot";
      dot.style.background = dotColor(t.time);
      li.appendChild(dot);

      const time = document.createElement("span");
      time.className = "task-time";
      time.textContent = formatTime(t.time);
      li.appendChild(time);

      const check = document.createElement("button");
      check.type = "button";
      check.className = "task-check";
      check.setAttribute("aria-label", done ? "Mark not done" : "Mark done");
      check.textContent = "✓";
      check.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleDone(t.id);
      });
      li.appendChild(check);

      const body = document.createElement("div");
      body.className = "task-body";
      const title = document.createElement("div");
      title.className = "task-title";
      title.textContent = t.title;
      const meta = document.createElement("div");
      meta.className = "task-meta";
      meta.innerHTML = `<span>${t.points} pts</span>` + (t.reminder ? "<span>🔔</span>" : "");
      body.appendChild(title);
      body.appendChild(meta);
      body.addEventListener("click", () => openEdit(t.id));
      li.appendChild(body);

      timelineEl.appendChild(li);
    }

    updateScore(sorted, doneIds);
    updateStreakDisplay();
    positionNowMarker(sorted);
  }

  function formatTime(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function updateScore(sorted, doneIds) {
    const total = sorted.reduce((s, t) => s + Number(t.points), 0);
    const earned = sorted.filter((t) => doneIds.has(t.id)).reduce((s, t) => s + Number(t.points), 0);
    const pct = total === 0 ? 0 : Math.round((earned / total) * 100);
    scorePct.textContent = pct + "%";
    const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;
    ringFill.style.strokeDashoffset = offset;

    // Full completion → count streak for today
    if (sorted.length > 0 && earned === total) {
      markStreakDay();
    }
  }

  function markStreakDay() {
    const key = todayKey();
    const log = loadLog();
    if (!log[key]) log[key] = { doneIds: [] };
    if (log[key].streakCounted) return;
    log[key].streakCounted = true;
    saveLog(log);

    const yesterday = todayKey(new Date(Date.now() - 86400000));
    let streak = Number(localStorage.getItem(STREAK_KEY) || "0");
    const lastDate = localStorage.getItem(STREAK_KEY + "_date");
    if (lastDate === yesterday || streak === 0) {
      streak += 1;
    } else if (lastDate !== key) {
      streak = 1;
    }
    localStorage.setItem(STREAK_KEY, String(streak));
    localStorage.setItem(STREAK_KEY + "_date", key);
  }

  function updateStreakDisplay() {
    const streak = Number(localStorage.getItem(STREAK_KEY) || "0");
    streakText.textContent = `${streak} day streak`;
  }

  function positionNowMarker(sorted) {
    if (sorted.length === 0) {
      nowMarker.style.display = "none";
      return;
    }
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const first = toMinutes(sorted[0].time);
    const last = toMinutes(sorted[sorted.length - 1].time);
    if (nowMin < first - 30 || nowMin > last + 30) {
      nowMarker.style.display = "none";
      return;
    }
    const wrap = $("timelineWrap");
    const rows = timelineEl.querySelectorAll(".task-row");
    if (rows.length === 0) {
      nowMarker.style.display = "none";
      return;
    }
    // Interpolate vertical position between rows by time
    let top = rows[0].offsetTop;
    for (let i = 0; i < sorted.length; i++) {
      const rowTop = rows[i].offsetTop + rows[i].offsetHeight / 2;
      const tMin = toMinutes(sorted[i].time);
      if (tMin <= nowMin) {
        top = rowTop;
      } else {
        const prevMin = i > 0 ? toMinutes(sorted[i - 1].time) : tMin;
        const prevTop = i > 0 ? rows[i - 1].offsetTop + rows[i - 1].offsetHeight / 2 : rowTop;
        const span = tMin - prevMin || 1;
        const frac = (nowMin - prevMin) / span;
        top = prevTop + (rowTop - prevTop) * Math.max(0, Math.min(1, frac));
        break;
      }
    }
    nowMarker.style.display = "block";
    nowMarker.style.top = top + wrap.offsetTop - wrap.scrollTop - 60 + "px";
    nowMarker.style.position = "absolute";
    nowMarker.style.top = (rows[0].parentElement.offsetTop + top) + "px";
  }

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function toggleDone(id) {
    const key = todayKey();
    const log = loadLog();
    if (!log[key]) log[key] = { doneIds: [] };
    const set = new Set(log[key].doneIds);
    if (set.has(id)) {
      set.delete(id);
      log[key].streakCounted = false;
    } else {
      set.add(id);
    }
    log[key].doneIds = [...set];
    saveLog(log);
    render();
  }

  // ---------- Sheet (add/edit) ----------

  function openAdd() {
    editingId = null;
    sheetTitle.textContent = "Add task";
    deleteBtn.hidden = true;
    $("fTime").value = "";
    $("fTitle").value = "";
    $("fPoints").value = "10";
    $("fReminder").checked = false;
    openSheet();
  }

  function openEdit(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    editingId = id;
    sheetTitle.textContent = "Edit task";
    deleteBtn.hidden = false;
    $("fTime").value = t.time;
    $("fTitle").value = t.title;
    $("fPoints").value = t.points;
    $("fReminder").checked = !!t.reminder;
    openSheet();
  }

  function openSheet() {
    sheetBackdrop.classList.add("open");
    sheet.classList.add("open");
    setTimeout(() => $("fTime").focus(), 200);
  }

  function closeSheet() {
    sheetBackdrop.classList.remove("open");
    sheet.classList.remove("open");
  }

  sheet.addEventListener("submit", (e) => {
    e.preventDefault();
    const time = $("fTime").value;
    const title = $("fTitle").value.trim();
    const points = Math.max(1, Math.min(100, Number($("fPoints").value) || 10));
    const reminder = $("fReminder").checked;
    if (!time || !title) return;

    if (editingId) {
      const t = tasks.find((x) => x.id === editingId);
      Object.assign(t, { time, title, points, reminder });
      showToast("Task updated");
    } else {
      tasks.push({ id: uid(), time, title, points, reminder });
      showToast("Task added");
    }
    saveTasks();
    closeSheet();
    render();
    scheduleReminders();
  });

  deleteBtn.addEventListener("click", () => {
    tasks = tasks.filter((x) => x.id !== editingId);
    saveTasks();
    closeSheet();
    render();
    scheduleReminders();
    showToast("Task deleted");
  });

  $("cancelBtn").addEventListener("click", closeSheet);
  sheetBackdrop.addEventListener("click", closeSheet);
  $("addBtn").addEventListener("click", openAdd);

  // ---------- Toast ----------

  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  // ---------- Reminders ----------
  // Best-effort: fires only while this tab/app is open in the foreground or
  // backgrounded-but-alive. Android may kill the page in the background,
  // so treat this as a helper, not a guaranteed alarm.

  function scheduleReminders() {
    reminderTimers.forEach((id) => clearTimeout(id));
    reminderTimers = [];

    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const now = new Date();
    for (const t of tasks) {
      if (!t.reminder) continue;
      const [h, m] = t.time.split(":").map(Number);
      const target = new Date();
      target.setHours(h, m, 0, 0);
      const delay = target - now;
      if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
        const id = setTimeout(() => {
          new Notification("Day Arc", { body: t.title, icon: "icon-192.png" });
        }, delay);
        reminderTimers.push(id);
      }
    }
  }

  async function ensureNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        /* ignore */
      }
    }
    scheduleReminders();
  }

  // ---------- Init ----------

  function tick() {
    renderDate();
    render();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  tick();
  ensureNotificationPermission();
  setInterval(tick, 60000);
  window.addEventListener("resize", () => positionNowMarker([...tasks].sort((a, b) => a.time.localeCompare(b.time))));
})();
