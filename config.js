// ============================================================
// CONFIG.JS — הגדרות מערכת ניהול אירועים
// ============================================================

// ── Firebase ──
// כל עוד apiKey ריק המערכת רצה במצב הדגמה: הנתונים נשמרים בדפדפן בלבד,
// הכניסה היא בבחירת משתמש מרשימה, ומיילים/זימונים מוצגים ב"תיבת הדואר
// של ההדגמה" במקום להישלח. להפעלה אמיתית — ראו README.md.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB8L6IDldy3DjG9JRgoLejzWu7X4Oeh13I",
  authDomain: "event-68bf7.firebaseapp.com",
  databaseURL: "https://event-68bf7-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "event-68bf7",
  storageBucket: "event-68bf7.firebasestorage.app",
  messagingSenderId: "1083465864271",
  appId: "1:1083465864271:web:748aa99809deccd5ec063a"
};

// ── EmailJS — אותו שירות ותבנית של מערכת החופשות ──
// התבנית מצפה ל: to_name (כתובת הנמען), name, email (reply-to), subject, message (HTML)
const EMAILJS_SERVICE_ID  = "service_qn28exb";
const EMAILJS_TEMPLATE_ID = "template_fmr5r4q";
const EMAILJS_PUBLIC_KEY  = "Y0yqKFQQ4ONQ4j396";
const REPLY_TO_EMAIL      = "tech.boker@gmail.com";

// ── Apps Script — יצירת אירוע ביומן ושליחת זימון (מגיע ל-Outlook כזימון רגיל) ──
// הקוד ב-calendar.gs. ריק = זימונים לא נשלחים (במצב הדגמה הם נרשמים בתיבת הדואר).
const APPS_SCRIPT_URL   = "https://script.google.com/macros/s/AKfycbw5UiasLR6m0mn_qdxlpE7K4Y5WhFV9rw6Gu4aWcqMjJQ-2z3PKnBQw720KR0DCgf6uBQ/exec";
// אותו ערך כמו SHARED_TOKEN בהגדרות הסקריפט (Script properties) — מונע שימוש מבחוץ
const APPS_SCRIPT_TOKEN = "PLLLnvn7tXed3EMhoLalagMl";

const SYSTEM_URL = "https://snirsnir.github.io/event/";

// כתובות Gmail שמקבלות הרשאת אדמין בכניסה הראשונה, כשרשימת העובדים עדיין ריקה.
// אחרי זה ההרשאות מנוהלות מעמדת הניהול.
const BOOTSTRAP_ADMINS = ["snirdoani@gmail.com"];

const ORG_NAME = "טכנודע";

// ── שלבי האישור, לפי הסדר ──
// role — הדגל בכרטיס העובד/ת שמסמן מי מאשר/ת בשלב הזה (ניתן לכמה אנשים).
const STAGES = [
  { status: "pending_security",  role: "security",  label: 'רכז/ת בטיחות וביטחון', sigLabel: 'חתימת רכז בטיחות וביטחון' },
  { status: "pending_deputy",    role: "deputy",    label: 'משנה למנכ"ל',          sigLabel: 'חתימת המשנה למנכ"ל' },
  { status: "pending_scheduler", role: "scheduler", label: 'סמנכ"ל תפעול',          sigLabel: 'אישור סמנכ"ל תפעול ותזמון' },
];

const ROLE_LABELS = {
  admin:     "אדמין",
  security:  'קב"ט — מאשר/ת בטיחות',
  deputy:    'משנה למנכ"ל',
  scheduler: 'סמנכ"ל תפעול — מאשר/ת מועד ושולח/ת זימונים',
};

const STATUS_LABELS = {
  draft:             { text: "טיוטה",                 cls: "st-draft" },
  pending_security:  { text: 'ממתין לקב"ט',           cls: "st-pending" },
  pending_deputy:    { text: 'ממתין למשנה למנכ"ל',     cls: "st-pending" },
  pending_scheduler: { text: 'ממתין לסמנכ"ל תפעול',   cls: "st-pending" },
  returned:          { text: "הוחזר לתיקון",           cls: "st-returned" },
  approved:          { text: "מאושר — זימון נשלח",     cls: "st-approved" },
  cancelled:         { text: "בוטל",                   cls: "st-cancelled" },
};

