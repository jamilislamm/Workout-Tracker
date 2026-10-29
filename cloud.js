/* ============================================================
   cloud.js — Firebase Auth + Firestore sync layer
   Structure:
     users/{uid}/appData/state          — settings, routines, exercises (no media), activeWorkout
     users/{uid}/media/{exerciseId}     — { dataUrl }
     users/{uid}/workouts/{workoutId}   — full workout record
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

  db.enablePersistence({ synchronizeTabs: true }).catch(function () {});

  let user = null;
  let pushTimer = null;
  let unsubs = [];
  let applyingRemote = false;
  let onRemoteCallback = null;
  let getStateFn = null;

  /* ---------- Paths (correct types) ---------- */
  function userDoc() {
    return db.collection("users").doc(user.uid);
  }
  function stateDoc() {
    return userDoc().collection("appData").doc("state");
  }
  function mediaCol() {
    return userDoc().collection("media");
  }
  function workoutsCol() {
    return userDoc().collection("workouts");
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
    setStatus("Syncing…", "busy");
    const [stateSnap, mediaSnap, workoutsSnap] = await Promise.all([
      stateDoc().get(),
      mediaCol().get(),
      workoutsCol().get(),
    ]);

    const mediaMap = {};
    mediaSnap.forEach(function (d) {
      const v = d.data();
      if (v && typeof v.dataUrl === "string") mediaMap[d.id] = v.dataUrl;
    });

    const state = stateSnap.exists ? stateSnap.data() : null;

    const workouts = [];
    workoutsSnap.forEach(function (d) {
      const v = d.data();
      if (v && v.startTime) workouts.push(v);
    });

    return { state: state, media: mediaMap, workouts: workouts };
  }

  /* ---------- Push state (debounced) ---------- */
  function schedulePush() {
    if (!user || applyingRemote) return;
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
      slim.workouts = [];
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
      await stateDoc().set(slim, { merge: false });
      setStatus("Saved to cloud", "ok");
    } catch (err) {
      setStatus("Cloud save failed: " + err.message, "error");
      throw err;
    }
  }

  /* ---------- Media ---------- */
  async function pushMedia(exerciseId, dataUrl) {
    if (!user) return;
    const ref = mediaCol().doc(exerciseId);
    if (!dataUrl) {
      try {
        await ref.delete();
      } catch (_) {}
      return;
    }
    if (dataUrl.length > 900000) {
      setStatus("Media too large for Firestore (max ~900 KB)", "error");
      throw new Error("Media too large.");
    }
    await ref.set({ dataUrl: dataUrl, updatedAt: new Date().toISOString() });
  }

  /* ---------- Workouts ---------- */
  async function pushWorkout(workout) {
    if (!user || !workout || !workout.id) return;
    const copy = JSON.parse(JSON.stringify(workout));
    (copy.exercises || []).forEach(function (we) {
      delete we.media;
    });
    await workoutsCol().doc(workout.id).set(copy);
  }

  async function deleteWorkoutDoc(workoutId) {
    if (!user) return;
    try {
      await workoutsCol().doc(workoutId).delete();
    } catch (_) {}
  }

  /* ---------- Realtime ---------- */
  function startRealtime(cb) {
    onRemoteCallback = cb;
    stopRealtime();

    unsubs.push(
      stateDoc().onSnapshot({ includeMetadataChanges: true }, function (snap) {
        if (!snap.exists || snap.metadata.hasPendingWrites) return;
        if (applyingRemote) return;
        applyingRemote = true;
        try {
          onRemoteCallback({ type: "state", data: snap.data() });
        } finally {
          applyingRemote = false;
        }
      }),
    );

    unsubs.push(
      workoutsCol().onSnapshot(
        { includeMetadataChanges: true },
        function (snap) {
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
          try {
            onRemoteCallback({ type: "workouts", changes: changed });
          } finally {
            applyingRemote = false;
          }
        },
      ),
    );

    unsubs.push(
      mediaCol().onSnapshot({ includeMetadataChanges: true }, function (snap) {
        if (snap.metadata.hasPendingWrites) return;
        const map = {};
        snap.forEach(function (d) {
          map[d.id] = (d.data() || {}).dataUrl || "";
        });
        applyingRemote = true;
        try {
          onRemoteCallback({ type: "media", map: map });
        } finally {
          applyingRemote = false;
        }
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
    getStateFn = null;
    return auth.signOut();
  }

  /* ---------- First-sync helpers ---------- */
  async function bootstrapFromLocal() {
    const s = getStateFn();
    if (!s) return;
    setStatus("Uploading local data…", "busy");
    await pushStateNow();
    for (const w of s.workouts || []) {
      try {
        await pushWorkout(w);
      } catch (_) {}
    }
    for (const ex of s.exercises || []) {
      if (ex.media) {
        try {
          await pushMedia(ex.id, ex.media);
        } catch (_) {}
      }
    }
    setStatus("Uploaded to cloud", "ok");
  }

  async function pushLocalOnlyWorkouts(remoteWorkouts) {
    const s = getStateFn();
    if (!s) return 0;
    const remoteIds = new Set(
      (remoteWorkouts || []).map(function (w) {
        return w.id;
      }),
    );
    let count = 0;
    for (const w of s.workouts || []) {
      if (!remoteIds.has(w.id)) {
        try {
          await pushWorkout(w);
          count++;
        } catch (_) {}
      }
    }
    return count;
  }

  /* ---------- Init ---------- */
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
        const localState = getStateFn();
        const hasLocalData =
          localState &&
          ((localState.workouts && localState.workouts.length > 0) ||
            !!localState.activeWorkout);

        if (!remote.state) {
          // Cloud is empty.
          if (hasLocalData) {
            await bootstrapFromLocal();
          } else {
            setStatus("Connected — cloud empty", "ok");
          }
        } else {
          // Cloud has data. Preserve any local-only workouts before pulling.
          const pushed = await pushLocalOnlyWorkouts(remote.workouts || []);
          if (pushed > 0) {
            await new Promise(function (r) {
              setTimeout(r, 400);
            });
            const fresh = await pullAll();
            window.dispatchEvent(
              new CustomEvent("cloud-pull", { detail: fresh }),
            );
          } else {
            window.dispatchEvent(
              new CustomEvent("cloud-pull", { detail: remote }),
            );
          }
        }

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
