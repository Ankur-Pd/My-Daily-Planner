(() => {
  "use strict";

  const STORE_KEY = "dayarc_tasks_v1";       // routine template
  const LOG_KEY = "dayarc_log_v1";           // routine completion log
  const STREAK_KEY = "dayarc_streak_v1";
  const EXTRA_KEY = "dayarc_extra_tasks_v1"; // one-off tasks (carry forward)

  const $ = (id) => document.getElementById(id);
  const timelineEl = $("timeline");
  const emptyState = $("emptyState");
  const ringFill = $("ringFill");
  const scorePct = $("scorePct");
  const streakText = $("streakText");
  const nowMarker = $("nowMarker");
  const toastEl = $("toast");

  const timelineWrap = $("timelineWrap");
  const tasksWrap = $("tasksWrap");
  const taskListEl = $("taskList");
  const tasksEmptyState = $("tasksEmptyState");
  const taskCountBadge = $("taskCountBadge");
  const tabRoutine = $("tabRoutine");
  const tabTasks = $("tabTasks");

  const sheet = $("taskSheet");
  const sheetBackdrop = $("sheetBackdrop");
  const sheetTitle = $("sheetTitle");
  const deleteBtn = $("deleteBtn");

  const extraSheet = $("extraTaskSheet");
  const extraSheetTitle = $("extraSheetTitle");
  const eDeleteBtn = $("eDeleteBtn");

  const RING_CIRCUMFERENCE = 2 * Math.PI * 30;

  let activeTab = "routine";
  let viewDate = todayKey();                // date currently being viewed (defaults to today)
  let tasks = loadJSON(STORE_KEY, []);       // routine
  let extras = loadJSON(EXTRA_KEY, []);      // one-off tasks
  let editingId = null;
  let editingExtraId = null;
  let reminderTimers = [];

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveTasks() {
    localStorage.setItem(STORE_KEY, JSON.stringify(tasks));
  }

  function saveExtras() {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(extras));
  }

  function loadLog() {
    return loadJSON(LOG_KEY, {});
  }

  function saveLog(log) {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  }

  function todayKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- Carry-forward: run once per load ----------

  function rollForwardExtras() {
    const key = todayKey();
    let changed = false;
    for (const t of extras) {
      if (!t.done && t.activeDate < key) {
        t.activeDate = key;
        changed = true;
      }
    }
    if (changed) saveExtras();
  }

  // ---------- Date header ----------

  function renderDate() {
    const d = new Date(viewDate + "T00:00:00");
    const isToday = viewDate === todayKey();
    $("dayName").innerHTML = d.toLocaleDateString(undefined, { weekday: "long" }) +
      (isToday ? '<span class="today-pill">Today</span>' : "");
    $("dateFull").textContent = d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
    $("nextDayBtn").disabled = isToday;
    $("datePicker").value = viewDate;
  }

  function shiftDay(delta) {
    const d = new Date(viewDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    const next = todayKey(d);
    viewDate = next > todayKey() ? todayKey() : next;
    updateScoreAndStreak();
    renderDate();
  }

  $("prevDayBtn").addEventListener("click", () => shiftDay(-1));
  $("nextDayBtn").addEventListener("click", () => shiftDay(1));

  $("calendarBtn").addEventListener("click", () => {
    const picker = $("datePicker");
    if (picker.showPicker) {
      picker.showPicker();
    } else {
      picker.click();
    }
  });

  $("datePicker").addEventListener("change", (e) => {
    const picked = e.target.value;
    if (!picked) return;
    viewDate = picked > todayKey() ? todayKey() : picked;
    updateScoreAndStreak();
    renderDate();
  });

  // ---------- Timeline color by time-of-day ----------

  function dotColor(hhmm) {
    const [h] = hhmm.split(":").map(Number);
    if (h >= 5 && h < 11) return "#FF8966";
    if (h >= 11 && h < 17) return "#FFB84D";
    if (h >= 17 && h < 21) return "#6B5B95";
    return "#1B1B3A";
  }

  // ---------- Tabs ----------

  function setTab(tab) {
    activeTab = tab;
    tabRoutine.classList.toggle("active", tab === "routine");
    tabTasks.classList.toggle("active", tab === "tasks");
    timelineWrap.hidden = tab !== "routine";
    tasksWrap.hidden = tab !== "tasks";
  }

  tabRoutine.addEventListener("click", () => setTab("routine"));
  tabTasks.addEventListener("click", () => setTab("tasks"));

  // ---------- Render: Routine ----------

  function renderRoutine(log, key) {
    const doneIds = new Set((log[key] && log[key].doneIds) || []);
    const sorted = [...tasks].sort((a, b) => a.time.localeCompare(b.time));
    const isToday = key === todayKey();

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
        toggleRoutineDone(t.id);
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
      if (isToday) {
        body.addEventListener("click", () => openEditRoutine(t.id));
      } else {
        body.style.cursor = "default";
      }
      li.appendChild(body);

      timelineEl.appendChild(li);
    }

    if (isToday) positionNowMarker(sorted);
    else nowMarker.style.display = "none";

    return { sorted, doneIds };
  }

  function formatTime(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  // ---------- Render: Tasks (one-off, carry-forward) ----------

  function renderTasks(key) {
    const isToday = key === todayKey();

    const active = isToday
      ? extras
          .filter((t) => t.done ? t.doneDate === key : t.activeDate === key)
          .sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            return (a.time || "99:99").localeCompare(b.time || "99:99");
          })
      : extras.filter((t) => t.done && t.doneDate === key);

    taskListEl.innerHTML = "";
    tasksEmptyState.textContent = isToday
      ? "No extra tasks right now. Anything outside your routine goes here — and if it doesn't get done, it follows you to tomorrow."
      : "Nothing completed from this list on this day.";
    tasksEmptyState.style.display = active.length === 0 ? "block" : "none";

    const pendingCount = extras.filter((t) => !t.done).length;
    taskCountBadge.hidden = pendingCount === 0;
    taskCountBadge.textContent = String(pendingCount);

    for (const t of active) {
      const overdueDays = t.done ? 0 : daysBetween(t.createdDate, key);
      const li = document.createElement("li");
      li.className = "task-card" + (t.done ? " done" : "") + (overdueDays > 0 ? " overdue" : "");

      const check = document.createElement("button");
      check.type = "button";
      check.className = "task-check";
      check.setAttribute("aria-label", t.done ? "Mark not done" : "Mark done");
      check.textContent = "✓";
      check.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleExtraDone(t.id);
      });
      li.appendChild(check);

      const body = document.createElement("div");
      body.className = "task-card-body";
      const title = document.createElement("div");
      title.className = "task-card-title";
      title.textContent = t.title;
      body.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "task-card-meta";
      meta.innerHTML = `<span class="chip">${t.points} pts</span>`;
      if (t.time) meta.innerHTML += `<span class="chip">🔔 ${formatTime(t.time)}</span>`;
      if (overdueDays > 0) meta.innerHTML += `<span class="chip carried">Carried ${overdueDays}d</span>`;
      body.appendChild(meta);

      if (isToday) body.addEventListener("click", () => openEditExtra(t.id));
      else body.style.cursor = "default";
      li.appendChild(body);

      taskListEl.appendChild(li);
    }
  }

  // ---------- Combined score / streak ----------

  function updateScoreAndStreak() {
    const log = loadLog();
    const key = viewDate;
    const realToday = todayKey();

    const { sorted, doneIds } = renderRoutine(log, key);
    renderTasks(key);

    const routineTotal = sorted.reduce((s, t) => s + Number(t.points), 0);
    const routineEarned = sorted.filter((t) => doneIds.has(t.id)).reduce((s, t) => s + Number(t.points), 0);

    const todaysExtras = key === realToday
      ? extras.filter((t) => t.done ? t.doneDate === key : t.activeDate === key)
      : extras.filter((t) => t.done && t.doneDate === key);
    const extraTotal = todaysExtras.reduce((s, t) => s + Number(t.points), 0);
    const extraEarned = todaysExtras.filter((t) => t.done).reduce((s, t) => s + Number(t.points), 0);

    const total = routineTotal + extraTotal;
    const earned = routineEarned + extraEarned;
    const pct = total === 0 ? 0 : Math.round((earned / total) * 100);

    scorePct.textContent = pct + "%";
    ringFill.style.strokeDashoffset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;

    if (key === realToday && total > 0 && earned === total) {
      markStreakDay(log, key);
    }
    updateStreakDisplay();

    // Toggle FAB: adding/editing only makes sense while viewing today
    $("addBtn").hidden = key !== realToday;
  }

  function markStreakDay(log, key) {
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

  // ---------- Now marker (routine timeline) ----------

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
    const rows = timelineEl.querySelectorAll(".task-row");
    if (rows.length === 0) {
      nowMarker.style.display = "none";
      return;
    }
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
    nowMarker.style.position = "absolute";
    nowMarker.style.top = (rows[0].parentElement.offsetTop + top) + "px";
  }

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  // ---------- Toggle done ----------

  function toggleRoutineDone(id) {
    const key = viewDate;
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
    updateScoreAndStreak();
  }

  function toggleExtraDone(id) {
    const key = todayKey();
    const t = extras.find((x) => x.id === id);
    if (!t) return;
    if (t.done) {
      t.done = false;
      t.doneDate = null;
      t.activeDate = key;
    } else {
      t.done = true;
      t.doneDate = key;
    }
    saveExtras();
    updateScoreAndStreak();
  }

  // ---------- Sheet: Routine add/edit ----------

  function openAdd() {
    if (activeTab === "tasks") {
      openAddExtra();
    } else {
      openAddRoutine();
    }
  }

  function openAddRoutine() {
    editingId = null;
    sheetTitle.textContent = "Add routine task";
    deleteBtn.hidden = true;
    $("fTime").value = "";
    $("fTitle").value = "";
    $("fPoints").value = "10";
    $("fReminder").checked = false;
    openSheetEl(sheet);
  }

  function openEditRoutine(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    editingId = id;
    sheetTitle.textContent = "Edit routine task";
    deleteBtn.hidden = false;
    $("fTime").value = t.time;
    $("fTitle").value = t.title;
    $("fPoints").value = t.points;
    $("fReminder").checked = !!t.reminder;
    openSheetEl(sheet);
  }

  function openSheetEl(el) {
    sheetBackdrop.classList.add("open");
    el.classList.add("open");
    const firstInput = el.querySelector("input");
    setTimeout(() => firstInput && firstInput.focus(), 200);
  }

  function closeSheets() {
    sheetBackdrop.classList.remove("open");
    sheet.classList.remove("open");
    extraSheet.classList.remove("open");
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
    closeSheets();
    updateScoreAndStreak();
    scheduleReminders();
  });

  deleteBtn.addEventListener("click", () => {
    tasks = tasks.filter((x) => x.id !== editingId);
    saveTasks();
    closeSheets();
    updateScoreAndStreak();
    scheduleReminders();
    showToast("Task deleted");
  });

  $("cancelBtn").addEventListener("click", closeSheets);

  // ---------- Sheet: Extra task add/edit ----------

  function openAddExtra() {
    editingExtraId = null;
    extraSheetTitle.textContent = "Add task";
    eDeleteBtn.hidden = true;
    $("eTitle").value = "";
    $("ePoints").value = "10";
    $("eTime").value = "";
    $("eReminder").checked = false;
    openSheetEl(extraSheet);
  }

  function openEditExtra(id) {
    const t = extras.find((x) => x.id === id);
    if (!t) return;
    editingExtraId = id;
    extraSheetTitle.textContent = "Edit task";
    eDeleteBtn.hidden = false;
    $("eTitle").value = t.title;
    $("ePoints").value = t.points;
    $("eTime").value = t.time || "";
    $("eReminder").checked = !!t.reminder;
    openSheetEl(extraSheet);
  }

  extraSheet.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("eTitle").value.trim();
    const points = Math.max(1, Math.min(100, Number($("ePoints").value) || 10));
    const time = $("eTime").value;
    const reminder = $("eReminder").checked && !!time;
    if (!title) return;
    const key = todayKey();

    if (editingExtraId) {
      const t = extras.find((x) => x.id === editingExtraId);
      Object.assign(t, { title, points, time, reminder });
      showToast("Task updated");
    } else {
      extras.push({
        id: uid(),
        title,
        points,
        time,
        reminder,
        createdDate: key,
        activeDate: key,
        done: false,
        doneDate: null
      });
      showToast("Task added");
    }
    saveExtras();
    closeSheets();
    updateScoreAndStreak();
    scheduleReminders();
  });

  eDeleteBtn.addEventListener("click", () => {
    extras = extras.filter((x) => x.id !== editingExtraId);
    saveExtras();
    closeSheets();
    updateScoreAndStreak();
    scheduleReminders();
    showToast("Task deleted");
  });

  $("eCancelBtn").addEventListener("click", closeSheets);
  sheetBackdrop.addEventListener("click", closeSheets);
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
    const key = todayKey();

    for (const t of tasks) {
      if (!t.reminder) continue;
      queueReminder(t.time, t.title, now);
    }

    for (const t of extras) {
      if (!t.reminder || !t.time || t.done || t.activeDate !== key) continue;
      queueReminder(t.time, t.title, now);
    }
  }

  function queueReminder(hhmm, title, now) {
    const [h, m] = hhmm.split(":").map(Number);
    const target = new Date();
    target.setHours(h, m, 0, 0);
    const delay = target - now;
    if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
      const id = setTimeout(() => {
        new Notification("Day Arc", { body: title, icon: "icon-192.png" });
      }, delay);
      reminderTimers.push(id);
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
    rollForwardExtras();
    updateScoreAndStreak();
  }

  $("datePicker").max = todayKey();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  setTab("routine");
  tick();
  ensureNotificationPermission();
  setInterval(tick, 60000);
  window.addEventListener("resize", () => {
    const sorted = [...tasks].sort((a, b) => a.time.localeCompare(b.time));
    positionNowMarker(sorted);
  });
})();