// ── חגים ומועדים — מוצגים ביומן האירועים (מקור: מערכת החופשות, hagim.csv) ──
// closed: true — יום שהמשרד סגור בו
const HOLIDAYS = [
  { name: "ערב ראש השנה",                   start: "2026-09-11", end: "2026-09-11" },
  { name: "ראש השנה",                       start: "2026-09-12", end: "2026-09-13", closed: true },
  { name: "צום גדליה",                      start: "2026-09-14", end: "2026-09-14" },
  { name: "ערב יום כיפור",                   start: "2026-09-20", end: "2026-09-20" },
  { name: "יום כיפור",                      start: "2026-09-21", end: "2026-09-21", closed: true },
  { name: "ערב סוכות",                      start: "2026-09-25", end: "2026-09-25" },
  { name: "סוכות",                          start: "2026-09-26", end: "2026-09-26", closed: true },
  { name: "חול המועד סוכות",                start: "2026-09-27", end: "2026-10-01" },
  { name: "הושענא רבה",                     start: "2026-10-02", end: "2026-10-02" },
  { name: "שמחת תורה",                      start: "2026-10-03", end: "2026-10-03", closed: true },
  { name: "יום הזיכרון לאירועי 7 באוקטובר", start: "2026-10-05", end: "2026-10-05" },
  { name: "חנוכה",                          start: "2026-12-06", end: "2026-12-11" },
  { name: "צום עשרה בטבת",                  start: "2026-12-20", end: "2026-12-20" },
  { name: "תענית אסתר",                     start: "2027-03-22", end: "2027-03-22" },
  { name: "פורים",                          start: "2027-03-23", end: "2027-03-23" },
  { name: "שושן פורים",                     start: "2027-03-24", end: "2027-03-24" },
  { name: "ערב פסח",                        start: "2027-04-21", end: "2027-04-21" },
  { name: "פסח",                            start: "2027-04-22", end: "2027-04-22", closed: true },
  { name: "חול המועד פסח",                  start: "2027-04-23", end: "2027-04-27" },
  { name: "שביעי של פסח",                   start: "2027-04-28", end: "2027-04-28", closed: true },
  { name: "יום המימונה",                    start: "2027-04-29", end: "2027-04-29" },
  { name: "יום השואה",                      start: "2027-05-04", end: "2027-05-04" },
  { name: "יום הזיכרון",                    start: "2027-05-11", end: "2027-05-11" },
  { name: "יום העצמאות",                    start: "2027-05-12", end: "2027-05-12", closed: true },
  { name: 'ל"ג בעומר',                      start: "2027-05-25", end: "2027-05-25" },
  { name: "יום ירושלים",                    start: "2027-06-04", end: "2027-06-04" },
  { name: "ערב שבועות",                     start: "2027-06-10", end: "2027-06-10" },
  { name: "שבועות",                         start: "2027-06-11", end: "2027-06-11", closed: true },
  { name: "תשעה באב",                       start: "2027-08-12", end: "2027-08-12" },
];

// ── עזר ──
const IS_DEMO = !FIREBASE_CONFIG.apiKey;

// Firebase לא מרשה נקודות במפתח — כתובת המייל משמשת מפתח של העובד/ת
function emailKey(email) {
  return String(email || "").trim().toLowerCase().replace(/\./g, ",");
}

function googleProvider() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

function authErrorMessage(err) {
  switch (err && err.code) {
    case "auth/cancelled-popup-request":
      return null;
    case "auth/popup-closed-by-user":
      return "חלון ההתחברות נסגר לפני שההתחברות הושלמה. בגלישה בסתר ההתחברות עלולה להיחסם — נסו בחלון רגיל.";
    case "auth/popup-blocked":
      return "הדפדפן חסם את חלון ההתחברות. יש לאשר חלונות קופצים לאתר ולנסות שוב.";
    case "auth/network-request-failed":
      return "אין חיבור לרשת. יש לבדוק את החיבור ולנסות שוב.";
    default:
      return "שגיאה בכניסה: " + ((err && err.message) || "שגיאה לא ידועה");
  }
}
