/* ============================================================
   Workout Tracker — app.js
   Vanilla JS. localStorage persistence. No dependencies.
   ============================================================ */
(function () {
  "use strict";

  /* ============================================================
     1. UTILITIES
     ============================================================ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, "0");

  let _idCounter = 0;
  function uid(prefix = "id") {
    _idCounter += 1;
    return (
      prefix +
      "_" +
      Date.now().toString(36) +
      "_" +
      _idCounter.toString(36) +
      Math.random().toString(36).slice(2, 6)
    );
  }

  const escapeMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  function esc(value) {
    return String(value == null ? "" : value).replace(
      /[&<>"']/g,
      (c) => escapeMap[c],
    );
  }

  function numOrNull(v) {
    if (v === "" || v == null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  function roundTo(v, d = 1) {
    const p = Math.pow(10, d);
    return Math.round(v * p) / p;
  }
  function clampNum(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function toISODate(d) {
    return (
      d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
    );
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  function fmtDateShort(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  function fmtDur(ms) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return mins + " min";
    return Math.floor(mins / 60) + " h " + pad2(mins % 60) + " min";
  }
  function fmtClock(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? h + ":" + pad2(m) + ":" + pad2(s) : m + ":" + pad2(s);
  }
  function startOfWeek(date) {
    const d = new Date(date || new Date());
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d;
  }
  function daysAgo(n) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d;
  }

  /* ---- weight unit conversion (stored internally in kg) ---- */
  const LB_PER_KG = 2.2046226218;
  function unitLabel() {
    return state.settings.unit === "lb" ? "lb" : "kg";
  }
  function kgToDisplay(kg) {
    if (kg == null || !Number.isFinite(kg)) return null;
    return state.settings.unit === "lb"
      ? roundTo(kg * LB_PER_KG, 1)
      : roundTo(kg, 2);
  }
  function displayToKg(v) {
    if (v == null || !Number.isFinite(v)) return null;
    return state.settings.unit === "lb"
      ? roundTo(v / LB_PER_KG, 3)
      : roundTo(v, 3);
  }

  const ICON_CHECK =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5"/></svg>';
  const ICON_CIRCLE =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>';

  /* ============================================================
     2. STORAGE / STATE
     ============================================================ */
  const STORAGE_KEY = "wt.data.v1";
  const TIMER_KEY = "wt.timer.v1";
  const SCHEMA_VERSION = 1;

  let state = null;
  let routineDraft = null;
  let saveTimer = null;
  let saveOk = true;
  let currentRoute = {
    name: "dashboard",
    param: null,
    query: new URLSearchParams(),
  };
  let previousRouteKey = "";
  let undoStack = [];
  let undoHideTimer = null;

  function defaultSettings() {
    return {
      unit: "kg",
      defaultRest: 90,
      autoStartRest: true,
      defaultSets: 3,
      defaultRepMin: 8,
      defaultRepMax: 12,
      useRIR: false,
      weeklyTarget: 3,
      theme: "dark",
      sound: true,
      vibration: true,
    };
  }

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      settings: defaultSettings(),
      exercises: [],
      routines: [],
      workouts: [],
      activeWorkout: null,
      meta: { createdAt: new Date().toISOString(), lastSaved: null },
    };
  }

  function seedState() {
    const s = emptyState();
    const now = new Date().toISOString();
    const E = {};
    function addEx(
      key,
      name,
      muscles,
      equipment,
      type,
      unilateral,
      instructions,
    ) {
      E[key] = {
        id: uid("ex"),
        name: name,
        muscles: muscles,
        equipment: equipment,
        type: type || "reps",
        unilateral: !!unilateral,
        instructions: instructions || "",
        notes: "",
        createdAt: now,
      };
    }

    addEx(
      "pushup",
      "Push-up",
      ["Chest", "Triceps", "Shoulders"],
      "Bodyweight",
      "reps",
      false,
      "Hands under shoulders, body in a straight line. Lower until the chest is close to the floor.",
    );
    addEx(
      "kneepushup",
      "Knee Push-up",
      ["Chest", "Triceps"],
      "Bodyweight",
      "reps",
      false,
      "Knees on the floor, hips in line with shoulders. Easier variation of the push-up.",
    );
    addEx(
      "pikepushup",
      "Pike Push-up",
      ["Shoulders", "Triceps"],
      "Bodyweight",
      "reps",
      false,
      "Hips high, head between hands. Lower until the head nearly touches the floor.",
    );
    addEx(
      "squat",
      "Bodyweight Squat",
      ["Quads", "Glutes"],
      "Bodyweight",
      "reps",
      false,
      "Feet shoulder-width. Sit down and back, keep the chest up.",
    );
    addEx(
      "split-squat",
      "Split Squat",
      ["Quads", "Glutes"],
      "Bodyweight",
      "reps",
      true,
      "Rear foot back, lower the back knee towards the floor. Log each side separately.",
    );
    addEx(
      "reverse-lunge",
      "Reverse Lunge",
      ["Quads", "Glutes", "Hamstrings"],
      "Bodyweight",
      "reps",
      true,
      "Step back, lower the back knee, then push back to standing. Log each side separately.",
    );
    addEx(
      "glute-bridge",
      "Glute Bridge",
      ["Glutes", "Hamstrings"],
      "Bodyweight",
      "reps",
      false,
      "Feet flat, drive the hips up, squeeze the glutes at the top.",
    );
    addEx(
      "calf-raise",
      "Calf Raise",
      ["Calves"],
      "Bodyweight",
      "reps",
      false,
      "Rise onto the toes, pause, lower slowly.",
    );
    addEx(
      "plank",
      "Plank",
      ["Core"],
      "Bodyweight",
      "timed",
      false,
      "Forearms on the floor, body in a straight line. Hold and breathe.",
    );
    addEx(
      "hollow-hold",
      "Hollow Hold",
      ["Core"],
      "Bodyweight",
      "timed",
      false,
      "Lower back pressed into the floor, arms and legs lifted.",
    );
    addEx(
      "side-plank",
      "Side Plank",
      ["Core", "Obliques"],
      "Bodyweight",
      "timed",
      true,
      "On one forearm, hips lifted. Log each side separately.",
    );
    addEx(
      "superman",
      "Superman",
      ["Back", "Glutes"],
      "Bodyweight",
      "reps",
      false,
      "Lie face down, lift the arms and legs slightly, hold briefly, lower.",
    );
    addEx(
      "chair-dip",
      "Chair Dip",
      ["Triceps", "Chest"],
      "Bodyweight",
      "reps",
      false,
      "Hands on a sturdy chair behind you, lower until the elbows are bent.",
    );

    addEx(
      "sa-row",
      "Single-arm Dumbbell Row",
      ["Back", "Biceps"],
      "Dumbbell",
      "reps",
      true,
      "One hand supported, pull the dumbbell towards the hip. Log each side separately.",
    );
    addEx(
      "sa-press",
      "Single-arm Dumbbell Press",
      ["Shoulders", "Triceps"],
      "Dumbbell",
      "reps",
      true,
      "Press the dumbbell overhead, keep the ribs down. Log each side separately.",
    );
    addEx(
      "db-rdl",
      "Dumbbell Romanian Deadlift",
      ["Hamstrings", "Glutes"],
      "Dumbbell",
      "reps",
      false,
      "Hinge at the hips, keep the back flat, lower until you feel a hamstring stretch.",
    );
    addEx(
      "db-curl",
      "Dumbbell Curl",
      ["Biceps"],
      "Dumbbell",
      "reps",
      false,
      "Elbows close to the body, curl without swinging.",
    );
    addEx(
      "goblet-squat",
      "Goblet Squat",
      ["Quads", "Glutes"],
      "Dumbbell",
      "reps",
      false,
      "Hold the dumbbell at the chest, squat with the chest tall.",
    );

    const exercises = Object.values(E);

    function rx(key, sets, repMin, repMax, rest, notes) {
      return {
        id: uid("rx"),
        exerciseId: E[key].id,
        sets: sets,
        repMin: repMin,
        repMax: repMax,
        targetRIR: null,
        rest: rest || 90,
        notes: notes || "",
      };
    }

    s.exercises = exercises;
    s.routines = [
      {
        id: uid("rt"),
        name: "Workout A",
        description: "Full body · bodyweight + 5 kg dumbbell",
        exercises: [
          rx("pushup", 3, 8, 15, 90),
          rx("split-squat", 3, 8, 12, 75),
          rx("sa-row", 3, 8, 12, 90, "One 5 kg dumbbell. Log each side."),
          rx("plank", 3, 30, 60, 60),
          rx("glute-bridge", 3, 12, 15, 60),
        ],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: uid("rt"),
        name: "Workout B",
        description: "Full body · bodyweight + 5 kg dumbbell",
        exercises: [
          rx("pikepushup", 3, 6, 12, 90),
          rx("squat", 3, 15, 20, 75),
          rx("sa-press", 3, 8, 12, 90, "One 5 kg dumbbell. Log each side."),
          rx("reverse-lunge", 3, 10, 12, 75),
          rx("db-rdl", 3, 12, 15, 75),
          rx("hollow-hold", 3, 20, 40, 60),
        ],
        createdAt: now,
        updatedAt: now,
      },
    ];
    return s;
  }

  /* ---- sanitizers (used by load + import) ---- */
  function sanitizeExercise(e) {
    if (!e || typeof e !== "object") return null;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (!name) return null;
    return {
      id: typeof e.id === "string" && e.id ? e.id : uid("ex"),
      name: name,
      muscles: Array.isArray(e.muscles)
        ? e.muscles.filter((m) => typeof m === "string")
        : [],
      equipment: typeof e.equipment === "string" ? e.equipment : "Bodyweight",
      type:
        ["reps", "timed", "distance"].indexOf(e.type) >= 0 ? e.type : "reps",
      unilateral: !!e.unilateral,
      instructions: typeof e.instructions === "string" ? e.instructions : "",
      notes: typeof e.notes === "string" ? e.notes : "",
      media: typeof e.media === "string" ? e.media : "",
      createdAt: e.createdAt || new Date().toISOString(),
    };
  }

  function sanitizeRoutine(r) {
    if (!r || typeof r !== "object") return null;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) return null;
    const exercises = Array.isArray(r.exercises)
      ? r.exercises
          .filter((x) => x && x.exerciseId)
          .map((x) => ({
            id: typeof x.id === "string" && x.id ? x.id : uid("rx"),
            exerciseId: x.exerciseId,
            sets: Number.isFinite(x.sets)
              ? clampNum(Math.round(x.sets), 1, 30)
              : 3,
            repMin: numOrNull(x.repMin),
            repMax: numOrNull(x.repMax),
            targetRIR: numOrNull(x.targetRIR),
            rest: Number.isFinite(x.rest)
              ? clampNum(Math.round(x.rest), 0, 900)
              : 90,
            notes: typeof x.notes === "string" ? x.notes : "",
          }))
      : [];
    return {
      id: typeof r.id === "string" && r.id ? r.id : uid("rt"),
      name: name,
      description: typeof r.description === "string" ? r.description : "",
      exercises: exercises,
      createdAt: r.createdAt || new Date().toISOString(),
      updatedAt: r.updatedAt || new Date().toISOString(),
    };
  }

  function sanitizeSet(s) {
    if (!s || typeof s !== "object") return null;
    return {
      id: typeof s.id === "string" && s.id ? s.id : uid("s"),
      reps: numOrNull(s.reps),
      repsL: numOrNull(s.repsL),
      repsR: numOrNull(s.repsR),
      duration: numOrNull(s.duration),
      durationL: numOrNull(s.durationL),
      durationR: numOrNull(s.durationR),
      distance: numOrNull(s.distance),
      distanceL: numOrNull(s.distanceL),
      distanceR: numOrNull(s.distanceR),
      weight: numOrNull(s.weight),
      rir: numOrNull(s.rir),
      completed: !!s.completed,
      completedAt: s.completedAt || null,
      prefilled: !!s.prefilled,
    };
  }

  function sanitizeWorkoutExercise(we) {
    if (!we || typeof we !== "object") return null;
    const sets = Array.isArray(we.sets)
      ? we.sets.map(sanitizeSet).filter(Boolean)
      : [];
    return {
      id: typeof we.id === "string" && we.id ? we.id : uid("we"),
      exerciseId: we.exerciseId || null,
      exerciseName:
        typeof we.exerciseName === "string" ? we.exerciseName : "Exercise",
      equipment: typeof we.equipment === "string" ? we.equipment : "Bodyweight",
      unilateral: !!we.unilateral,
      type:
        ["reps", "timed", "distance"].indexOf(we.type) >= 0 ? we.type : "reps",
      repMin: numOrNull(we.repMin),
      repMax: numOrNull(we.repMax),
      targetRIR: numOrNull(we.targetRIR),
      rest: Number.isFinite(we.rest) ? we.rest : 90,
      notes: typeof we.notes === "string" ? we.notes : "",
      media: typeof we.media === "string" ? we.media : "",
      sets: sets,
    };
  }

  function sanitizeWorkout(w) {
    if (!w || typeof w !== "object") return null;
    if (!w.startTime || isNaN(new Date(w.startTime))) return null;
    const exercises = Array.isArray(w.exercises)
      ? w.exercises.map(sanitizeWorkoutExercise).filter(Boolean)
      : [];
    return {
      id: typeof w.id === "string" && w.id ? w.id : uid("w"),
      routineId: w.routineId || null,
      routineName:
        typeof w.routineName === "string" ? w.routineName : "Workout",
      date: w.date || toISODate(new Date(w.startTime)),
      startTime: w.startTime,
      endTime: w.endTime || null,
      pausedAt: w.pausedAt || null,
      totalPausedMs: Number.isFinite(w.totalPausedMs) ? w.totalPausedMs : 0,
      durationMs: Number.isFinite(w.durationMs) ? w.durationMs : 0,
      status:
        ["active", "completed", "abandoned"].indexOf(w.status) >= 0
          ? w.status
          : "completed",
      notes: typeof w.notes === "string" ? w.notes : "",
      currentExerciseIndex: Number.isFinite(w.currentExerciseIndex)
        ? Math.max(0, Math.floor(w.currentExerciseIndex))
        : 0,
      exercises: exercises,
    };
  }

  function migrate(data) {
    const s = emptyState();
    s.settings = Object.assign(
      defaultSettings(),
      (data && data.settings) || {},
    );
    s.exercises = Array.isArray(data.exercises)
      ? data.exercises.map(sanitizeExercise).filter(Boolean)
      : [];
    s.routines = Array.isArray(data.routines)
      ? data.routines.map(sanitizeRoutine).filter(Boolean)
      : [];
    s.workouts = Array.isArray(data.workouts)
      ? data.workouts.map(sanitizeWorkout).filter(Boolean)
      : [];
    s.activeWorkout = data.activeWorkout
      ? sanitizeWorkout(data.activeWorkout)
      : null;
    if (s.activeWorkout && s.activeWorkout.status !== "active")
      s.activeWorkout = null;
    // One-time cleanup: workout snapshots used to duplicate exercise media.
    // Media lives in the exercise library only — strip any copies from workouts.
    const strip = (w) => {
      if (!w || !Array.isArray(w.exercises)) return;
      w.exercises.forEach((we) => {
        if (we && Object.prototype.hasOwnProperty.call(we, "media")) {
          delete we.media;
        }
      });
    };
    s.workouts.forEach(strip);
    if (s.activeWorkout) strip(s.activeWorkout);
    s.meta = Object.assign(s.meta, data.meta || {});
    s.version = SCHEMA_VERSION;
    return s;
  }

  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      toast("Browser storage is unavailable: " + err.message, "error", 8000);
      saveOk = false;
      return seedState();
    }
    if (!raw) return seedState();
    try {
      const parsed = JSON.parse(raw);
      return migrate(parsed);
    } catch (err) {
      try {
        localStorage.setItem(STORAGE_KEY + ".corrupt." + Date.now(), raw);
      } catch (_) {
        /* ignore */
      }
      toast(
        "Saved data could not be read. The raw copy was kept in storage.",
        "error",
        9000,
      );
      return seedState();
    }
  }

  function setSaveIndicator(ok) {
    const el = $("#save-indicator");
    if (!el) return;
    if (ok) {
      el.textContent = "Saved " + fmtTime(new Date().toISOString());
      el.classList.remove("error");
    } else {
      el.textContent = "NOT SAVED";
      el.classList.add("error");
    }
  }

  function stripMediaFromWorkouts() {
    if (!state) return 0;
    let removed = 0;
    const strip = (w) => {
      if (!w || !Array.isArray(w.exercises)) return;
      w.exercises.forEach((we) => {
        if (we && Object.prototype.hasOwnProperty.call(we, "media")) {
          delete we.media;
          removed++;
        }
      });
    };
    state.workouts.forEach(strip);
    if (state.activeWorkout) strip(state.activeWorkout);
    return removed;
  }

  function estimateStorageBytes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || "";
      return new Blob([raw]).size;
    } catch (_) {
      return 0;
    }
  }

  function fmtBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  function mediaInfo() {
    if (!state) return "no media";
    let count = 0;
    let bytes = 0;
    state.exercises.forEach((ex) => {
      if (ex && typeof ex.media === "string" && ex.media) {
        count++;
        bytes += ex.media.length;
      }
    });
    if (count === 0) return "no media";
    return (
      count + " photo" + (count === 1 ? "" : "s") + " (" + fmtBytes(bytes) + ")"
    );
  }

  function showStorageFullDialog() {
    if (document.body.classList.contains("modal-open")) return;
    openModal({
      title: "Storage full",
      body:
        "<p>Your workout data is still safe in this tab, but it could not be written to browser storage.</p>" +
        '<p class="muted small">This usually means the browser storage limit has been reached. You can free space without losing any workout records.</p>' +
        '<div class="btn-stack" style="margin-top:12px">' +
        '<button class="btn primary" id="sf-cleanup">Free up space &amp; retry</button>' +
        '<button class="btn" id="sf-export">Export backup now</button>' +
        '<button class="btn" id="sf-settings">Open settings</button>' +
        "</div>",
      footer: '<button class="btn" data-action="close-modal">Close</button>',
      onMount(el) {
        const cleanupBtn = $("#sf-cleanup", el);
        if (cleanupBtn)
          cleanupBtn.addEventListener("click", () => {
            const removed = stripMediaFromWorkouts();
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
              state.meta.lastSaved = new Date().toISOString();
              saveOk = true;
              setSaveIndicator(true);
              closeModal();
              toast(
                removed > 0
                  ? "Removed " + removed + " duplicated photo(s). Saved."
                  : "Saved.",
                "ok",
                3000,
              );
              render();
            } catch (err2) {
              toast(
                "Still full. Export a backup, then delete exercise photos or old workouts in Settings.",
                "error",
                7000,
              );
            }
          });
        const exportBtn = $("#sf-export", el);
        if (exportBtn) exportBtn.addEventListener("click", () => exportJSON());
        const settingsBtn = $("#sf-settings", el);
        if (settingsBtn)
          settingsBtn.addEventListener("click", () => {
            closeModal();
            location.hash = "#/settings";
          });
      },
    });
  }

  function save(immediate) {
    if (!state) return;
    clearTimeout(saveTimer);
    const doWrite = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        state.meta.lastSaved = new Date().toISOString();
        saveOk = true;
        setSaveIndicator(true);
        if (window.Cloud) window.Cloud.schedulePush(state);
      } catch (err) {
        // First attempt failed: try to free space by removing duplicated
        // media from workout snapshots (media lives in the exercise library).
        const removed = stripMediaFromWorkouts();
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          state.meta.lastSaved = new Date().toISOString();
          saveOk = true;
          setSaveIndicator(true);
          if (removed > 0) {
            toast("Freed space by removing duplicated photos", "ok", 2600);
            render();
          }
        } catch (err2) {
          saveOk = false;
          setSaveIndicator(false);
          showStorageFullDialog();
        }
      }
    };
    if (immediate) doWrite();
    else saveTimer = setTimeout(doWrite, 220);
  }

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setSaveIndicator(true);
      } catch (_) {
        stripMediaFromWorkouts();
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          setSaveIndicator(true);
        } catch (_2) {
          /* give up on unload */
        }
      }
    }
  }

  /* ============================================================
     3. SELECTORS / COMPUTATION
     ============================================================ */
  function getExercise(id) {
    return state.exercises.find((e) => e.id === id) || null;
  }
  function getRoutine(id) {
    return state.routines.find((r) => r.id === id) || null;
  }

  function completedWorkouts() {
    return state.workouts
      .filter((w) => w.status === "completed")
      .slice()
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  }
  function allWorkoutsDesc() {
    return state.workouts
      .slice()
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  }
  function lastCompletedWorkout() {
    const list = completedWorkouts();
    return list.length ? list[list.length - 1] : null;
  }
  function workoutsThisWeek() {
    const start = startOfWeek();
    return completedWorkouts().filter((w) => new Date(w.startTime) >= start);
  }
  function nextRoutine() {
    if (!state.routines.length) return null;
    const last = lastCompletedWorkout();
    if (!last) return state.routines[0];
    const idx = state.routines.findIndex((r) => r.id === last.routineId);
    if (idx === -1) return state.routines[0];
    return state.routines[(idx + 1) % state.routines.length];
  }

  function valueFields(we) {
    const t = we.type || "reps";
    const key =
      t === "timed" ? "duration" : t === "distance" ? "distance" : "reps";
    return we.unilateral ? [key + "L", key + "R"] : [key];
  }
  function fieldLabel(field) {
    const map = {
      reps: "Reps",
      repsL: "L",
      repsR: "R",
      duration: "Sec",
      durationL: "L (s)",
      durationR: "R (s)",
      distance: "m",
      distanceL: "L (m)",
      distanceR: "R (m)",
      weight: "Load",
      rir: "RIR",
    };
    return map[field] || field;
  }
  function setHasValue(set, we) {
    return valueFields(we).some((k) => set[k] != null);
  }
  function setTotalReps(set, we) {
    if ((we.type || "reps") !== "reps") return 0;
    if (we.unilateral) return (set.repsL || 0) + (set.repsR || 0);
    return set.reps || 0;
  }
  function maxSetValue(set, we) {
    const t = we.type || "reps";
    if (t === "timed") {
      return we.unilateral
        ? Math.max(set.durationL || 0, set.durationR || 0)
        : set.duration || 0;
    }
    if (t === "distance") {
      return we.unilateral
        ? Math.max(set.distanceL || 0, set.distanceR || 0)
        : set.distance || 0;
    }
    return we.unilateral
      ? Math.max(set.repsL || 0, set.repsR || 0)
      : set.reps || 0;
  }
  function fmtSetValue(set, we) {
    const t = we.type || "reps";
    if (we.unilateral) {
      const a =
        t === "timed"
          ? set.durationL
          : t === "distance"
            ? set.distanceL
            : set.repsL;
      const b =
        t === "timed"
          ? set.durationR
          : t === "distance"
            ? set.distanceR
            : set.repsR;
      if (a == null && b == null) return "—";
      const suffix = t === "timed" ? "s" : t === "distance" ? "m" : "";
      return (a == null ? "—" : a) + "/" + (b == null ? "—" : b) + suffix;
    }
    if (t === "timed") return set.duration == null ? "—" : set.duration + "s";
    if (t === "distance")
      return set.distance == null ? "—" : set.distance + "m";
    return set.reps == null ? "—" : String(set.reps);
  }
  function targetText(we) {
    const t = we.type || "reps";
    const suffix = t === "timed" ? " s" : t === "distance" ? " m" : " reps";
    if (we.repMin != null && we.repMax != null)
      return we.repMin + "–" + we.repMax + suffix;
    if (we.repMax != null) return "up to " + we.repMax + suffix;
    if (we.repMin != null) return we.repMin + "+" + suffix;
    return "no target";
  }
  function workoutElapsedMs(w) {
    if (!w) return 0;
    const start = new Date(w.startTime).getTime();
    const end = w.pausedAt
      ? new Date(w.pausedAt).getTime()
      : w.endTime
        ? new Date(w.endTime).getTime()
        : Date.now();
    return Math.max(0, end - start - (w.totalPausedMs || 0));
  }

  function exerciseSessions(exerciseId) {
    const out = [];
    completedWorkouts().forEach((w) => {
      const we = w.exercises.find((e) => e.exerciseId === exerciseId);
      if (we) out.push({ workout: w, exercise: we });
    });
    return out; // ascending by date
  }

  function findPreviousExerciseEntry(exerciseId, excludeWorkoutId) {
    const list = completedWorkouts();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].id === excludeWorkoutId) continue;
      const we = list[i].exercises.find((e) => e.exerciseId === exerciseId);
      if (we) return { workout: list[i], exercise: we };
    }
    return null;
  }

  function sessionScore(session) {
    const we = session.exercise;
    return we.sets
      .filter((s) => s.completed)
      .reduce((sum, s) => {
        if ((we.type || "reps") === "timed") {
          return (
            sum +
            (we.unilateral
              ? (s.durationL || 0) + (s.durationR || 0)
              : s.duration || 0)
          );
        }
        return sum + setTotalReps(s, we);
      }, 0);
  }

  function progressionSuggestion(we) {
    const sessions = exerciseSessions(we.exerciseId);
    if (!sessions.length) {
      return "First recorded session — aim for the middle of the target range with clean form.";
    }
    const last = sessions[sessions.length - 1];
    const lastSets = last.exercise.sets.filter((s) => s.completed);
    if (!lastSets.length) {
      return "No completed sets last time — choose a target you can finish with good form.";
    }
    const prev = sessions.length > 1 ? sessions[sessions.length - 2] : null;
    const cur = sessionScore(last);
    const before = prev ? sessionScore(prev) : null;

    const top = we.repMax;
    const allAtTop =
      top != null &&
      lastSets.every((s) => maxSetValue(s, last.exercise) >= top);
    const rirOk =
      !state.settings.useRIR ||
      lastSets.every(
        (s) =>
          s.rir == null || s.rir >= (we.targetRIR != null ? we.targetRIR : 1),
      );

    if (allAtTop && rirOk) {
      return "You reached the top of the target range on all sets. Consider a harder variation, slower reps or extra resistance.";
    }
    if (before != null && cur > before) {
      return "You improved on last session. Keep the same targets and add a rep when the top of the range feels comfortable.";
    }
    if (before != null && cur < before) {
      return "Slightly below last session — that happens. Repeat the same targets and prioritise clean form.";
    }
    return "Same total as last session. Try adding one rep to one set next time.";
  }

  function recentTrends(limit) {
    const list = completedWorkouts();
    if (!list.length) return [];
    const lastW = list[list.length - 1];
    const out = [];
    for (const we of lastW.exercises) {
      const sessions = exerciseSessions(we.exerciseId);
      if (sessions.length < 2) continue;
      const cur = sessionScore(sessions[sessions.length - 1]);
      const prev = sessionScore(sessions[sessions.length - 2]);
      out.push({
        name: we.exerciseName,
        cur: cur,
        prev: prev,
        dir: cur > prev ? "up" : cur < prev ? "down" : "flat",
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  function detectPRs(workout) {
    const prior = completedWorkouts().filter((w) => w.id !== workout.id);
    const prs = [];
    if (!prior.length) return prs;

    workout.exercises.forEach((we) => {
      const done = we.sets.filter((s) => s.completed);
      if (!done.length) return;

      const priorEntries = prior
        .map((w) => w.exercises.find((e) => e.exerciseId === we.exerciseId))
        .filter(Boolean);
      if (!priorEntries.length) return;

      // Best single-set value
      const bestNow = Math.max.apply(
        null,
        done.map((s) => maxSetValue(s, we)),
      );
      const bestBefore = Math.max.apply(
        null,
        [0].concat(
          priorEntries.map((p) =>
            Math.max.apply(
              null,
              [0].concat(
                p.sets.filter((s) => s.completed).map((s) => maxSetValue(s, p)),
              ),
            ),
          ),
        ),
      );
      if (bestNow > bestBefore) {
        prs.push({
          name: we.exerciseName,
          label:
            (we.type === "timed" ? bestNow + " s" : bestNow + " reps") +
            " in one set",
          kind: "set",
        });
      }

      // Heaviest external load (only for weighted exercises)
      const weightsNow = done
        .map((s) => s.weight)
        .filter((w) => w != null && w > 0);
      if (weightsNow.length) {
        const maxNow = Math.max.apply(null, weightsNow);
        const weightsBefore = [];
        priorEntries.forEach((p) =>
          p.sets.forEach((s) => {
            if (s.completed && s.weight != null && s.weight > 0)
              weightsBefore.push(s.weight);
          }),
        );
        if (weightsBefore.length) {
          const maxBefore = Math.max.apply(null, weightsBefore);
          if (maxNow > maxBefore) {
            prs.push({
              name: we.exerciseName,
              label: kgToDisplay(maxNow) + " " + unitLabel() + " load",
              kind: "weight",
            });
          }
        }
      }
    });
    return prs;
  }

  /* ============================================================
     4. REST TIMER
     ============================================================ */
  let restTimer = {
    active: false,
    durationMs: 0,
    endAt: 0,
    remainingMs: 0,
    running: false,
  };

  function persistTimer() {
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify(restTimer));
    } catch (_) {
      /* ignore */
    }
  }
  function restoreTimer() {
    try {
      const raw = localStorage.getItem(TIMER_KEY);
      if (!raw) return;
      const t = JSON.parse(raw);
      if (t && t.active && Number.isFinite(t.durationMs)) {
        restTimer = {
          active: true,
          durationMs: t.durationMs,
          endAt: Number(t.endAt) || 0,
          remainingMs: Number(t.remainingMs) || 0,
          running: !!t.running,
        };
        if (restTimer.running && restTimer.endAt <= Date.now()) {
          restTimer.running = false;
          restTimer.remainingMs = 0;
        }
      }
    } catch (_) {
      /* ignore */
    }
  }

  let restAutoCloseTimer = null;

  function startRest(seconds) {
    clearTimeout(restAutoCloseTimer);
    const secs = clampNum(
      Math.round(seconds || state.settings.defaultRest || 60),
      5,
      1800,
    );
    restTimer = {
      active: true,
      durationMs: secs * 1000,
      endAt: Date.now() + secs * 1000,
      remainingMs: secs * 1000,
      running: true,
    };
    persistTimer();
    updateTimerBar();
  }
  function toggleTimerPause() {
    clearTimeout(restAutoCloseTimer);
    if (!restTimer.active) return;
    if (restTimer.running) {
      restTimer.remainingMs = Math.max(0, restTimer.endAt - Date.now());
      restTimer.running = false;
    } else {
      restTimer.endAt = Date.now() + restTimer.remainingMs;
      restTimer.running = true;
      if (restTimer.remainingMs <= 0) {
        restTimer.remainingMs = restTimer.durationMs;
        restTimer.endAt = Date.now() + restTimer.durationMs;
      }
    }
    persistTimer();
    updateTimerBar();
  }
  function pauseRestTimer() {
    if (restTimer.active && restTimer.running) {
      restTimer.remainingMs = Math.max(0, restTimer.endAt - Date.now());
      restTimer.running = false;
      persistTimer();
      updateTimerBar();
    }
  }
  function addRestTime(seconds) {
    clearTimeout(restAutoCloseTimer);
    if (!restTimer.active) return;
    if (restTimer.running) {
      restTimer.endAt += seconds * 1000;
      restTimer.durationMs = Math.max(
        restTimer.durationMs,
        restTimer.endAt - Date.now(),
      );
    } else {
      restTimer.remainingMs = Math.max(
        0,
        restTimer.remainingMs + seconds * 1000,
      );
    }
    persistTimer();
    updateTimerBar();
  }
  function skipRest() {
    clearTimeout(restAutoCloseTimer);
    restTimer = {
      active: false,
      durationMs: 0,
      endAt: 0,
      remainingMs: 0,
      running: false,
    };
    persistTimer();
    updateTimerBar();
  }
  function restRemainingMs() {
    if (!restTimer.active) return 0;
    return restTimer.running
      ? Math.max(0, restTimer.endAt - Date.now())
      : restTimer.remainingMs;
  }

  let audioCtx = null;
  function beep() {
    if (!state.settings.sound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        audioCtx.currentTime + 0.55,
      );
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.6);
    } catch (_) {
      /* ignore */
    }
  }
  function vibrate(pattern) {
    if (!state.settings.vibration) return;
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (_) {
        /* ignore */
      }
    }
  }

  function buildRestPopupHTML() {
    const size = 220;
    const r = 95;
    const stroke = 12;
    const c = 2 * Math.PI * r;
    const remaining = restRemainingMs();
    const pct = clampNum(remaining / (restTimer.durationMs || 1), 0, 1);
    const offset = c * (1 - pct);
    const label =
      remaining <= 0
        ? "Rest complete"
        : restTimer.running
          ? "Resting"
          : "Paused";
    return (
      '<div class="rest-card" role="dialog" aria-modal="true" aria-label="Rest timer">' +
      '<div class="rest-ring-wrap">' +
      '<svg viewBox="0 0 ' +
      size +
      " " +
      size +
      '" class="rest-ring" aria-hidden="true">' +
      '<circle class="rest-ring-bg" cx="' +
      size / 2 +
      '" cy="' +
      size / 2 +
      '" r="' +
      r +
      '" stroke-width="' +
      stroke +
      '"/>' +
      '<circle class="rest-ring-fg" cx="' +
      size / 2 +
      '" cy="' +
      size / 2 +
      '" r="' +
      r +
      '" stroke-width="' +
      stroke +
      '" stroke-dasharray="' +
      c +
      '" stroke-dashoffset="' +
      offset.toFixed(2) +
      '" transform="rotate(-90 ' +
      size / 2 +
      " " +
      size / 2 +
      ')"/>' +
      "</svg>" +
      '<div class="rest-center">' +
      '<div class="rest-time">' +
      fmtClock(remaining) +
      "</div>" +
      '<div class="rest-sub">' +
      label +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="rest-actions">' +
      '<button class="btn" data-action="timer-add" data-secs="-15">−15s</button>' +
      '<button class="btn" data-action="timer-toggle">' +
      (restTimer.running ? "Pause" : "Resume") +
      "</button>" +
      '<button class="btn" data-action="timer-add" data-secs="15">+15s</button>' +
      "</div>" +
      '<button class="btn primary big" data-action="timer-skip">Skip rest</button>' +
      "</div>"
    );
  }

  function refreshRestPopup() {
    const root = $("#rest-popup-root");
    if (!root || root.hidden) return;
    const remaining = restRemainingMs();
    const pct = clampNum(remaining / (restTimer.durationMs || 1), 0, 1);
    const r = 95;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - pct);
    const fg = root.querySelector(".rest-ring-fg");
    if (fg) fg.setAttribute("stroke-dashoffset", String(offset.toFixed(2)));
    const t = root.querySelector(".rest-time");
    if (t) t.textContent = fmtClock(remaining);
    const s = root.querySelector(".rest-sub");
    if (s)
      s.textContent =
        remaining <= 0
          ? "Rest complete"
          : restTimer.running
            ? "Resting"
            : "Paused";
    const tb = root.querySelector('[data-action="timer-toggle"]');
    if (tb) tb.textContent = restTimer.running ? "Pause" : "Resume";
  }

  function updateTimerBar() {
    const root = $("#rest-popup-root");
    if (!root) return;
    if (!restTimer.active) {
      if (!root.hidden) {
        root.hidden = true;
        root.innerHTML = "";
      }
      return;
    }
    if (root.hidden) {
      root.innerHTML = buildRestPopupHTML();
      root.hidden = false;
    }
    refreshRestPopup();
  }

  let timerFinishedFlag = false;
  function tick() {
    // Workout elapsed
    const elapsedEl = document.getElementById("wo-elapsed");
    if (elapsedEl && state.activeWorkout) {
      elapsedEl.textContent = fmtClock(workoutElapsedMs(state.activeWorkout));
    }
    // Rest timer
    if (restTimer.active) {
      if (restTimer.running && restTimer.endAt <= Date.now()) {
        restTimer.running = false;
        restTimer.remainingMs = 0;
        persistTimer();
        if (!timerFinishedFlag) {
          timerFinishedFlag = true;
          beep();
          vibrate([200, 100, 200]);
          toast("Rest finished", "ok", 2200);
          clearTimeout(restAutoCloseTimer);
          restAutoCloseTimer = setTimeout(() => {
            if (
              restTimer.active &&
              !restTimer.running &&
              restRemainingMs() === 0
            ) {
              skipRest();
            }
          }, 1800);
          setTimeout(() => {
            timerFinishedFlag = false;
          }, 2200);
        }
      }
      updateTimerBar();
    }
  }

  /* ============================================================
     5. UI PRIMITIVES
     ============================================================ */
  function toast(message, type, ms) {
    const root = $("#toast-root");
    if (!root) return;
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = message;
    root.appendChild(el);
    const timeout = ms || 3200;
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 280);
    }, timeout);
  }

  let modalResolver = null;
  function openModal(opts) {
    const root = $("#modal-root");
    root.innerHTML =
      '<div class="modal-backdrop" data-modal-backdrop>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
      '<div class="modal-head">' +
      '<h2 id="modal-title">' +
      esc(opts.title || "") +
      "</h2>" +
      '<button class="icon-btn" data-action="close-modal" aria-label="Close">✕</button>' +
      "</div>" +
      '<div class="modal-body">' +
      (opts.body || "") +
      "</div>" +
      (opts.footer ? '<div class="modal-foot">' + opts.footer + "</div>" : "") +
      "</div>" +
      "</div>";
    document.body.classList.add("modal-open");
    if (opts.onMount) opts.onMount($(".modal", root));
    // focus first input
    const firstInput = $(
      ".modal-body input, .modal-body select, .modal-body textarea",
      root,
    );
    if (firstInput) setTimeout(() => firstInput.focus(), 40);
  }

  function closeModal() {
    const root = $("#modal-root");
    if (!root) return;
    root.innerHTML = "";
    document.body.classList.remove("modal-open");
    if (modalResolver) {
      const r = modalResolver;
      modalResolver = null;
      r(false);
    }
  }

  function confirmDialog(opts) {
    return new Promise((resolve) => {
      modalResolver = resolve;
      openModal({
        title: opts.title,
        body: "<p>" + (opts.message || "") + "</p>",
        footer:
          '<button class="btn" data-confirm="0">Cancel</button>' +
          '<button class="btn ' +
          (opts.danger ? "danger" : "primary") +
          '" data-confirm="1">' +
          esc(opts.confirmLabel || "Confirm") +
          "</button>",
        onMount(el) {
          $$("[data-confirm]", el).forEach((btn) => {
            btn.addEventListener("click", () => {
              const ok = btn.dataset.confirm === "1";
              modalResolver = null;
              closeModal();
              resolve(ok);
            });
          });
        },
      });
    });
  }

  /* ---- undo ---- */
  function pushUndo(label) {
    if (!state.activeWorkout) return;
    undoStack.push({
      label: label || "Change",
      snapshot: JSON.stringify(state.activeWorkout),
    });
    if (undoStack.length > 25) undoStack.shift();
    showUndoBar(label || "Change");
  }
  function showUndoBar(label) {
    const bar = $("#undobar");
    const text = $("#undobar-text");
    if (!bar || !text) return;
    text.textContent = label;
    bar.hidden = false;
    clearTimeout(undoHideTimer);
    undoHideTimer = setTimeout(() => {
      bar.hidden = true;
    }, 9000);
  }
  function hideUndoBar() {
    const bar = $("#undobar");
    if (bar) bar.hidden = true;
    clearTimeout(undoHideTimer);
  }
  function performUndo() {
    const item = undoStack.pop();
    if (!item) {
      hideUndoBar();
      return;
    }
    try {
      state.activeWorkout = JSON.parse(item.snapshot);
    } catch (_) {
      return;
    }
    save();
    hideUndoBar();
    render();
    toast("Undone", "ok", 1600);
  }

  /* ---- media processing ---- */
  function processMediaFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("No file"));
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error("File too large (max 10 MB)"));
        return;
      }
      const isGif = /gif/i.test(file.type) || /\.gif$/i.test(file.name);
      if (isGif) {
        if (file.size > 500 * 1024) {
          toast(
            "This GIF is " +
              fmtBytes(file.size) +
              " — GIFs can fill browser storage quickly. A smaller file is safer.",
            "",
            5500,
          );
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("Read failed"));
        reader.readAsDataURL(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const MAX = 800;
            let width = img.width;
            let height = img.height;
            if (width > MAX || height > MAX) {
              if (width > height) {
                height = Math.round((height * MAX) / width);
                width = MAX;
              } else {
                width = Math.round((width * MAX) / height);
                height = MAX;
              }
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#0f1318";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", 0.78));
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error("Image decode failed"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(reader.error || new Error("Read failed"));
      reader.readAsDataURL(file);
    });
  }

  /* ---- downloading ---- */
  function download(filename, content, mime) {
    const blob = new Blob([content], {
      type: mime || "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 400);
  }

  /* ============================================================
     6. ROUTER
     ============================================================ */
  function parseHash() {
    const raw = (location.hash || "#/dashboard").replace(/^#\/?/, "");
    const qIndex = raw.indexOf("?");
    const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    const queryPart = qIndex >= 0 ? raw.slice(qIndex + 1) : "";
    const parts = pathPart.split("/").filter(Boolean);
    return {
      name: parts[0] || "dashboard",
      param: parts[1] || null,
      query: new URLSearchParams(queryPart),
    };
  }

  function updateNav(route) {
    let tab = route.name;
    if (tab === "routine") tab = "routines";
    if (tab === "exercises") tab = "routines";
    if (tab === "history") tab = "progress";
    $$(".tab").forEach((el) => {
      el.classList.toggle("active", el.dataset.tab === tab);
    });
  }

  function render() {
    const route = parseHash();
    currentRoute = route;
    const view = $("#view");
    if (!view) return;

    const scrollY = window.scrollY;
    const routeKey = route.name + "/" + (route.param || "");
    const sameRoute = routeKey === previousRouteKey;

    let html = "";
    switch (route.name) {
      case "workout":
        html = viewWorkout();
        break;
      case "routines":
        html = viewRoutines();
        break;
      case "routine":
        html = viewRoutineEditor(route.param);
        break;
      case "exercises":
        html = viewExercises();
        break;
      case "progress":
        html = viewProgress(route.query);
        break;
      case "history":
        html = viewHistoryDetail(route.param);
        break;
      case "settings":
        html = viewSettings();
        break;
      default:
        html = viewDashboard();
    }

    view.innerHTML = html;
    updateNav(route);
    updateTimerBar();

    if (sameRoute) {
      window.scrollTo(0, scrollY);
    } else {
      window.scrollTo(0, 0);
    }
    previousRouteKey = routeKey;
  }

  /* ============================================================
     7. VIEW — DASHBOARD
     ============================================================ */
  function viewDashboard() {
    const next = nextRoutine();
    const last = lastCompletedWorkout();
    const week = workoutsThisWeek();
    const target = state.settings.weeklyTarget || 3;
    const history = completedWorkouts().slice(-6).reverse();
    const trends = recentTrends(4);
    const active = state.activeWorkout;

    let heroHtml;
    if (active) {
      const done = active.exercises.reduce(
        (n, e) => n + e.sets.filter((s) => s.completed).length,
        0,
      );
      heroHtml =
        '<section class="hero-card">' +
        '<div class="hero-label">Workout in progress</div>' +
        '<h1 class="hero-title">' +
        esc(active.routineName) +
        "</h1>" +
        '<div class="hero-sub">Started ' +
        fmtTime(active.startTime) +
        " · " +
        done +
        " sets logged</div>" +
        '<a class="btn primary big" href="#/workout">Continue workout</a>' +
        "</section>";
    } else if (next) {
      heroHtml =
        '<section class="hero-card">' +
        '<div class="hero-label">Next workout</div>' +
        '<h1 class="hero-title">' +
        esc(next.name) +
        "</h1>" +
        '<div class="hero-sub">' +
        (next.description ? esc(next.description) + " · " : "") +
        next.exercises.length +
        " exercise" +
        (next.exercises.length === 1 ? "" : "s") +
        "</div>" +
        '<button class="btn primary big" data-action="start-workout" data-routine="' +
        next.id +
        '">Start Workout</button>' +
        '<div class="btn-row" style="margin-top:8px">' +
        '<button class="btn ghost small" data-action="choose-routine">Choose another routine</button>' +
        "</div>" +
        "</section>";
    } else {
      heroHtml =
        '<section class="hero-card">' +
        '<div class="hero-label">Get started</div>' +
        '<h1 class="hero-title">No routines yet</h1>' +
        '<div class="hero-sub">Create a routine to begin tracking your training.</div>' +
        '<a class="btn primary big" href="#/routine/new">Create a routine</a>' +
        "</section>";
    }

    let lastHtml;
    if (last) {
      const sets = last.exercises.reduce(
        (n, e) => n + e.sets.filter((s) => s.completed).length,
        0,
      );
      const exDone = last.exercises.filter(
        (e) => e.sets.length && e.sets.every((s) => s.completed),
      ).length;
      lastHtml =
        '<a href="#/history/' +
        last.id +
        '" style="text-decoration:none;color:inherit">' +
        '<div class="li-title">' +
        esc(last.routineName) +
        "</div>" +
        '<div class="li-sub">' +
        fmtDate(last.startTime) +
        " · " +
        fmtDur(last.durationMs) +
        "</div>" +
        '<div class="li-sub">' +
        exDone +
        " exercises · " +
        sets +
        " sets</div>" +
        "</a>";
    } else {
      lastHtml = '<div class="muted small">No completed workouts yet.</div>';
    }

    let trendHtml;
    if (trends.length) {
      trendHtml = trends
        .map(
          (t) =>
            '<div class="list-item">' +
            '<div class="li-main"><div class="li-title">' +
            esc(t.name) +
            "</div>" +
            '<div class="li-sub">' +
            t.prev +
            " → " +
            t.cur +
            "</div></div>" +
            '<span class="pill ' +
            (t.dir === "up" ? "up" : t.dir === "down" ? "down" : "") +
            '">' +
            (t.dir === "up" ? "▲ up" : t.dir === "down" ? "▼ down" : "• same") +
            "</span>" +
            "</div>",
        )
        .join("");
    } else {
      trendHtml =
        '<div class="muted small">Complete a couple of sessions to see trends.</div>';
    }

    let historyHtml;
    if (history.length) {
      historyHtml =
        '<ul class="list">' +
        history
          .map((w) => {
            const sets = w.exercises.reduce(
              (n, e) => n + e.sets.filter((s) => s.completed).length,
              0,
            );
            return (
              '<li class="list-item">' +
              '<div class="li-main">' +
              '<a href="#/history/' +
              w.id +
              '">' +
              '<div class="li-title">' +
              esc(w.routineName) +
              "</div>" +
              '<div class="li-sub">' +
              fmtDate(w.startTime) +
              " · " +
              fmtDur(w.durationMs) +
              " · " +
              sets +
              " sets</div>" +
              "</a>" +
              "</div>" +
              '<span class="pill">' +
              (w.status === "completed" ? "Done" : "Partial") +
              "</span>" +
              "</li>"
            );
          })
          .join("") +
        "</ul>";
    } else {
      historyHtml =
        '<div class="muted small">Your completed workouts will appear here.</div>';
    }

    return (
      "" +
      heroHtml +
      '<div class="grid-2">' +
      '<section class="card">' +
      '<div class="card-head"><h3>This week</h3></div>' +
      '<div class="stat-row"><span class="big-num">' +
      week.length +
      '</span><span class="stat-label">/ ' +
      target +
      " workouts</span>" +
      (week.length > target
        ? '<span class="pill up">✓ +' + (week.length - target) + "</span>"
        : "") +
      "</div>" +
      '<div class="progress" style="margin-top:10px"><div class="progress-fill" style="width:' +
      clampNum((week.length / (target || 1)) * 100, 0, 100) +
      '%"></div></div>' +
      "</section>" +
      '<section class="card">' +
      '<div class="card-head"><h3>Last workout</h3></div>' +
      lastHtml +
      "</section>" +
      "</div>" +
      '<section class="card">' +
      '<div class="card-head"><h3>Recent progress</h3><a class="small muted" href="#/progress">Details</a></div>' +
      trendHtml +
      "</section>" +
      '<section class="card">' +
      '<div class="card-head"><h3>History</h3></div>' +
      historyHtml +
      "</section>"
    );
  }

  /* ============================================================
     8. VIEW — LIVE WORKOUT
     ============================================================ */
  function viewWorkout() {
    const w = state.activeWorkout;
    if (!w) {
      if (!state.routines.length) {
        return (
          '<div class="empty-state"><h2>No routines yet</h2><p>Create a routine first.</p>' +
          '<a class="btn primary" href="#/routine/new">Create routine</a></div>'
        );
      }
      return (
        '<div class="empty-state">' +
        "<h2>No active workout</h2>" +
        "<p>Pick a routine to start.</p>" +
        '<div class="btn-stack" style="max-width:340px;margin:16px auto 0">' +
        state.routines
          .map(
            (r) =>
              '<button class="btn" data-action="start-workout" data-routine="' +
              r.id +
              '">' +
              esc(r.name) +
              "</button>",
          )
          .join("") +
        "</div>" +
        "</div>"
      );
    }

    const totalSets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
    const doneSets = w.exercises.reduce(
      (n, e) => n + e.sets.filter((s) => s.completed).length,
      0,
    );
    const doneEx = w.exercises.filter(
      (e) => e.sets.length && e.sets.every((s) => s.completed),
    ).length;
    const paused = !!w.pausedAt;

    const header =
      '<section class="wo-sticky">' +
      '<div class="wo-sticky-row">' +
      '<div class="wo-sticky-info">' +
      '<div class="wo-sticky-name">' +
      esc(w.routineName) +
      (paused ? ' · <span class="warn">Paused</span>' : "") +
      "</div>" +
      '<div class="wo-sticky-meta">' +
      '<span id="wo-elapsed" class="wo-sticky-timer">' +
      fmtClock(workoutElapsedMs(w)) +
      "</span>" +
      '<span class="wo-sticky-sep">·</span>' +
      "<span>" +
      doneEx +
      " / " +
      w.exercises.length +
      " ex</span>" +
      '<span class="wo-sticky-sep">·</span>' +
      "<span>" +
      doneSets +
      " / " +
      totalSets +
      " sets</span>" +
      "</div>" +
      "</div>" +
      '<div class="wo-sticky-actions">' +
      '<button class="btn small" data-action="toggle-pause">' +
      (paused ? "Resume" : "Pause") +
      "</button>" +
      '<button class="btn small primary" data-action="finish-workout">Finish</button>' +
      "</div>" +
      "</div>" +
      '<div class="wo-sticky-progress">' +
      '<div class="wo-sticky-progress-fill" style="width:' +
      (totalSets ? (doneSets / totalSets) * 100 : 0) +
      '%"></div>' +
      "</div>" +
      "</section>";

    const totalEx = w.exercises.length;
    let idx = w.currentExerciseIndex || 0;
    idx = Math.max(0, Math.min(totalEx - 1, idx));
    const currentWE = w.exercises[idx];

    const navBar =
      '<div class="slide-nav">' +
      '<button class="slide-nav-btn" data-action="prev-exercise"' +
      (idx === 0 ? " disabled" : "") +
      ' aria-label="Previous exercise">‹</button>' +
      '<div class="slide-nav-center">' +
      '<div class="slide-nav-counter">' +
      (idx + 1) +
      " / " +
      totalEx +
      "</div>" +
      '<div class="slide-dots">' +
      w.exercises
        .map(function (_, i) {
          var cls =
            "slide-dot" +
            (i === idx ? " active" : "") +
            (i < idx ? " done" : "");
          return '<span class="' + cls + '"></span>';
        })
        .join("") +
      "</div>" +
      "</div>" +
      '<button class="slide-nav-btn" data-action="next-exercise"' +
      (idx === totalEx - 1 ? " disabled" : "") +
      ' aria-label="Next exercise">›</button>' +
      "</div>";

    const allDone =
      currentWE &&
      currentWE.sets.length &&
      currentWE.sets.every((s) => s.completed);
    const nextBtnHtml =
      idx < totalEx - 1
        ? '<button class="btn ' +
          (allDone ? "primary" : "ghost") +
          ' big slide-next-btn" data-action="next-exercise">' +
          (allDone ? "Next exercise →" : "Skip to next →") +
          "</button>"
        : "";

    return (
      header +
      navBar +
      '<div id="exercise-list">' +
      (currentWE ? exerciseCardHTML(w, currentWE) : "") +
      "</div>" +
      nextBtnHtml +
      '<div class="wo-footer">' +
      '<button class="btn" data-action="finish-workout">Finish workout</button>' +
      '<button class="btn danger" data-action="discard-workout">Discard</button>' +
      "</div>"
    );
  }

  function exerciseCardHTML(w, we) {
    const ex = getExercise(we.exerciseId);
    const prev = findPreviousExerciseEntry(we.exerciseId, w.id);
    const prevHtml = prev
      ? previousSummaryHTML(prev)
      : '<span class="muted">No previous record for this exercise.</span>';
    const suggestion = progressionSuggestion(we);
    const fields = valueFields(we);
    const showWeight = we.equipment && we.equipment !== "Bodyweight";
    const useRIR = !!state.settings.useRIR;
    const cols = fields.length + (showWeight ? 1 : 0) + (useRIR ? 1 : 0);
    const completedCount = we.sets.filter((s) => s.completed).length;
    const mediaSrc = (ex && ex.media) || we.media || "";
    const mediaHtml = mediaSrc
      ? '<div class="ex-media"><img src="' +
        mediaSrc +
        '" alt="' +
        esc(we.exerciseName) +
        '" loading="lazy"></div>'
      : "";

    return (
      "" +
      '<section class="card ex-card" data-ex-id="' +
      we.id +
      '">' +
      '<div class="ex-head">' +
      '<div class="ex-title">' +
      "<h2>" +
      esc(we.exerciseName) +
      (we.unilateral ? '<span class="tag">per side</span>' : "") +
      "</h2>" +
      '<div class="muted small">' +
      esc((ex && ex.muscles ? ex.muscles.join(" · ") : "") || "—") +
      " · target " +
      esc(targetText(we)) +
      "</div>" +
      "</div>" +
      '<div class="ex-count' +
      (completedCount === we.sets.length && we.sets.length ? " complete" : "") +
      '">' +
      completedCount +
      "/" +
      we.sets.length +
      "</div>" +
      "</div>" +
      mediaHtml +
      (we.notes ? '<p class="note small">' + esc(we.notes) + "</p>" : "") +
      '<div class="prev small"><strong>Last:</strong> ' +
      prevHtml +
      "</div>" +
      (suggestion
        ? '<div class="suggestion small">' + esc(suggestion) + "</div>"
        : "") +
      '<div class="set-head-row">' +
      "<div>#</div>" +
      '<div class="set-fields" style="--cols:' +
      cols +
      '">' +
      fields.map((f) => "<span>" + esc(fieldLabel(f)) + "</span>").join("") +
      (showWeight ? "<span>" + esc(unitLabel()) + "</span>" : "") +
      (useRIR ? "<span>RIR</span>" : "") +
      "</div>" +
      "<div></div>" +
      "</div>" +
      '<div class="set-list">' +
      we.sets
        .map((s, i) => setRowHTML(w, we, s, i, showWeight, useRIR))
        .join("") +
      "</div>" +
      '<div class="ex-actions">' +
      '<button class="btn small" data-action="add-set" data-ex="' +
      we.id +
      '">+ Set</button>' +
      '<button class="btn small" data-action="start-rest" data-ex="' +
      we.id +
      '">Rest ' +
      (we.rest || state.settings.defaultRest) +
      "s</button>" +
      '<button class="btn small ghost" data-action="edit-ex-notes" data-ex="' +
      we.id +
      '">Note</button>' +
      "</div>" +
      "</section>"
    );
  }

  function setRowHTML(w, we, set, index, showWeight, useRIR) {
    const fields = valueFields(we);
    const cols = fields.length + (showWeight ? 1 : 0) + (useRIR ? 1 : 0);

    const inputs = fields
      .map((f) => {
        const val = set[f] == null ? "" : set[f];
        return (
          '<div class="stepper">' +
          '<button type="button" class="stepper-btn" data-step="-1" tabindex="-1" aria-label="Decrease ' +
          esc(fieldLabel(f)) +
          '">−</button>' +
          '<input type="number" inputmode="decimal" min="0" step="1" class="set-input' +
          (set.prefilled && val !== "" ? " prefilled" : "") +
          '"' +
          ' data-field="' +
          f +
          '" value="' +
          val +
          '"' +
          ' placeholder="—" aria-label="' +
          esc(fieldLabel(f)) +
          " set " +
          (index + 1) +
          '">' +
          '<button type="button" class="stepper-btn" data-step="1" tabindex="-1" aria-label="Increase ' +
          esc(fieldLabel(f)) +
          '">+</button>' +
          "</div>"
        );
      })
      .join("");

    const weightInput = showWeight
      ? '<div class="stepper">' +
        '<button type="button" class="stepper-btn" data-step="-0.5" tabindex="-1" aria-label="Decrease load">−</button>' +
        '<input type="number" inputmode="decimal" min="0" step="0.5" class="set-input' +
        (set.prefilled && set.weight != null ? " prefilled" : "") +
        '"' +
        ' data-field="weight" value="' +
        (set.weight == null ? "" : kgToDisplay(set.weight)) +
        '"' +
        ' placeholder="0" aria-label="External load set ' +
        (index + 1) +
        '">' +
        '<button type="button" class="stepper-btn" data-step="0.5" tabindex="-1" aria-label="Increase load">+</button>' +
        "</div>"
      : "";

    const rirInput = useRIR
      ? '<div class="stepper">' +
        '<button type="button" class="stepper-btn" data-step="-1" tabindex="-1" aria-label="Decrease RIR">−</button>' +
        '<input type="number" inputmode="numeric" min="0" max="10" step="1" class="set-input"' +
        ' data-field="rir" value="' +
        (set.rir == null ? "" : set.rir) +
        '"' +
        ' placeholder="–" aria-label="Reps in reserve set ' +
        (index + 1) +
        '">' +
        '<button type="button" class="stepper-btn" data-step="1" tabindex="-1" aria-label="Increase RIR">+</button>' +
        "</div>"
      : "";

    return (
      '<div class="set-grid set-row' +
      (set.completed ? " done" : "") +
      '" data-set-id="' +
      set.id +
      '">' +
      '<div class="set-idx">' +
      (index + 1) +
      "</div>" +
      '<div class="set-fields" style="--cols:' +
      cols +
      '">' +
      inputs +
      weightInput +
      rirInput +
      "</div>" +
      '<button class="set-check" data-action="toggle-set" data-ex="' +
      we.id +
      '" data-set="' +
      set.id +
      '"' +
      ' aria-pressed="' +
      (set.completed ? "true" : "false") +
      '"' +
      ' aria-label="Mark set ' +
      (index + 1) +
      " " +
      (set.completed ? "incomplete" : "complete") +
      '">' +
      (set.completed ? ICON_CHECK : ICON_CIRCLE) +
      "</button>" +
      "</div>"
    );
  }

  function previousSummaryHTML(prev) {
    const sets = prev.exercise.sets.filter((s) => s.completed);
    if (!sets.length) {
      return (
        '<span class="muted">no completed sets (' +
        fmtDateShort(prev.workout.startTime) +
        ")</span>"
      );
    }
    const values = sets.map((s) => fmtSetValue(s, prev.exercise)).join(" · ");
    const weights = sets.map((s) => s.weight).filter((x) => x != null && x > 0);
    let weightText = "";
    if (weights.length) {
      const unique = Array.from(new Set(weights));
      if (unique.length === 1)
        weightText = " @ " + kgToDisplay(unique[0]) + " " + unitLabel();
    }
    return (
      esc(values + weightText) +
      ' <span class="muted">(' +
      fmtDateShort(prev.workout.startTime) +
      ")</span>"
    );
  }

  /* ---- workout actions ---- */
  function buildSetsFromRoutine(rx, prevExercise, ex) {
    const targetReps = rx.repMax != null ? rx.repMax : rx.repMin;
    const sets = [];
    for (let i = 0; i < rx.sets; i++) {
      const set = {
        id: uid("s"),
        reps: null,
        repsL: null,
        repsR: null,
        duration: null,
        durationL: null,
        durationR: null,
        distance: null,
        distanceL: null,
        distanceR: null,
        weight: null,
        rir: null,
        completed: false,
        completedAt: null,
        prefilled: false,
      };
      // Prefill from the equivalent set of the previous session (suggestion only)
      if (
        prevExercise &&
        prevExercise.sets[i] &&
        prevExercise.sets[i].completed
      ) {
        const p = prevExercise.sets[i];
        [
          "reps",
          "repsL",
          "repsR",
          "duration",
          "durationL",
          "durationR",
          "distance",
          "distanceL",
          "distanceR",
          "weight",
        ].forEach((k) => {
          if (p[k] != null) {
            set[k] = p[k];
            set.prefilled = true;
          }
        });
        if (p.rir != null) set.rir = p.rir;
      }
      if (!set.prefilled) {
        // If the exercise has a load, remember the most recent load as a suggestion
        if (prevExercise) {
          const lastWeighted = prevExercise.sets
            .filter((s) => s.completed && s.weight != null)
            .pop();
          if (lastWeighted) {
            set.weight = lastWeighted.weight;
            set.prefilled = true;
          }
        }
      }
      sets.push(set);
    }
    return sets;
  }

  function startWorkout(routineId) {
    const routine = getRoutine(routineId);
    if (!routine) {
      toast("Routine not found", "error");
      return;
    }
    if (state.activeWorkout) {
      confirmDialog({
        title: "Workout already in progress",
        message:
          "Discard the current workout and start <strong>" +
          esc(routine.name) +
          "</strong>?",
        confirmLabel: "Discard & start",
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        state.activeWorkout = null;
        save();
        startWorkout(routineId);
      });
      return;
    }

    const now = new Date();
    const workout = {
      id: uid("w"),
      routineId: routine.id,
      routineName: routine.name,
      date: toISODate(now),
      startTime: now.toISOString(),
      endTime: null,
      pausedAt: null,
      totalPausedMs: 0,
      durationMs: 0,
      status: "active",
      notes: "",
      currentExerciseIndex: 0,
      exercises: routine.exercises.map((rx) => {
        const ex = getExercise(rx.exerciseId) || {};
        const prev = findPreviousExerciseEntry(rx.exerciseId, null);
        const we = {
          id: uid("we"),
          exerciseId: rx.exerciseId,
          exerciseName: ex.name || "Unknown exercise",
          equipment: ex.equipment || "Bodyweight",
          unilateral: !!ex.unilateral,
          type: ex.type || "reps",
          repMin: rx.repMin,
          repMax: rx.repMax,
          targetRIR: rx.targetRIR,
          rest: rx.rest || state.settings.defaultRest,
          notes: rx.notes || "",
          sets: [],
        };
        we.sets = buildSetsFromRoutine(rx, prev ? prev.exercise : null, ex);
        return we;
      }),
    };

    state.activeWorkout = workout;
    undoStack = [];
    save(true);
    location.hash = "#/workout";
    if (location.hash === "#/workout") render();
    toast("Workout started", "ok", 1800);
  }

  function findWE(exId) {
    if (!state.activeWorkout) return null;
    return state.activeWorkout.exercises.find((e) => e.id === exId) || null;
  }

  function navigateExercise(delta) {
    if (!state.activeWorkout) return;
    const total = state.activeWorkout.exercises.length;
    if (!total) return;
    const cur = state.activeWorkout.currentExerciseIndex || 0;
    const next = Math.max(0, Math.min(total - 1, cur + delta));
    if (next === cur) return;
    state.activeWorkout.currentExerciseIndex = next;
    save();
    render();
    window.scrollTo(0, 0);
  }

  let lastToggle = { id: null, at: 0 };
  function toggleSet(exId, setId) {
    const w = state.activeWorkout;
    if (!w) return;
    const we = w.exercises.find((e) => e.id === exId);
    if (!we) return;
    const set = we.sets.find((s) => s.id === setId);
    if (!set) return;

    // Guard against accidental double taps
    const now = Date.now();
    if (lastToggle.id === setId && now - lastToggle.at < 400) return;
    lastToggle = { id: setId, at: now };

    if (!set.completed) {
      if (!setHasValue(set, we)) {
        toast("Enter a value for this set first", "error", 2400);
        return;
      }
      pushUndo("Set " + (we.sets.indexOf(set) + 1) + " completed");
      set.completed = true;
      set.completedAt = new Date().toISOString();
      set.prefilled = false;
      if (state.settings.autoStartRest && !w.pausedAt) {
        startRest(we.rest || state.settings.defaultRest);
      }
      vibrate(30);
    } else {
      pushUndo("Set " + (we.sets.indexOf(set) + 1) + " reopened");
      set.completed = false;
      set.completedAt = null;
    }
    save();
    render();
  }

  function addSet(exId) {
    const we = findWE(exId);
    if (!we) return;
    pushUndo("Set added");
    const last = we.sets[we.sets.length - 1];
    const newSet = {
      id: uid("s"),
      reps: null,
      repsL: null,
      repsR: null,
      duration: null,
      durationL: null,
      durationR: null,
      distance: null,
      distanceL: null,
      distanceR: null,
      weight: last && last.weight != null ? last.weight : null,
      rir: null,
      completed: false,
      completedAt: null,
      prefilled: !!(last && last.weight != null),
    };
    we.sets.push(newSet);
    save();
    render();
  }

  function removeSet(exId, setId) {
    const we = findWE(exId);
    if (!we) return;
    if (we.sets.length <= 1) {
      toast("An exercise needs at least one set", "error");
      return;
    }
    pushUndo("Set removed");
    we.sets = we.sets.filter((s) => s.id !== setId);
    save();
    render();
  }

  function togglePauseWorkout() {
    const w = state.activeWorkout;
    if (!w) return;
    if (w.pausedAt) {
      w.totalPausedMs += Date.now() - new Date(w.pausedAt).getTime();
      w.pausedAt = null;
    } else {
      w.pausedAt = new Date().toISOString();
      pauseRestTimer();
    }
    save();
    render();
  }

  function workoutTotals(w) {
    let sets = 0,
      reps = 0,
      exercisesDone = 0,
      exercisesWithSets = 0;
    w.exercises.forEach((we) => {
      const done = we.sets.filter((s) => s.completed);
      sets += done.length;
      if (done.length) exercisesWithSets++;
      if (we.sets.length && done.length === we.sets.length) exercisesDone++;
      done.forEach((s) => {
        reps += setTotalReps(s, we);
      });
    });
    return {
      sets: sets,
      reps: reps,
      exercisesDone: exercisesDone,
      exercisesWithSets: exercisesWithSets,
    };
  }

  function openFinishWorkout() {
    const w = state.activeWorkout;
    if (!w) return;
    const totals = workoutTotals(w);
    const duration = workoutElapsedMs(w);
    const prs = detectPRs(w);
    const prevSameList = completedWorkouts().filter(
      (x) => x.routineId === w.routineId,
    );
    const prevSame = prevSameList.length
      ? prevSameList[prevSameList.length - 1]
      : null;

    if (totals.sets === 0) {
      confirmDialog({
        title: "Nothing logged",
        message: "No sets are completed. Discard this workout?",
        confirmLabel: "Discard",
        danger: true,
      }).then((ok) => {
        if (ok) {
          state.activeWorkout = null;
          save(true);
          location.hash = "#/dashboard";
          render();
        }
      });
      return;
    }

    let compareHtml =
      '<p class="muted small">No previous session of this routine to compare with.</p>';
    if (prevSame) {
      const pt = workoutTotals(prevSame);
      compareHtml =
        '<table class="data">' +
        "<tr><th></th><th>This</th><th>Previous</th></tr>" +
        '<tr><td>Working sets</td><td class="mono">' +
        totals.sets +
        '</td><td class="mono">' +
        pt.sets +
        "</td></tr>" +
        '<tr><td>Recorded reps</td><td class="mono">' +
        totals.reps +
        '</td><td class="mono">' +
        pt.reps +
        "</td></tr>" +
        '<tr><td>Duration</td><td class="mono">' +
        fmtDur(duration) +
        '</td><td class="mono">' +
        fmtDur(prevSame.durationMs) +
        "</td></tr>" +
        '<tr><td>Date</td><td class="mono">' +
        fmtDateShort(w.startTime) +
        '</td><td class="mono">' +
        fmtDateShort(prevSame.startTime) +
        "</td></tr>" +
        "</table>";
    }

    const prHtml = prs.length
      ? '<ul class="list">' +
        prs
          .map(
            (p) =>
              '<li class="list-item"><div class="li-main"><div class="li-title">' +
              esc(p.name) +
              "</div>" +
              '<div class="li-sub">' +
              esc(p.label) +
              '</div></div><span class="pill up">PR</span></li>',
          )
          .join("") +
        "</ul>"
      : '<p class="muted small">No new personal records this session.</p>';

    const body =
      '<div class="summary-grid">' +
      '<div class="summary-box"><div class="k">Duration</div><div class="v">' +
      fmtDur(duration) +
      "</div></div>" +
      '<div class="summary-box"><div class="k">Working sets</div><div class="v">' +
      totals.sets +
      "</div></div>" +
      '<div class="summary-box"><div class="k">Exercises done</div><div class="v">' +
      totals.exercisesDone +
      " / " +
      w.exercises.length +
      "</div></div>" +
      '<div class="summary-box"><div class="k">Recorded reps</div><div class="v">' +
      totals.reps +
      "</div></div>" +
      "</div>" +
      '<h3 style="margin-top:14px">Personal records</h3>' +
      prHtml +
      '<h3 style="margin-top:14px">vs previous ' +
      esc(w.routineName) +
      "</h3>" +
      compareHtml +
      '<label class="field" style="margin-top:14px"><span>Workout notes (optional)</span>' +
      '<textarea id="finish-notes" placeholder="How did it feel?">' +
      esc(w.notes || "") +
      "</textarea></label>";

    openModal({
      title: "Finish workout",
      body: body,
      footer:
        '<button class="btn" data-action="close-modal">Keep training</button>' +
        '<button class="btn primary" id="save-workout-btn">Save workout</button>',
      onMount(el) {
        const btn = $("#save-workout-btn", el);
        btn.addEventListener("click", () => {
          const notes = $("#finish-notes", el).value;
          finishWorkout(notes, "completed");
        });
      },
    });
  }

  function finishWorkout(notes, status) {
    const w = state.activeWorkout;
    if (!w) return;
    w.endTime = new Date().toISOString();
    w.pausedAt = null;
    w.durationMs = workoutElapsedMs(w);
    w.status = status === "abandoned" ? "abandoned" : "completed";
    w.notes = notes || "";
    state.workouts.push(w);
    state.activeWorkout = null;
    undoStack = [];
    hideUndoBar();
    skipRest();
    save(true);
    if (window.Cloud) {
      window.Cloud.pushWorkout(w).catch(function (err) {
        toast("Cloud sync failed: " + err.message, "error", 5000);
      });
    }
    closeModal();
    location.hash = "#/dashboard";
    render();
    toast(
      w.status === "completed"
        ? "Workout saved"
        : "Workout saved as incomplete",
      "ok",
      2400,
    );
  }

  function discardWorkout() {
    const w = state.activeWorkout;
    if (!w) return;
    const totals = workoutTotals(w);
    openModal({
      title: "Discard workout",
      body:
        "<p>What should happen to this workout?</p>" +
        '<p class="muted small">' +
        totals.sets +
        ' completed set(s) will be kept in history as an incomplete session if you choose "Keep as incomplete".</p>',
      footer:
        '<button class="btn" data-action="close-modal">Cancel</button>' +
        '<button class="btn danger" id="discard-delete">Delete</button>' +
        '<button class="btn primary" id="discard-keep">Keep as incomplete</button>',
      onMount(el) {
        $("#discard-delete", el).addEventListener("click", () => {
          state.activeWorkout = null;
          undoStack = [];
          hideUndoBar();
          skipRest();
          save(true);
          closeModal();
          location.hash = "#/dashboard";
          render();
          toast("Workout discarded", "", 2000);
        });
        $("#discard-keep", el).addEventListener("click", () => {
          finishWorkout(w.notes, "abandoned");
        });
      },
    });
  }

  function openExerciseNoteModal(exId) {
    const we = findWE(exId);
    if (!we) return;
    openModal({
      title: "Note — " + we.exerciseName,
      body:
        '<label class="field"><span>Notes for this exercise in this workout</span>' +
        '<textarea id="ex-note-input" placeholder="Variation, tempo, pauses…">' +
        esc(we.notes || "") +
        "</textarea></label>",
      footer:
        '<button class="btn" data-action="close-modal">Cancel</button>' +
        '<button class="btn primary" id="save-ex-note">Save</button>',
      onMount(el) {
        $("#save-ex-note", el).addEventListener("click", () => {
          we.notes = $("#ex-note-input", el).value;
          save();
          closeModal();
          render();
        });
      },
    });
  }

  /* ============================================================
     9. VIEW — ROUTINES
     ============================================================ */
  function viewRoutines() {
    const list = state.routines
      .map((r) => {
        const count = r.exercises.length;
        return (
          '<li class="list-item">' +
          '<div class="li-main">' +
          '<a href="#/routine/' +
          r.id +
          '">' +
          '<div class="li-title">' +
          esc(r.name) +
          "</div>" +
          '<div class="li-sub">' +
          count +
          " exercise" +
          (count === 1 ? "" : "s") +
          (r.description ? " · " + esc(r.description) : "") +
          "</div>" +
          "</a>" +
          "</div>" +
          '<div class="btn-row">' +
          '<a class="btn small" href="#/routine/' +
          r.id +
          '">Edit</a>' +
          '<button class="btn small" data-action="duplicate-routine" data-id="' +
          r.id +
          '">Duplicate</button>' +
          "</div>" +
          "</li>"
        );
      })
      .join("");

    return (
      "" +
      '<div class="card-head"><h1>Routines</h1>' +
      '<a class="btn primary small" href="#/routine/new">+ New routine</a>' +
      "</div>" +
      '<section class="card">' +
      (state.routines.length
        ? '<ul class="list">' + list + "</ul>"
        : '<div class="empty-state"><p>No routines yet.</p></div>') +
      "</section>" +
      '<section class="card">' +
      '<div class="card-head"><h3>Exercise library</h3>' +
      '<a class="btn small" href="#/exercises">Manage</a>' +
      "</div>" +
      '<p class="muted small">' +
      state.exercises.length +
      " exercises available.</p>" +
      "</section>"
    );
  }

  function viewRoutineEditor(id) {
    if (id === "new") {
      if (!routineDraft || routineDraft.__new !== true) {
        routineDraft = {
          __new: true,
          id: uid("rt"),
          name: "New routine",
          description: "",
          exercises: [],
        };
      }
    } else {
      if (
        !routineDraft ||
        routineDraft.__new === true ||
        routineDraft.id !== id
      ) {
        const r = getRoutine(id);
        if (!r) {
          return '<div class="card"><p>Routine not found.</p><a class="btn" href="#/routines">Back</a></div>';
        }
        routineDraft = JSON.parse(JSON.stringify(r));
      }
    }
    const draft = routineDraft;

    const items = draft.exercises
      .map((rx, i) => {
        const ex = getExercise(rx.exerciseId);
        return (
          '<li class="list-item">' +
          '<div class="li-main">' +
          '<div class="li-title">' +
          esc(ex ? ex.name : "Missing exercise") +
          "</div>" +
          '<div class="li-sub">' +
          rx.sets +
          " sets · " +
          esc(targetText(rx)) +
          " · rest " +
          (rx.rest || 90) +
          "s" +
          (rx.notes ? " · " + esc(rx.notes) : "") +
          "</div>" +
          "</div>" +
          '<div class="btn-row">' +
          '<button class="icon-btn" data-action="rx-up" data-idx="' +
          i +
          '" aria-label="Move up">↑</button>' +
          '<button class="icon-btn" data-action="rx-down" data-idx="' +
          i +
          '" aria-label="Move down">↓</button>' +
          '<button class="btn tiny" data-action="rx-edit" data-idx="' +
          i +
          '">Edit</button>' +
          '<button class="btn tiny danger" data-action="rx-remove" data-idx="' +
          i +
          '">✕</button>' +
          "</div>" +
          "</li>"
        );
      })
      .join("");

    return (
      "" +
      '<div class="card-head">' +
      '<a class="btn small" href="#/routines">← Routines</a>' +
      "</div>" +
      '<section class="card">' +
      '<label class="field"><span>Routine name</span>' +
      '<input type="text" id="rt-name" value="' +
      esc(draft.name) +
      '" maxlength="60"></label>' +
      '<label class="field"><span>Description (optional)</span>' +
      '<input type="text" id="rt-desc" value="' +
      esc(draft.description || "") +
      '" maxlength="120"></label>' +
      "</section>" +
      '<section class="card">' +
      '<div class="card-head"><h3>Exercises</h3>' +
      '<button class="btn small primary" data-action="rx-add">+ Add exercise</button>' +
      "</div>" +
      (draft.exercises.length
        ? '<ul class="list">' + items + "</ul>"
        : '<div class="empty-state"><p>No exercises yet.</p></div>') +
      "</section>" +
      '<div class="btn-row">' +
      '<a class="btn" href="#/routines">Cancel</a>' +
      (draft.__new
        ? ""
        : '<button class="btn danger" data-action="delete-routine" data-id="' +
          draft.id +
          '">Delete routine</button>') +
      '<button class="btn primary" data-action="save-routine">Save routine</button>' +
      "</div>"
    );
  }

  function openAddExerciseModal() {
    if (!routineDraft) return;
    const options = state.exercises
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (e) =>
          '<option value="' +
          e.id +
          '">' +
          esc(e.name) +
          " — " +
          esc(e.equipment) +
          "</option>",
      )
      .join("");

    openModal({
      title: "Add exercise",
      body:
        '<label class="field"><span>Exercise</span><select id="add-ex-select">' +
        options +
        "</select></label>" +
        '<label class="field"><span>Sets</span><input type="number" id="add-ex-sets" min="1" max="20" value="' +
        state.settings.defaultSets +
        '"></label>' +
        '<div class="grid-2">' +
        '<label class="field"><span>Target min</span><input type="number" id="add-ex-min" min="0" value="' +
        state.settings.defaultRepMin +
        '"></label>' +
        '<label class="field"><span>Target max</span><input type="number" id="add-ex-max" min="0" value="' +
        state.settings.defaultRepMax +
        '"></label>' +
        "</div>" +
        '<label class="field"><span>Rest (seconds)</span><input type="number" id="add-ex-rest" min="0" max="900" value="' +
        state.settings.defaultRest +
        '"></label>' +
        '<p class="muted tiny-text">For timed exercises the target values are seconds.</p>',
      footer:
        '<button class="btn" data-action="close-modal">Cancel</button>' +
        '<button class="btn primary" id="add-ex-confirm">Add</button>',
      onMount(el) {
        $("#add-ex-confirm", el).addEventListener("click", () => {
          const exerciseId = $("#add-ex-select", el).value;
          if (!exerciseId) return;
          routineDraft.exercises.push({
            id: uid("rx"),
            exerciseId: exerciseId,
            sets: clampNum(
              parseInt($("#add-ex-sets", el).value, 10) || 3,
              1,
              20,
            ),
            repMin: numOrNull($("#add-ex-min", el).value),
            repMax: numOrNull($("#add-ex-max", el).value),
            targetRIR: null,
            rest: clampNum(
              parseInt($("#add-ex-rest", el).value, 10) || 90,
              0,
              900,
            ),
            notes: "",
          });
          closeModal();
          render();
        });
      },
    });
  }

  function openRoutineExerciseModal(index) {
    if (!routineDraft) return;
    const rx = routineDraft.exercises[index];
    if (!rx) return;
    const ex = getExercise(rx.exerciseId);
    const isTimed = ex && ex.type === "timed";

    openModal({
      title: ex ? ex.name : "Exercise",
      body:
        '<label class="field"><span>Sets</span><input type="number" id="rx-sets" min="1" max="20" value="' +
        rx.sets +
        '"></label>' +
        '<div class="grid-2">' +
        '<label class="field"><span>Target min' +
        (isTimed ? " (s)" : "") +
        "</span>" +
        '<input type="number" id="rx-min" min="0" value="' +
        (rx.repMin == null ? "" : rx.repMin) +
        '"></label>' +
        '<label class="field"><span>Target max' +
        (isTimed ? " (s)" : "") +
        "</span>" +
        '<input type="number" id="rx-max" min="0" value="' +
        (rx.repMax == null ? "" : rx.repMax) +
        '"></label>' +
        "</div>" +
        '<div class="grid-2">' +
        '<label class="field"><span>Target RIR (optional)</span>' +
        '<input type="number" id="rx-rir" min="0" max="10" value="' +
        (rx.targetRIR == null ? "" : rx.targetRIR) +
        '"></label>' +
        '<label class="field"><span>Rest (seconds)</span>' +
        '<input type="number" id="rx-rest" min="0" max="900" value="' +
        (rx.rest || 90) +
        '"></label>' +
        "</div>" +
        '<label class="field"><span>Notes (optional)</span>' +
        '<textarea id="rx-notes" placeholder="Tempo, variation, cue…">' +
        esc(rx.notes || "") +
        "</textarea></label>",
      footer:
        '<button class="btn" data-action="close-modal">Cancel</button>' +
        '<button class="btn primary" id="rx-save">Save</button>',
      onMount(el) {
        $("#rx-save", el).addEventListener("click", () => {
          rx.sets = clampNum(parseInt($("#rx-sets", el).value, 10) || 3, 1, 20);
          rx.repMin = numOrNull($("#rx-min", el).value);
          rx.repMax = numOrNull($("#rx-max", el).value);
          rx.targetRIR = numOrNull($("#rx-rir", el).value);
          rx.rest = clampNum(
            parseInt($("#rx-rest", el).value, 10) || 0,
            0,
            900,
          );
          rx.notes = $("#rx-notes", el).value;
          closeModal();
          render();
        });
      },
    });
  }

  function saveRoutineDraft() {
    if (!routineDraft) return;
    const nameInput = $("#rt-name");
    const descInput = $("#rt-desc");
    if (nameInput)
      routineDraft.name = nameInput.value.trim() || "Untitled routine";
    if (descInput) routineDraft.description = descInput.value.trim();
    if (!routineDraft.name) {
      toast("Routine needs a name", "error");
      return;
    }

    const now = new Date().toISOString();
    if (routineDraft.__new) {
      const clean = {
        id: routineDraft.id,
        name: routineDraft.name,
        description: routineDraft.description,
        exercises: routineDraft.exercises,
        createdAt: now,
        updatedAt: now,
      };
      state.routines.push(clean);
    } else {
      const idx = state.routines.findIndex((r) => r.id === routineDraft.id);
      if (idx >= 0) {
        const existing = state.routines[idx];
        state.routines[idx] = Object.assign({}, existing, {
          name: routineDraft.name,
          description: routineDraft.description,
          exercises: routineDraft.exercises,
          updatedAt: now,
        });
      }
    }
    routineDraft = null;
    save(true);
    location.hash = "#/routines";
    render();
    toast("Routine saved", "ok", 2000);
  }

  function duplicateRoutine(id) {
    const r = getRoutine(id);
    if (!r) return;
    const copy = JSON.parse(JSON.stringify(r));
    copy.id = uid("rt");
    copy.name = r.name + " (copy)";
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    copy.exercises.forEach((rx) => {
      rx.id = uid("rx");
    });
    state.routines.push(copy);
    save();
    render();
    toast("Routine duplicated", "ok", 1800);
  }

  function deleteRoutine(id) {
    const r = getRoutine(id);
    if (!r) return;
    confirmDialog({
      title: "Delete routine",
      message:
        "Delete <strong>" +
        esc(r.name) +
        "</strong>? Past workouts are not affected.",
      confirmLabel: "Delete",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      state.routines = state.routines.filter((x) => x.id !== id);
      routineDraft = null;
      save(true);
      location.hash = "#/routines";
      render();
      toast("Routine deleted", "", 1800);
    });
  }

  /* ============================================================
     10. VIEW — EXERCISE LIBRARY
     ============================================================ */
  function viewExercises() {
    const list = state.exercises
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (e) =>
          '<li class="list-item">' +
          '<div class="li-main">' +
          '<div class="li-title">' +
          esc(e.name) +
          (e.unilateral ? '<span class="tag">per side</span>' : "") +
          "</div>" +
          '<div class="li-sub">' +
          esc(e.equipment) +
          " · " +
          esc(e.type) +
          (e.muscles.length ? " · " + esc(e.muscles.join(", ")) : "") +
          "</div>" +
          "</div>" +
          '<div class="btn-row">' +
          '<button class="btn tiny" data-action="edit-exercise" data-id="' +
          e.id +
          '">Edit</button>' +
          '<button class="btn tiny danger" data-action="delete-exercise" data-id="' +
          e.id +
          '">✕</button>' +
          "</div>" +
          "</li>",
      )
      .join("");

    return (
      "" +
      '<div class="card-head">' +
      '<a class="btn small" href="#/routines">← Routines</a>' +
      '<button class="btn primary small" data-action="new-exercise">+ New exercise</button>' +
      "</div>" +
      '<section class="card">' +
      (state.exercises.length
        ? '<ul class="list">' + list + "</ul>"
        : '<p class="muted">No exercises.</p>') +
      "</section>"
    );
  }

  function openExerciseModal(exerciseId) {
    const ex = exerciseId ? getExercise(exerciseId) : null;
    const isNew = !ex;
    const e = ex || {
      name: "",
      muscles: [],
      equipment: "Bodyweight",
      type: "reps",
      unilateral: false,
      instructions: "",
      notes: "",
    };

    openModal({
      title: isNew ? "New exercise" : "Edit exercise",
      body:
        '<label class="field"><span>Name</span>' +
        '<input type="text" id="ex-name" value="' +
        esc(e.name) +
        '" maxlength="60"></label>' +
        '<label class="field"><span>Target muscles (comma separated)</span>' +
        '<input type="text" id="ex-muscles" value="' +
        esc((e.muscles || []).join(", ")) +
        '"></label>' +
        '<div class="grid-2">' +
        '<label class="field"><span>Equipment</span><select id="ex-equipment">' +
        ["Bodyweight", "Dumbbell", "Bodyweight + load", "Other"]
          .map(
            (opt) =>
              '<option value="' +
              opt +
              '"' +
              (e.equipment === opt ? " selected" : "") +
              ">" +
              opt +
              "</option>",
          )
          .join("") +
        "</select></label>" +
        '<label class="field"><span>Type</span><select id="ex-type">' +
        [
          ["reps", "Repetitions"],
          ["timed", "Timed hold"],
          ["distance", "Distance"],
        ]
          .map(
            (opt) =>
              '<option value="' +
              opt[0] +
              '"' +
              (e.type === opt[0] ? " selected" : "") +
              ">" +
              opt[1] +
              "</option>",
          )
          .join("") +
        "</select></label>" +
        "</div>" +
        '<div class="checkbox-row"><input type="checkbox" id="ex-unilateral"' +
        (e.unilateral ? " checked" : "") +
        ">" +
        '<label for="ex-unilateral">Unilateral (log left / right separately)</label></div>' +
        '<label class="field"><span>Photo or GIF (optional)</span>' +
        '<input type="file" id="ex-media-input" accept="image/*,image/gif,image/jpeg,image/png,image/webp">' +
        "</label>" +
        '<div class="ex-media-preview" id="ex-media-preview"></div>' +
        '<label class="field"><span>Instructions (optional)</span>' +
        '<textarea id="ex-instructions">' +
        esc(e.instructions || "") +
        "</textarea></label>" +
        '<label class="field"><span>Personal notes (optional)</span>' +
        '<textarea id="ex-notes">' +
        esc(e.notes || "") +
        "</textarea></label>",
      footer:
        '<button class="btn" data-action="close-modal">Cancel</button>' +
        '<button class="btn primary" id="ex-save">Save</button>',
      onMount(el) {
        let pendingMedia = e.media || "";
        const mediaInput = $("#ex-media-input", el);
        const mediaPreview = $("#ex-media-preview", el);
        function refreshMediaPreview() {
          if (pendingMedia) {
            mediaPreview.innerHTML =
              '<img src="' +
              pendingMedia +
              '" alt="Preview">' +
              '<button type="button" class="btn tiny danger" id="ex-media-remove">Remove</button>';
            $("#ex-media-remove", mediaPreview).addEventListener(
              "click",
              () => {
                pendingMedia = "";
                mediaInput.value = "";
                refreshMediaPreview();
              },
            );
          } else {
            mediaPreview.innerHTML =
              '<span class="muted small">No media uploaded</span>';
          }
        }
        refreshMediaPreview();
        mediaInput.addEventListener("change", async () => {
          const file = mediaInput.files && mediaInput.files[0];
          if (!file) return;
          mediaPreview.innerHTML =
            '<span class="muted small">Processing…</span>';
          try {
            pendingMedia = await processMediaFile(file);
            refreshMediaPreview();
          } catch (err) {
            mediaPreview.innerHTML =
              '<span class="muted small">No media uploaded</span>';
            toast("Could not process file: " + err.message, "error", 4000);
          }
        });
        $("#ex-save", el).addEventListener("click", () => {
          const name = $("#ex-name", el).value.trim();
          if (!name) {
            toast("Name is required", "error");
            return;
          }
          const payload = {
            name: name,
            muscles: $("#ex-muscles", el)
              .value.split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            equipment: $("#ex-equipment", el).value,
            type: $("#ex-type", el).value,
            unilateral: $("#ex-unilateral", el).checked,
            instructions: $("#ex-instructions", el).value,
            notes: $("#ex-notes", el).value,
            media: pendingMedia,
          };
          if (isNew) {
            state.exercises.push(
              Object.assign(
                {
                  id: uid("ex"),
                  createdAt: new Date().toISOString(),
                },
                payload,
              ),
            );
          } else {
            Object.assign(ex, payload);
          }
          save(true);
          if (window.Cloud) {
            window.Cloud.pushMedia(
              isNew
                ? state.exercises[state.exercises.length - 1].id
                : exerciseId,
              payload.media || "",
            ).catch(function (err) {
              toast("Media sync failed: " + err.message, "error", 5000);
            });
          }
          closeModal();
          render();
          toast("Exercise saved", "ok", 1800);
        });
      },
    });
  }

  function deleteExercise(id) {
    const ex = getExercise(id);
    if (!ex) return;
    const usedIn = state.routines.filter((r) =>
      r.exercises.some((rx) => rx.exerciseId === id),
    );
    confirmDialog({
      title: "Delete exercise",
      message:
        "Delete <strong>" +
        esc(ex.name) +
        "</strong>?" +
        (usedIn.length
          ? "<br><br>It is used in " +
            usedIn.length +
            " routine(s) and will be removed from them. Past workouts are not affected."
          : ""),
      confirmLabel: "Delete",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      state.exercises = state.exercises.filter((x) => x.id !== id);
      state.routines.forEach((r) => {
        r.exercises = r.exercises.filter((rx) => rx.exerciseId !== id);
      });
      save(true);
      render();
      toast("Exercise deleted", "", 1800);
    });
  }

  /* ============================================================
     11. VIEW — HISTORY DETAIL
     ============================================================ */
  function viewHistoryDetail(id) {
    const w = state.workouts.find((x) => x.id === id);
    if (!w) {
      return '<div class="card"><p>Workout not found.</p><a class="btn" href="#/dashboard">Back</a></div>';
    }
    const totals = workoutTotals(w);
    const useRIR = !!state.settings.useRIR;

    const exHtml = w.exercises
      .map((we) => {
        const showWeight = we.equipment && we.equipment !== "Bodyweight";
        const fields = valueFields(we);
        const cols = fields.length + (showWeight ? 1 : 0) + (useRIR ? 1 : 0);
        const rows = we.sets
          .map(
            (s, i) =>
              '<div class="set-grid set-row' +
              (s.completed ? " done" : "") +
              '" data-set-id="' +
              s.id +
              '">' +
              '<div class="set-idx">' +
              (i + 1) +
              "</div>" +
              '<div class="set-fields" style="--cols:' +
              cols +
              '">' +
              fields
                .map(
                  (f) =>
                    '<input type="number" min="0" step="any" class="set-input" data-field="' +
                    f +
                    '" value="' +
                    (s[f] == null ? "" : s[f]) +
                    '" aria-label="' +
                    esc(fieldLabel(f)) +
                    '">',
                )
                .join("") +
              (showWeight
                ? '<input type="number" min="0" step="any" class="set-input" data-field="weight" value="' +
                  (s.weight == null ? "" : kgToDisplay(s.weight)) +
                  '" aria-label="Load">'
                : "") +
              (useRIR
                ? '<input type="number" min="0" max="10" step="1" class="set-input" data-field="rir" value="' +
                  (s.rir == null ? "" : s.rir) +
                  '" aria-label="RIR">'
                : "") +
              "</div>" +
              '<button class="set-check" data-action="toggle-set-history" data-set="' +
              s.id +
              '" data-ex="' +
              we.id +
              '"' +
              ' aria-pressed="' +
              (s.completed ? "true" : "false") +
              '">' +
              (s.completed ? ICON_CHECK : ICON_CIRCLE) +
              "</button>" +
              "</div>",
          )
          .join("");

        return (
          '<section class="card ex-card" data-ex-id="' +
          we.id +
          '">' +
          '<div class="ex-head"><div class="ex-title"><h2>' +
          esc(we.exerciseName) +
          (we.unilateral ? '<span class="tag">per side</span>' : "") +
          "</h2>" +
          '<div class="muted small">target ' +
          esc(targetText(we)) +
          "</div></div>" +
          '<div class="ex-count">' +
          we.sets.filter((s) => s.completed).length +
          "/" +
          we.sets.length +
          "</div>" +
          "</div>" +
          (we.notes ? '<p class="note small">' + esc(we.notes) + "</p>" : "") +
          '<div class="set-list" style="margin-top:8px">' +
          rows +
          "</div>" +
          "</section>"
        );
      })
      .join("");

    return (
      "" +
      '<div class="card-head"><a class="btn small" href="#/dashboard">← Back</a>' +
      '<button class="btn small danger" data-action="delete-workout" data-id="' +
      w.id +
      '">Delete</button>' +
      "</div>" +
      '<section class="card">' +
      '<h1 class="wo-title">' +
      esc(w.routineName) +
      "</h1>" +
      '<div class="muted small">' +
      fmtDate(w.startTime) +
      " · " +
      fmtTime(w.startTime) +
      (w.endTime ? "–" + fmtTime(w.endTime) : "") +
      " · " +
      fmtDur(w.durationMs) +
      "</div>" +
      (w.status !== "completed"
        ? '<div class="pill down" style="margin-top:8px">Incomplete session</div>'
        : "") +
      '<div class="summary-grid" style="margin-top:12px">' +
      '<div class="summary-box"><div class="k">Working sets</div><div class="v">' +
      totals.sets +
      "</div></div>" +
      '<div class="summary-box"><div class="k">Recorded reps</div><div class="v">' +
      totals.reps +
      "</div></div>" +
      "</div>" +
      '<label class="field" style="margin-top:8px"><span>Workout notes</span>' +
      '<textarea id="history-notes" placeholder="Notes">' +
      esc(w.notes || "") +
      "</textarea></label>" +
      '<button class="btn small" data-action="save-history-notes" data-id="' +
      w.id +
      '">Save notes</button>' +
      "</section>" +
      '<p class="muted tiny-text">Set values are editable. Changes save automatically.</p>' +
      exHtml
    );
  }

  /* ============================================================
     12. VIEW — PROGRESS
     ============================================================ */
  function viewProgress(query) {
    const rangeWeeks = parseInt(query.get("range") || "12", 10);
    const selectedExercise = query.get("ex") || defaultProgressExercise();

    const weeks = weeklyWorkoutCounts(8);
    const weekChart = svgBarChart(
      weeks.map((w) => ({ label: w.label, value: w.value })),
      { ariaLabel: "Workouts per week" },
    );
    const weekTable =
      '<details class="table-alt"><summary>Show table</summary><table class="data">' +
      "<tr><th>Week of</th><th>Workouts</th></tr>" +
      weeks
        .map(
          (w) =>
            "<tr><td>" +
            esc(w.full) +
            '</td><td class="mono">' +
            w.value +
            "</td></tr>",
        )
        .join("") +
      "</table></details>";

    const options = state.exercises
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (e) =>
          '<option value="' +
          e.id +
          '"' +
          (e.id === selectedExercise ? " selected" : "") +
          ">" +
          esc(e.name) +
          "</option>",
      )
      .join("");

    let exerciseSection = "";
    if (selectedExercise) {
      const ex = getExercise(selectedExercise);
      const sessions = exerciseSessions(selectedExercise);
      const cutoff = daysAgo(rangeWeeks * 7);
      const filtered = sessions.filter(
        (s) => new Date(s.workout.startTime) >= cutoff,
      );

      if (!ex) {
        exerciseSection = '<p class="muted">Exercise not found.</p>';
      } else if (!filtered.length) {
        exerciseSection =
          '<p class="muted small">No sessions logged for this exercise in the selected range.</p>';
      } else {
        const points = filtered.map((s) => {
          const done = s.exercise.sets.filter((x) => x.completed);
          const best = done.length
            ? Math.max.apply(
                null,
                done.map((x) => maxSetValue(x, s.exercise)),
              )
            : 0;
          const total = sessionScore(s);
          const weights = done
            .map((x) => x.weight)
            .filter((x) => x != null && x > 0);
          return {
            date: fmtDateShort(s.workout.startTime),
            best: best,
            total: total,
            sets: done.length,
            weight: weights.length ? Math.max.apply(null, weights) : null,
            workoutId: s.workout.id,
          };
        });

        const chart = svgLineChart(
          points.map((p) => ({ label: p.date, value: p.best })),
          { ariaLabel: "Best set over time" },
        );

        // Personal records
        const allSessions = sessions;
        let bestSet = 0,
          bestTotal = 0,
          bestWeight = 0;
        allSessions.forEach((s) => {
          const done = s.exercise.sets.filter((x) => x.completed);
          if (!done.length) return;
          bestSet = Math.max(
            bestSet,
            Math.max.apply(
              null,
              done.map((x) => maxSetValue(x, s.exercise)),
            ),
          );
          bestTotal = Math.max(bestTotal, sessionScore(s));
          done.forEach((x) => {
            if (x.weight != null && x.weight > 0)
              bestWeight = Math.max(bestWeight, x.weight);
          });
        });
        const unit = ex.type === "timed" ? "s" : "reps";

        const table =
          '<details class="table-alt"><summary>Show table</summary><table class="data">' +
          "<tr><th>Date</th><th>Sets</th><th>Best set</th><th>Total</th><th>Load</th></tr>" +
          points
            .map(
              (p) =>
                "<tr><td>" +
                esc(p.date) +
                '</td><td class="mono">' +
                p.sets +
                "</td>" +
                '<td class="mono">' +
                p.best +
                '</td><td class="mono">' +
                p.total +
                "</td>" +
                '<td class="mono">' +
                (p.weight != null
                  ? kgToDisplay(p.weight) + " " + unitLabel()
                  : "—") +
                "</td></tr>",
            )
            .join("") +
          "</table></details>";

        exerciseSection =
          '<div class="summary-grid">' +
          '<div class="summary-box"><div class="k">Best single set</div><div class="v">' +
          bestSet +
          " " +
          unit +
          "</div></div>" +
          '<div class="summary-box"><div class="k">Best session total</div><div class="v">' +
          bestTotal +
          "</div></div>" +
          "</div>" +
          (bestWeight
            ? '<p class="muted small">Heaviest external load recorded: ' +
              kgToDisplay(bestWeight) +
              " " +
              unitLabel() +
              "</p>"
            : "") +
          chart +
          table +
          '<p class="muted tiny-text" style="margin-top:8px">Chart shows the best single set of each session' +
          (ex.unilateral ? " (per side)." : ".") +
          "</p>";
      }
    } else {
      exerciseSection =
        '<p class="muted small">Add exercises and log workouts to see per-exercise progress.</p>';
    }

    const totalCompleted = completedWorkouts().length;
    const last4 = completedWorkouts().filter(
      (w) => new Date(w.startTime) >= daysAgo(28),
    ).length;

    return (
      "" +
      '<div class="card-head"><h1>Progress</h1></div>' +
      '<section class="card">' +
      '<div class="summary-grid">' +
      '<div class="summary-box"><div class="k">Total workouts</div><div class="v">' +
      totalCompleted +
      "</div></div>" +
      '<div class="summary-box"><div class="k">Last 4 weeks</div><div class="v">' +
      last4 +
      "</div></div>" +
      "</div>" +
      '<h3 style="margin-top:6px">Workouts per week</h3>' +
      weekChart +
      weekTable +
      "</section>" +
      '<section class="card">' +
      '<div class="card-head"><h3>Exercise history</h3></div>' +
      '<label class="field"><span>Exercise</span>' +
      '<select data-action="progress-exercise">' +
      options +
      "</select></label>" +
      '<div class="pill-row">' +
      [4, 12, 52]
        .map(
          (r) =>
            '<button class="pill' +
            (rangeWeeks === r ? " active" : "") +
            '" data-action="progress-range" data-range="' +
            r +
            '">' +
            (r === 4 ? "4 weeks" : r === 12 ? "12 weeks" : "1 year") +
            "</button>",
        )
        .join("") +
      "</div>" +
      exerciseSection +
      "</section>"
    );
  }

  function defaultProgressExercise() {
    const list = completedWorkouts();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].exercises.length) return list[i].exercises[0].exerciseId;
    }
    return state.exercises.length ? state.exercises[0].id : "";
  }

  function weeklyWorkoutCounts(weeks) {
    const out = [];
    const start = startOfWeek();
    for (let i = weeks - 1; i >= 0; i--) {
      const ws = new Date(start);
      ws.setDate(ws.getDate() - i * 7);
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);
      const count = completedWorkouts().filter((w) => {
        const d = new Date(w.startTime);
        return d >= ws && d < we;
      }).length;
      out.push({
        label: ws.getMonth() + 1 + "/" + ws.getDate(),
        full: fmtDateShort(ws.toISOString()),
        value: count,
      });
    }
    return out;
  }

  /* ---- tiny SVG charts ---- */
  function svgBarChart(items, opts) {
    const w = 600,
      h = 160,
      padL = 8,
      padR = 8,
      padB = 24,
      padT = 18;
    const max = Math.max(
      1,
      Math.max.apply(
        null,
        items.map((i) => i.value),
      ),
    );
    const n = items.length || 1;
    const bw = (w - padL - padR) / n;
    const bars = items
      .map((it, i) => {
        const barH = ((h - padT - padB) * it.value) / max;
        const x = padL + i * bw + bw * 0.18;
        const y = h - padB - barH;
        return (
          '<rect class="bar" x="' +
          x +
          '" y="' +
          y +
          '" width="' +
          bw * 0.64 +
          '" height="' +
          Math.max(barH, 0) +
          '" rx="3"/>' +
          (it.value
            ? '<text class="val" x="' +
              (x + bw * 0.32) +
              '" y="' +
              (y - 4) +
              '" text-anchor="middle">' +
              it.value +
              "</text>"
            : "") +
          '<text class="axis" x="' +
          (x + bw * 0.32) +
          '" y="' +
          (h - 8) +
          '" text-anchor="middle">' +
          esc(it.label) +
          "</text>"
        );
      })
      .join("");
    return (
      '<svg class="chart" viewBox="0 0 ' +
      w +
      " " +
      h +
      '" role="img" aria-label="' +
      esc((opts && opts.ariaLabel) || "Bar chart") +
      '">' +
      bars +
      "</svg>"
    );
  }

  function svgLineChart(points, opts) {
    if (!points.length) return '<p class="muted small">No data.</p>';
    const w = 600,
      h = 180,
      padL = 30,
      padR = 12,
      padT = 16,
      padB = 28;
    const max = Math.max(
      1,
      Math.max.apply(
        null,
        points.map((p) => p.value),
      ),
    );
    const n = points.length;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const stepX = n > 1 ? innerW / (n - 1) : 0;

    const coords = points.map((p, i) => {
      const x = padL + (n > 1 ? i * stepX : innerW / 2);
      const y = padT + innerH - (innerH * p.value) / max;
      return { x: x, y: y, p: p };
    });

    const path = coords
      .map(
        (c, i) => (i === 0 ? "M" : "L") + c.x.toFixed(1) + " " + c.y.toFixed(1),
      )
      .join(" ");
    const dots = coords
      .map(
        (c) =>
          '<circle class="dot" cx="' +
          c.x.toFixed(1) +
          '" cy="' +
          c.y.toFixed(1) +
          '" r="3.5"/>',
      )
      .join("");

    // x labels (max 6)
    const labelEvery = Math.max(1, Math.ceil(n / 6));
    const labels = coords
      .map((c, i) =>
        i % labelEvery === 0 || i === n - 1
          ? '<text class="axis" x="' +
            c.x.toFixed(1) +
            '" y="' +
            (h - 8) +
            '" text-anchor="middle">' +
            esc(c.p.label) +
            "</text>"
          : "",
      )
      .join("");

    const grid =
      '<line class="grid-line" x1="' +
      padL +
      '" y1="' +
      padT +
      '" x2="' +
      (w - padR) +
      '" y2="' +
      padT +
      '"/>' +
      '<line class="grid-line" x1="' +
      padL +
      '" y1="' +
      (padT + innerH) +
      '" x2="' +
      (w - padR) +
      '" y2="' +
      (padT + innerH) +
      '"/>' +
      '<text class="axis" x="2" y="' +
      (padT + 4) +
      '">' +
      max +
      "</text>" +
      '<text class="axis" x="2" y="' +
      (padT + innerH + 4) +
      '">0</text>';

    return (
      '<svg class="chart" viewBox="0 0 ' +
      w +
      " " +
      h +
      '" role="img" aria-label="' +
      esc((opts && opts.ariaLabel) || "Line chart") +
      '">' +
      grid +
      '<path class="line" d="' +
      path +
      '"/>' +
      dots +
      labels +
      "</svg>"
    );
  }

  /* ============================================================
     13. VIEW — SETTINGS
     ============================================================ */
  function viewSettings() {
    const s = state.settings;
    return (
      "" +
      '<div class="card-head"><h1>Settings &amp; Backup</h1></div>' +
      '<section class="card" id="account-card">' +
      "<h3>Account &amp; cloud sync</h3>" +
      '<div id="account-body">' +
      accountBodyHTML() +
      "</div>" +
      "</section>" +
      '<section class="card">' +
      "<h3>Training</h3>" +
      '<label class="field"><span>Weight unit</span>' +
      '<select data-setting="unit">' +
      '<option value="kg"' +
      (s.unit === "kg" ? " selected" : "") +
      ">Kilograms (kg)</option>" +
      '<option value="lb"' +
      (s.unit === "lb" ? " selected" : "") +
      ">Pounds (lb)</option>" +
      "</select></label>" +
      '<label class="field"><span>Default rest (seconds)</span>' +
      '<input type="number" min="5" max="900" step="5" data-setting="defaultRest" value="' +
      s.defaultRest +
      '"></label>' +
      '<div class="checkbox-row"><input type="checkbox" id="set-autorets"' +
      (s.autoStartRest ? " checked" : "") +
      ' data-setting="autoStartRest"><label for="set-autorets">Start rest timer automatically after a completed set</label></div>' +
      '<div class="checkbox-row"><input type="checkbox" id="set-rir"' +
      (s.useRIR ? " checked" : "") +
      ' data-setting="useRIR"><label for="set-rir">Show RIR (reps in reserve) fields</label></div>' +
      '<div class="checkbox-row"><input type="checkbox" id="set-sound"' +
      (s.sound ? " checked" : "") +
      ' data-setting="sound"><label for="set-sound">Timer sound</label></div>' +
      '<div class="checkbox-row"><input type="checkbox" id="set-vib"' +
      (s.vibration ? " checked" : "") +
      ' data-setting="vibration"><label for="set-vib">Vibration (if supported)</label></div>' +
      '<label class="field"><span>Weekly workout target</span>' +
      '<input type="number" min="1" max="14" data-setting="weeklyTarget" value="' +
      s.weeklyTarget +
      '"></label>' +
      "</section>" +
      '<section class="card">' +
      "<h3>Defaults for new routines</h3>" +
      '<div class="grid-2">' +
      '<label class="field"><span>Sets</span>' +
      '<input type="number" min="1" max="20" data-setting="defaultSets" value="' +
      s.defaultSets +
      '"></label>' +
      '<label class="field"><span>Target min</span>' +
      '<input type="number" min="0" data-setting="defaultRepMin" value="' +
      s.defaultRepMin +
      '"></label>' +
      '<label class="field"><span>Target max</span>' +
      '<input type="number" min="0" data-setting="defaultRepMax" value="' +
      s.defaultRepMax +
      '"></label>' +
      "</div>" +
      "</section>" +
      '<section class="card">' +
      "<h3>Appearance</h3>" +
      '<label class="field"><span>Theme</span>' +
      '<select data-setting="theme">' +
      '<option value="dark"' +
      (s.theme === "dark" ? " selected" : "") +
      ">Dark</option>" +
      '<option value="light"' +
      (s.theme === "light" ? " selected" : "") +
      ">Light</option>" +
      '<option value="auto"' +
      (s.theme === "auto" ? " selected" : "") +
      ">Follow system</option>" +
      "</select></label>" +
      "</section>" +
      '<section class="card">' +
      "<h3>Data &amp; backup</h3>" +
      '<p class="muted small">Everything is stored in this browser only. Export regularly to keep a safe copy.</p>' +
      '<div class="btn-stack">' +
      '<button class="btn" data-action="export-json">Export full backup (JSON)</button>' +
      '<button class="btn" data-action="import-json">Import backup (JSON)</button>' +
      '<button class="btn" data-action="export-csv">Export workout history (CSV)</button>' +
      "</div>" +
      '<input type="file" id="import-file" accept="application/json,.json" class="sr-only">' +
      '<p class="muted tiny-text" style="margin-top:12px">' +
      "Storage: " +
      fmtBytes(estimateStorageBytes()) +
      " used · " +
      esc(mediaInfo()) +
      " · " +
      (saveOk
        ? "save working"
        : '<span class="danger-text">save failing</span>') +
      (state.meta.lastSaved
        ? " · last saved " + fmtTime(state.meta.lastSaved)
        : "") +
      "</p>" +
      '<div class="btn-stack" style="margin-top:8px">' +
      '<button class="btn small" data-action="cleanup-workout-media">Remove duplicated workout photos</button>' +
      "</div>" +
      "</section>" +
      '<section class="card">' +
      '<h3 class="danger-text">Danger zone</h3>' +
      '<p class="muted small">This deletes all routines, exercises, workouts and settings from this browser.</p>' +
      '<button class="btn danger" data-action="reset-data">Reset all data</button>' +
      "</section>" +
      '<p class="muted tiny-text">Workout Tracker · data schema v' +
      SCHEMA_VERSION +
      " · no accounts, no tracking.</p>"
    );
  }

  /* ============================================================
     14. BACKUP / RESTORE
     ============================================================ */
  function exportJSON() {
    const payload = {
      app: "workout-tracker",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: state,
    };
    download(
      "workout-backup-" + toISODate(new Date()) + ".json",
      JSON.stringify(payload, null, 2),
      "application/json",
    );
    toast("Backup exported", "ok", 2200);
  }

  function validateImport(parsed) {
    if (!parsed || typeof parsed !== "object")
      return { ok: false, error: "File is not a JSON object." };
    const data =
      parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
    if (!data || typeof data !== "object")
      return { ok: false, error: "Backup has no data." };
    if (!Array.isArray(data.exercises))
      return { ok: false, error: "Backup is missing the exercises list." };
    if (!Array.isArray(data.routines))
      return { ok: false, error: "Backup is missing the routines list." };
    if (!Array.isArray(data.workouts))
      return { ok: false, error: "Backup is missing the workout history." };
    const badWorkout = data.workouts.find(
      (w) => !w || !w.startTime || !Array.isArray(w.exercises),
    );
    if (badWorkout)
      return {
        ok: false,
        error: "Backup contains a malformed workout record.",
      };
    return { ok: true, data: data };
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        toast("Invalid JSON file — nothing was changed.", "error", 5000);
        return;
      }
      const check = validateImport(parsed);
      if (!check.ok) {
        toast(
          "Invalid backup: " + check.error + " Nothing was changed.",
          "error",
          6000,
        );
        return;
      }
      const d = check.data;
      const counts =
        (d.workouts || []).length +
        " workouts, " +
        (d.routines || []).length +
        " routines, " +
        (d.exercises || []).length +
        " exercises";
      confirmDialog({
        title: "Replace all data?",
        message:
          "The backup contains " +
          esc(counts) +
          ".<br><br>" +
          "Importing <strong>replaces</strong> everything currently in this browser. " +
          "Export a backup of the current data first if you are unsure.",
        confirmLabel: "Replace everything",
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        const imported = migrate(d);
        if (imported.activeWorkout) imported.activeWorkout.status = "active";
        state = imported;
        save(true);
        location.hash = "#/dashboard";
        render();
        toast("Backup restored", "ok", 2600);
      });
    };
    reader.onerror = () => toast("Could not read the file.", "error");
    reader.readAsText(file);
  }

  function exportCSV() {
    const header = [
      "date",
      "start_time",
      "routine",
      "workout_id",
      "exercise",
      "set_number",
      "reps_left",
      "reps_right",
      "reps_total",
      "duration_left_s",
      "duration_right_s",
      "duration_s",
      "distance_m",
      "weight_kg",
      "rir",
      "set_completed",
      "workout_status",
    ];
    const rows = [header];
    allWorkoutsDesc().forEach((w) => {
      w.exercises.forEach((we) => {
        we.sets.forEach((s, i) => {
          rows.push([
            w.date,
            w.startTime,
            w.routineName,
            w.id,
            we.exerciseName,
            i + 1,
            s.repsL == null ? "" : s.repsL,
            s.repsR == null ? "" : s.repsR,
            setTotalReps(s, we),
            s.durationL == null ? "" : s.durationL,
            s.durationR == null ? "" : s.durationR,
            s.duration == null ? "" : s.duration,
            s.distance == null ? "" : s.distance,
            s.weight == null ? "" : s.weight,
            s.rir == null ? "" : s.rir,
            s.completed ? "yes" : "no",
            w.status,
          ]);
        });
      });
    });

    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            const str = cell == null ? "" : String(cell);
            return /[",\n]/.test(str)
              ? '"' + str.replace(/"/g, '""') + '"'
              : str;
          })
          .join(","),
      )
      .join("\n");

    download(
      "workout-history-" + toISODate(new Date()) + ".csv",
      csv,
      "text/csv",
    );
    toast("CSV exported", "ok", 2200);
  }

  function resetAllData() {
    openModal({
      title: "Reset all data",
      body:
        "<p>This permanently deletes every routine, exercise, workout and setting stored in this browser.</p>" +
        '<label class="field"><span>Type <strong>DELETE</strong> to confirm</span>' +
        '<input type="text" id="reset-confirm" autocomplete="off" placeholder="DELETE"></label>',
      footer:
        '<button class="btn" data-action="close-modal">Cancel</button>' +
        '<button class="btn danger" id="reset-do">Reset everything</button>',
      onMount(el) {
        $("#reset-do", el).addEventListener("click", () => {
          const val = $("#reset-confirm", el).value.trim();
          if (val !== "DELETE") {
            toast("Type DELETE to confirm", "error");
            return;
          }
          state = seedState();
          undoStack = [];
          skipRest();
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch (_) {
            /* ignore */
          }
          save(true);
          closeModal();
          location.hash = "#/dashboard";
          render();
          toast("All data reset", "", 2400);
        });
      },
    });
  }

  /* ============================================================
     15. EVENT HANDLING
     ============================================================ */
  function currentEditContext() {
    if (currentRoute.name === "workout" && state.activeWorkout) {
      return { workout: state.activeWorkout, isActive: true };
    }
    if (currentRoute.name === "history" && currentRoute.param) {
      const w = state.workouts.find((x) => x.id === currentRoute.param);
      if (w) return { workout: w, isActive: false };
    }
    return null;
  }

  function onInput(e) {
    const input = e.target;
    if (!input.matches || !input.matches("input[data-field]")) return;
    const ctx = currentEditContext();
    if (!ctx) return;
    const row = input.closest("[data-set-id]");
    const card = input.closest("[data-ex-id]");
    if (!row || !card) return;

    const we = ctx.workout.exercises.find((x) => x.id === card.dataset.exId);
    if (!we) return;
    const set = we.sets.find((s) => s.id === row.dataset.setId);
    if (!set) return;

    const field = input.dataset.field;
    let value = input.value.trim() === "" ? null : numOrNull(input.value);
    if (value != null && value < 0) {
      value = 0;
      input.value = "0";
    }

    if (field === "weight") {
      set.weight = value == null ? null : displayToKg(value);
    } else if (field === "rir") {
      set.rir = value == null ? null : clampNum(value, 0, 10);
    } else {
      set[field] = value;
    }
    set.prefilled = false;
    input.classList.remove("prefilled");
    save();
  }

  function onActionChange(e) {
    const el = e.target;
    if (!el.matches) return;

    if (el.matches("select[data-setting]")) {
      const key = el.dataset.setting;
      state.settings[key] = el.value;
      applyTheme();
      save(true);
      render();
      return;
    }
    if (el.matches('select[data-action="progress-exercise"]')) {
      const range = currentRoute.query.get("range") || "12";
      location.hash =
        "#/progress?ex=" + encodeURIComponent(el.value) + "&range=" + range;
      return;
    }
    if (el.matches('input[type="checkbox"][data-setting]')) {
      const key = el.dataset.setting;
      state.settings[key] = el.checked;
      save(true);
      return;
    }
    if (el.matches("input[data-setting]")) {
      const key = el.dataset.setting;
      const n = numOrNull(el.value);
      if (n == null) return;
      state.settings[key] = Math.max(0, n);
      save();
      return;
    }
    if (el.matches("#import-file")) {
      if (el.files && el.files[0]) importJSON(el.files[0]);
      el.value = "";
    }
  }

  function accountBodyHTML() {
    if (!window.Cloud) {
      return '<p class="muted small">Cloud module not loaded.</p>';
    }
    const u = window.Cloud.currentUser();
    if (u) {
      return (
        '<p class="small">Signed in as <strong>' +
        esc(u.email || u.uid) +
        "</strong></p>" +
        '<div class="btn-row">' +
        '<button class="btn small" data-action="cloud-push-now">Push now</button>' +
        '<button class="btn small danger" data-action="cloud-signout">Sign out</button>' +
        "</div>"
      );
    }
    return (
      '<p class="muted small">Sign in to sync your routines and history across devices. Without an account the app stays local-only.</p>' +
      '<button class="btn primary" data-action="cloud-signin">Sign in / Sign up</button>'
    );
  }

  function refreshAccountCard() {
    const el = $("#account-body");
    if (el) el.innerHTML = accountBodyHTML();
  }

  function openAuthModal() {
    openModal({
      title: "Sign in",
      body:
        '<div id="auth-msg" class="small" style="min-height:20px;margin-bottom:8px"></div>' +
        '<label class="field"><span>Email</span>' +
        '<input type="email" id="auth-email" autocomplete="email" placeholder="you@example.com"></label>' +
        '<label class="field"><span>Password</span>' +
        '<input type="password" id="auth-pass" autocomplete="current-password" placeholder="At least 6 characters"></label>' +
        '<div class="btn-row">' +
        '<button class="btn primary" id="auth-email-signin">Sign in</button>' +
        '<button class="btn" id="auth-email-signup">Create account</button>' +
        "</div>" +
        '<hr class="hr">' +
        '<button class="btn" id="auth-google" style="width:100%">Continue with Google</button>' +
        '<p class="muted tiny-text" style="margin-top:12px">Forgot password? Use the Firebase console or sign in with Google.</p>',
      footer: '<button class="btn" data-action="close-modal">Cancel</button>',
      onMount(el) {
        const msg = $("#auth-msg", el);
        function show(text, err) {
          msg.textContent = text;
          msg.className = "small " + (err ? "danger-text" : "muted");
        }
        function busy(on) {
          $$("button", el).forEach(function (b) {
            b.disabled = !!on;
          });
        }
        async function doSignIn() {
          const email = $("#auth-email", el).value.trim();
          const pass = $("#auth-pass", el).value;
          if (!email || !pass) {
            show("Enter email and password", true);
            return;
          }
          busy(true);
          show("Signing in…");
          try {
            await window.Cloud.signInEmail(email, pass);
            closeModal();
            toast("Signed in", "ok", 2000);
          } catch (err) {
            show(err.message, true);
            busy(false);
          }
        }
        async function doSignUp() {
          const email = $("#auth-email", el).value.trim();
          const pass = $("#auth-pass", el).value;
          if (!email || pass.length < 6) {
            show(
              "Enter an email and a password of at least 6 characters",
              true,
            );
            return;
          }
          busy(true);
          show("Creating account…");
          try {
            await window.Cloud.signUpEmail(email, pass);
            closeModal();
            toast("Account created", "ok", 2000);
          } catch (err) {
            show(err.message, true);
            busy(false);
          }
        }
        $("#auth-email-signin", el).addEventListener("click", doSignIn);
        $("#auth-email-signup", el).addEventListener("click", doSignUp);
        $("#auth-google", el).addEventListener("click", async function () {
          busy(true);
          show("Opening Google…");
          try {
            await window.Cloud.signInGoogle();
            closeModal();
            toast("Signed in with Google", "ok", 2000);
          } catch (err) {
            show(err.message, true);
            busy(false);
          }
        });
      },
    });
  }

  function handleAction(action, el) {
    switch (action) {
      /* ---- navigation / modals ---- */
      case "close-modal":
        closeModal();
        return;
      case "dismiss-undo":
        hideUndoBar();
        return;

      /* ---- workout ---- */
      case "start-workout":
        startWorkout(el.dataset.routine);
        return;
      case "choose-routine":
        openModal({
          title: "Start a workout",
          body: state.routines.length
            ? '<div class="btn-stack">' +
              state.routines
                .map(
                  (r) =>
                    '<button class="btn" data-action="start-workout" data-routine="' +
                    r.id +
                    '">' +
                    esc(r.name) +
                    "</button>",
                )
                .join("") +
              "</div>"
            : '<p class="muted">No routines yet.</p>',
          footer:
            '<button class="btn" data-action="close-modal">Cancel</button>',
        });
        return;
      case "toggle-set": {
        const modalOpen = !!$("#modal-root .modal");
        toggleSet(el.dataset.ex, el.dataset.set);
        if (modalOpen) closeModal();
        return;
      }
      case "add-set":
        addSet(el.dataset.ex);
        return;
      case "remove-set":
        removeSet(el.dataset.ex, el.dataset.set);
        return;
      case "start-rest": {
        const we = findWE(el.dataset.ex);
        startRest(
          we
            ? we.rest || state.settings.defaultRest
            : state.settings.defaultRest,
        );
        return;
      }
      case "toggle-pause":
        togglePauseWorkout();
        return;
      case "finish-workout":
        openFinishWorkout();
        return;
      case "discard-workout":
        discardWorkout();
        return;
      case "edit-ex-notes":
        openExerciseNoteModal(el.dataset.ex);
        return;
      case "prev-exercise":
        navigateExercise(-1);
        return;
      case "next-exercise":
        navigateExercise(1);
        return;
      case "undo":
        performUndo();
        return;

      /* ---- rest timer ---- */
      case "timer-toggle":
        toggleTimerPause();
        return;
      case "timer-skip":
        skipRest();
        return;
      case "timer-add":
        addRestTime(parseInt(el.dataset.secs, 10) || 0);
        return;

      /* ---- routines ---- */
      case "duplicate-routine":
        duplicateRoutine(el.dataset.id);
        return;
      case "delete-routine":
        deleteRoutine(el.dataset.id);
        return;
      case "rx-add":
        openAddExerciseModal();
        return;
      case "rx-edit":
        openRoutineExerciseModal(parseInt(el.dataset.idx, 10));
        return;
      case "rx-remove": {
        if (!routineDraft) return;
        const i = parseInt(el.dataset.idx, 10);
        routineDraft.exercises.splice(i, 1);
        render();
        return;
      }
      case "rx-up": {
        if (!routineDraft) return;
        const i = parseInt(el.dataset.idx, 10);
        if (i <= 0) return;
        const tmp = routineDraft.exercises[i - 1];
        routineDraft.exercises[i - 1] = routineDraft.exercises[i];
        routineDraft.exercises[i] = tmp;
        render();
        return;
      }
      case "rx-down": {
        if (!routineDraft) return;
        const i = parseInt(el.dataset.idx, 10);
        if (i >= routineDraft.exercises.length - 1) return;
        const tmp = routineDraft.exercises[i + 1];
        routineDraft.exercises[i + 1] = routineDraft.exercises[i];
        routineDraft.exercises[i] = tmp;
        render();
        return;
      }
      case "save-routine":
        saveRoutineDraft();
        return;

      /* ---- exercises ---- */
      case "new-exercise":
        openExerciseModal(null);
        return;
      case "edit-exercise":
        openExerciseModal(el.dataset.id);
        return;
      case "delete-exercise":
        deleteExercise(el.dataset.id);
        return;

      /* ---- history ---- */
      case "toggle-set-history": {
        const w = state.workouts.find((x) => x.id === currentRoute.param);
        if (!w) return;
        const we = w.exercises.find((x) => x.id === el.dataset.ex);
        if (!we) return;
        const set = we.sets.find((s) => s.id === el.dataset.set);
        if (!set) return;
        set.completed = !set.completed;
        set.completedAt = set.completed ? new Date().toISOString() : null;
        save(true);
        render();
        return;
      }
      case "save-history-notes": {
        const w = state.workouts.find((x) => x.id === el.dataset.id);
        const ta = $("#history-notes");
        if (!w || !ta) return;
        w.notes = ta.value;
        save(true);
        toast("Notes saved", "ok", 1600);
        return;
      }
      case "delete-workout": {
        const w = state.workouts.find((x) => x.id === el.dataset.id);
        if (!w) return;
        confirmDialog({
          title: "Delete workout",
          message:
            "Delete the workout from <strong>" +
            esc(fmtDate(w.startTime)) +
            "</strong>? This cannot be undone.",
          confirmLabel: "Delete",
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          state.workouts = state.workouts.filter((x) => x.id !== w.id);
          save(true);
          if (window.Cloud)
            window.Cloud.deleteWorkoutDoc(w.id).catch(function () {});
          location.hash = "#/dashboard";
          render();
          toast("Workout deleted", "", 2000);
        });
        return;
      }

      /* ---- progress ---- */
      case "progress-range": {
        const ex = currentRoute.query.get("ex") || defaultProgressExercise();
        location.hash =
          "#/progress?ex=" +
          encodeURIComponent(ex) +
          "&range=" +
          el.dataset.range;
        return;
      }

      /* ---- settings / data ---- */
      case "cleanup-workout-media": {
        const removed = stripMediaFromWorkouts();
        if (removed === 0) {
          toast("No duplicated photos found", "", 2500);
        } else {
          save(true);
          toast("Removed " + removed + " duplicated photo(s)", "ok", 3000);
          render();
        }
        return;
      }
      case "cloud-signin":
        openAuthModal();
        return;
      case "cloud-signout":
        window.Cloud.signOut().then(function () {
          refreshAccountCard();
          toast("Signed out", "", 1800);
        });
        return;
      case "cloud-push-now":
        window.Cloud.schedulePush(state);
        toast("Push queued", "ok", 1800);
        return;
      case "export-json":
        exportJSON();
        return;
      case "export-csv":
        exportCSV();
        return;
      case "import-json": {
        const fileInput = $("#import-file");
        if (fileInput) fileInput.click();
        return;
      }
      case "reset-data":
        resetAllData();
        return;

      default:
        return;
    }
  }

  function applyTheme() {
    const theme = state.settings.theme || "dark";
    let resolved = theme;
    if (theme === "auto") {
      resolved =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    }
    document.documentElement.dataset.theme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta)
      meta.setAttribute(
        "content",
        resolved === "light" ? "#f4f6f9" : "#0f1318",
      );
  }

  /* ============================================================
     16. BOOT
     ============================================================ */
  function bindEvents() {
    document.addEventListener("click", (e) => {
      // Modal backdrop
      if (e.target.matches && e.target.matches("[data-modal-backdrop]")) {
        closeModal();
        return;
      }
      const actionEl = e.target.closest
        ? e.target.closest("[data-action]")
        : null;
      if (!actionEl) return;
      // Do not hijack navigation links
      if (actionEl.tagName === "A" && actionEl.getAttribute("href")) return;
      e.preventDefault();
      handleAction(actionEl.dataset.action, actionEl);
    });

    document.addEventListener("input", onInput);
    document.addEventListener("change", onActionChange);

    // Stepper buttons: one click = one step, clamped, then fire input.
    document.addEventListener("click", function (e) {
      const btn = e.target.closest && e.target.closest(".stepper-btn");
      if (!btn) return;
      e.preventDefault();
      const input = btn.parentElement.querySelector("input");
      if (!input) return;
      const step = parseFloat(btn.dataset.step) || 1;
      const current = parseFloat(input.value);
      let next;
      if (Number.isFinite(current)) next = current + step;
      else next = step > 0 ? step : 0;
      const min = input.min !== "" ? parseFloat(input.min) : 0;
      const max = input.max !== "" ? parseFloat(input.max) : Infinity;
      next = Math.max(min, Math.min(max, next));
      if (input.step && input.step !== "any") {
        const s = parseFloat(input.step);
        if (Number.isFinite(s) && s > 0) next = Math.round(next / s) * s;
      }
      next = Math.round(next * 100) / 100;
      input.value = String(next);
      input.classList.remove("prefilled");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Prevent the mouse wheel from changing number values (it was too fast).
    // Passive:false is required to call preventDefault.
    window.addEventListener(
      "wheel",
      function (e) {
        if (
          e.target &&
          e.target.matches &&
          e.target.matches('input[type="number"]')
        ) {
          e.preventDefault();
        }
      },
      { passive: false },
    );

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if ($("#modal-root .modal")) closeModal();
        return;
      }
      if (currentRoute.name === "workout" && state.activeWorkout) {
        if ($("#modal-root .modal")) return;
        const tag = (e.target && e.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          navigateExercise(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          navigateExercise(1);
        }
      }
    });

    window.addEventListener("hashchange", () => {
      // Reset draft when leaving the routine editor
      if (currentRoute.name === "routine" && parseHash().name !== "routine")
        routineDraft = null;
      render();
    });

    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushSave();
      else {
        updateTimerBar();
        const el = document.getElementById("wo-elapsed");
        if (el && state.activeWorkout)
          el.textContent = fmtClock(workoutElapsedMs(state.activeWorkout));
      }
    });

    window.addEventListener("online", () => toast("Back online", "", 1500));

    window.addEventListener("cloud-status", function (ev) {
      const d = ev.detail || {};
      const el = $("#save-indicator");
      if (el && d.text) {
        el.textContent = d.text;
        el.classList.toggle("error", d.kind === "error");
      }
    });

    window.addEventListener("cloud-user", function () {
      refreshAccountCard();
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol === "file:") return; // SW does not work from file://
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* silent: offline support is a bonus, not a requirement */
      });
    });
  }

  function mergeCloudPull(remote) {
    if (!remote || !remote.state) return;
    const s = migrate(remote.state);
    // Restore media from the separate media collection
    const mediaMap = remote.media || {};
    (s.exercises || []).forEach(function (ex) {
      if (mediaMap[ex.id]) ex.media = mediaMap[ex.id];
    });
    // Restore workouts from their collection
    s.workouts = (remote.workouts || []).map(sanitizeWorkout).filter(Boolean);
    // If a local active workout exists, keep the newer one
    if (state && state.activeWorkout && !s.activeWorkout) {
      s.activeWorkout = state.activeWorkout;
    }
    state = s;
    save(true);
    applyTheme();
    render();
  }

  function applyCloudState(data) {
    if (!data) return;
    const s = migrate(data);
    const mediaMap = {};
    (state.exercises || []).forEach(function (ex) {
      if (ex.media) mediaMap[ex.id] = ex.media;
    });
    s.exercises.forEach(function (ex) {
      if (mediaMap[ex.id]) ex.media = mediaMap[ex.id];
    });
    s.workouts = state.workouts;
    if (state.activeWorkout) s.activeWorkout = state.activeWorkout;
    state = s;
    save(true);
    applyTheme();
    render();
  }

  function applyCloudWorkouts(changes) {
    if (!Array.isArray(changes)) return;
    changes.forEach(function (ch) {
      if (ch.type === "removed") {
        state.workouts = state.workouts.filter(function (w) {
          return w.id !== ch.id;
        });
      } else if (ch.type === "upsert") {
        const w = sanitizeWorkout(ch.data);
        if (!w) return;
        const i = state.workouts.findIndex(function (x) {
          return x.id === w.id;
        });
        if (i >= 0) state.workouts[i] = w;
        else state.workouts.push(w);
      }
    });
    save(true);
    render();
  }

  function applyCloudMedia(map) {
    if (!map) return;
    state.exercises.forEach(function (ex) {
      if (map[ex.id]) ex.media = map[ex.id];
      else delete ex.media;
    });
    save(true);
    render();
  }

  function handleCloudRemote(ev) {
    const d = ev.detail;
    if (d.type === "state") applyCloudState(d.data);
    else if (d.type === "workouts") applyCloudWorkouts(d.changes);
    else if (d.type === "media") applyCloudMedia(d.map);
  }

  function init() {
    state = loadState();
    applyTheme();
    restoreTimer();
    bindEvents();
    if (window.Cloud) {
      window.addEventListener("cloud-pull", function (ev) {
        mergeCloudPull(ev.detail);
      });
      window.Cloud.init(function () {
        return state;
      }, handleCloudRemote);
    }
    if (!location.hash) location.hash = "#/dashboard";
    render();
    setInterval(tick, 250);
    tick();
    save(true);
    registerServiceWorker();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
