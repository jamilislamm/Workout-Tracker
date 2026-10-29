/* ============================================================
   cloud.js — Firebase Auth + Firestore sync layer
   Classic script (compat SDK). Exposes window.Cloud.
   ============================================================ */
(function () {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyAzCeBkIxB9HF6pMj-8lXoig5p-cAswFuQ",
    authDomain: "workout-tracker-dcc65.firebaseapp.com",
    projectId: "workout-tracker-dcc65",
    storageBucket: "workout-tracker-dcc65.firebasestorage.app",
    messagingSenderId: "683592713116",
    appId: "1:683592713116:web:d3de5f6de59f5de42d7e59",
    measurementId: "G-7875K7WXJJ",
  };

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  // Multi-tab offline cache. Fail silently if the browser refuses.
  db.enablePersistence({ synchronizeTabs: true }).catch(function () {});

  let user = null;
  let stateRef = null;
  let pushTimer = null;
  let unsubs = [];
  let applyingRemote = false;
  let onRemoteCallback = null;
  let getStateFn = null;

  function base() {
    return db.collection("users").doc(user.uid).collection("appData");
  }

  function setStatus(text, kind) {
    window.dispatchEvent(
      new CustomEvent("cloud-status", {
        detail: { text: text, kind: kind || "" },
      }),
    );
  }

  /* ---------- Pull everything ---------- */
  async function pullAll() {
    const b = base();
    setStatus("Syncing…", "busy");
    const [stateSnap, mediaSnap, workoutsSnap] = await Promise.all([
      b.doc("state").get(),
      b.collection("media").get(),
      b.collection("workouts").get(),
    ]);

    const mediaMap = {};
    mediaSnap.forEach(function (d) {
      const v = d.data();
      if (v && typeof v.dataUrl === "string") mediaMap[d.id] = v.dataUrl;
    });

    let state = null;
    if (stateSnap.exists) {
      state = stateSnap.data();
    }

    // Workouts live in their own collection; state.workouts is rebuilt from it.
    const workouts = [];
    workoutsSnap.forEach(function (d) {
      const v = d.data();
      if (v && v.startTime) workouts.push(v);
    });

    return { state: state, media: mediaMap, workouts: workouts };
  }

  /* ---------- Push state (debounced) ---------- */
  function schedulePush(state) {
    if (!user || applyingRemote) return;
    getStateFn = function () {
      return state;
    };
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushStateNow();
    }, 1500);
  }

  async function pushStateNow() {
    if (!user || !getStateFn) return;
    const state = getStateFn();
    if (!state) return;
    try {
      setStatus("Saving…", "busy");
      const slim = JSON.parse(JSON.stringify(state));
      // Workouts are pushed separately; keep state doc small.
      const finishedWorkouts = slim.workouts || [];
      slim.workouts = [];
      // Exercises keep media here? No — media lives in /media.
      (slim.exercises || []).forEach(function (ex) {
        delete ex.media;
      });
      if (slim.activeWorkout && Array.isArray(slim.activeWorkout.exercises)) {
        slim.activeWorkout.exercises.forEach(function (we) {
          delete we.media;
        });
      }
      slim.meta = Object.assign({}, slim.meta || {}, {
        lastSaved: new Date().toISOString(),
        schemaVersion: slim.version || 1,
      });
      await base().doc("state").set(slim, { merge: false });
      setStatus("Saved to cloud", "ok");
      return finishedWorkouts;
    } catch (err) {
      setStatus("Cloud save failed: " + err.message, "error");
      throw err;
    }
  }

  /* ---------- Media documents ---------- */
  async function pushMedia(exerciseId, dataUrl) {
    if (!user) return;
    const ref = base().collection("media").doc(exerciseId);
    if (!dataUrl) {
      try {
        await ref.delete();
      } catch (_) {}
      return;
    }
    // Firestore document limit is 1 MB. Reject before writing.
    if (dataUrl.length > 900000) {
      setStatus("Media too large for Firestore (max ~900 KB)", "error");
      throw new Error(
        "Media too large. Use a smaller image or Firebase Storage.",
      );
    }
    await ref.set({ dataUrl: dataUrl, updatedAt: new Date().toISOString() });
  }

  /* ---------- Workout documents ---------- */
  async function pushWorkout(workout) {
    if (!user || !workout || !workout.id) return;
    const copy = JSON.parse(JSON.stringify(workout));
    (copy.exercises || []).forEach(function (we) {
      delete we.media;
    });
    await base().collection("workouts").doc(workout.id).set(copy);
  }

  async function deleteWorkoutDoc(workoutId) {
    if (!user) return;
    try {
      await base().collection("workouts").doc(workoutId).delete();
    } catch (_) {}
  }

  /* ---------- Realtime listeners ---------- */
  function startRealtime(cb) {
    onRemoteCallback = cb;
    stopRealtime();
    const b = base();

    unsubs.push(
      b
        .doc("state")
        .onSnapshot({ includeMetadataChanges: true }, function (snap) {
          if (!snap.exists || snap.metadata.hasPendingWrites) return;
          if (applyingRemote) return;
          applyingRemote = true;
          onRemoteCallback({ type: "state", data: snap.data() });
          applyingRemote = false;
        }),
    );

    unsubs.push(
      b
        .collection("workouts")
        .onSnapshot({ includeMetadataChanges: true }, function (snap) {
          if (snap.metadata.hasPendingWrites) return;
          const changed = [];
          snap.docChanges().forEach(function (ch) {
            if (ch.type === "removed")
              changed.push({ type: "removed", id: ch.doc.id });
            else
              changed.push({
                type: "upsert",
                id: ch.doc.id,
                data: ch.doc.data(),
              });
          });
          if (!changed.length) return;
          applyingRemote = true;
          onRemoteCallback({ type: "workouts", changes: changed });
          applyingRemote = false;
        }),
    );

    unsubs.push(
      b
        .collection("media")
        .onSnapshot({ includeMetadataChanges: true }, function (snap) {
          if (snap.metadata.hasPendingWrites) return;
          const map = {};
          snap.forEach(function (d) {
            map[d.id] = (d.data() || {}).dataUrl || "";
          });
          applyingRemote = true;
          onRemoteCallback({ type: "media", map: map });
          applyingRemote = false;
        }),
    );
  }

  function stopRealtime() {
    unsubs.forEach(function (u) {
      try {
        u();
      } catch (_) {}
    });
    unsubs = [];
  }

  /* ---------- Auth ---------- */
  function onAuth(cb) {
    return auth.onAuthStateChanged(cb);
  }

  async function signInEmail(email, password) {
    return auth.signInWithEmailAndPassword(email, password);
  }

  async function signUpEmail(email, password) {
    return auth.createUserWithEmailAndPassword(email, password);
  }

  async function signInGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    return auth.signInWithPopup(provider);
  }

  async function signOutUser() {
    stopRealtime();
    user = null;
    stateRef = null;
    return auth.signOut();
  }

  /* ---------- Entry point called from app.js ---------- */
  function init(getState, onRemote) {
    getStateFn = getState;
    onAuth(async function (u) {
      user = u;
      if (!u) {
        stopRealtime();
        setStatus("Local only", "");
        window.dispatchEvent(new CustomEvent("cloud-user", { detail: null }));
        return;
      }
      setStatus("Signed in as " + (u.email || u.uid), "ok");
      window.dispatchEvent(
        new CustomEvent("cloud-user", { detail: { email: u.email || u.uid } }),
      );
      try {
        const remote = await pullAll();
        window.dispatchEvent(new CustomEvent("cloud-pull", { detail: remote }));
        startRealtime(onRemote);
      } catch (err) {
        setStatus("Pull failed: " + err.message, "error");
      }
    });
  }

  window.Cloud = {
    init: init,
    schedulePush: schedulePush,
    pushMedia: pushMedia,
    pushWorkout: pushWorkout,
    deleteWorkoutDoc: deleteWorkoutDoc,
    signInEmail: signInEmail,
    signUpEmail: signUpEmail,
    signInGoogle: signInGoogle,
    signOut: signOutUser,
    currentUser: function () {
      return user;
    },
  };
})();
