// ============================================================
// STORE.JS — שכבת נתונים: Firebase Realtime Database, או מצב הדגמה
//            (localStorage) כש-FIREBASE_CONFIG ריק. לשניהם אותו ממשק.
//
// מבנה הנתונים:
//   staff/{emailKey}      — עובד/ת: name, authEmail, workEmail, active, roles{admin,security,deputy,scheduler}, savedSignature
//   settings              — defaultInvitees: [{name, email}]
//   events/{id}           — אירוע (ראו newEventData ב-app.js)
//   events/{id}/done/{rowId} — סימון "בוצע" של משימה, בנפרד מהטופס כדי
//                              שעריכת הטופס לא תדרוס סימונים ולהפך
// ============================================================

const Store = (() => {
  let fb = null;          // firebase.database() במצב אמיתי
  let auth = null;

  // ── מצב הדגמה ─────────────────────────────────────────────
  const DEMO_KEY  = "eventSystemDemoDB";
  const DEMO_USER = "eventSystemDemoUser";
  let demoData = {};
  const demoListeners = [];      // { path, cb }
  let demoAuthCb = null;

  function demoLoad() {
    try { demoData = JSON.parse(localStorage.getItem(DEMO_KEY)) || {}; }
    catch (e) { demoData = {}; }
  }
  function demoSave() {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(demoData)); } catch (e) {}
    demoNotify();
  }
  function demoNotify() {
    setTimeout(() => demoListeners.forEach(l => l.cb(clone(getAt(demoData, l.path)))), 0);
  }

  function parts(path) { return String(path || "").split("/").filter(Boolean); }
  function getAt(obj, path) {
    let cur = obj;
    for (const p of parts(path)) {
      if (cur == null || typeof cur !== "object") return null;
      cur = cur[p];
    }
    return cur === undefined ? null : cur;
  }
  function setAt(obj, path, value) {
    const ps = parts(path);
    let cur = obj;
    for (let i = 0; i < ps.length - 1; i++) {
      if (cur[ps[i]] == null || typeof cur[ps[i]] !== "object") cur[ps[i]] = {};
      cur = cur[ps[i]];
    }
    const last = ps[ps.length - 1];
    if (value === null || value === undefined) delete cur[last];
    else cur[last] = clone(value);
  }
  function clone(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }

  // ── ממשק ─────────────────────────────────────────────────
  function init() {
    if (IS_DEMO) {
      demoLoad();
      window.addEventListener("storage", e => {
        if (e.key === DEMO_KEY) { demoLoad(); demoNotify(); }
      });
      return;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    fb = firebase.database();
  }

  // cb(user) — user = { email, name } או null
  function onAuth(cb) {
    if (IS_DEMO) {
      demoAuthCb = cb;
      const email = localStorage.getItem(DEMO_USER);
      setTimeout(() => cb(email ? { email, name: "" } : null), 0);
      return;
    }
    let timer = null;
    auth.onAuthStateChanged(u => {
      clearTimeout(timer);
      if (u) cb({ email: u.email.toLowerCase(), name: u.displayName || "" });
      // debounce — חלון ההתחברות של Firebase גורם ל-null רגעי
      else timer = setTimeout(() => cb(null), 800);
    });
  }

  async function signIn() {
    if (IS_DEMO) return;
    await auth.signInWithPopup(googleProvider());
  }

  function signInAs(email) {          // מצב הדגמה בלבד
    localStorage.setItem(DEMO_USER, email);
    if (demoAuthCb) demoAuthCb({ email, name: "" });
  }

  async function signOut() {
    if (IS_DEMO) {
      localStorage.removeItem(DEMO_USER);
      if (demoAuthCb) demoAuthCb(null);
      return;
    }
    await auth.signOut();
  }

  // מאזין לנתיב. מחזיר פונקציה לביטול ההאזנה.
  function listen(path, cb) {
    if (IS_DEMO) {
      const l = { path, cb };
      demoListeners.push(l);
      setTimeout(() => cb(clone(getAt(demoData, path))), 0);
      return () => { const i = demoListeners.indexOf(l); if (i >= 0) demoListeners.splice(i, 1); };
    }
    const ref = fb.ref(path);
    const h = ref.on("value", s => cb(s.val()));
    return () => ref.off("value", h);
  }

  async function get(path) {
    if (IS_DEMO) return clone(getAt(demoData, path));
    return (await fb.ref(path).once("value")).val();
  }

  async function set(path, value) {
    if (IS_DEMO) { setAt(demoData, path, value); demoSave(); return; }
    await fb.ref(path).set(value);
  }

  // patch — מפתחות יכולים להכיל '/' (עדכון מרובה נתיבים). null מוחק.
  async function update(path, patch) {
    if (IS_DEMO) {
      for (const [k, v] of Object.entries(patch)) setAt(demoData, path + "/" + k, v);
      demoSave();
      return;
    }
    await fb.ref(path).update(patch);
  }

  function newKey(path) {
    if (IS_DEMO) return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    return fb.ref(path).push().key;
  }

  function resetDemo() {
    localStorage.removeItem(DEMO_KEY);
    localStorage.removeItem(DEMO_USER);
    location.reload();
  }

  return { init, onAuth, signIn, signInAs, signOut, listen, get, set, update, newKey, resetDemo };
})();
