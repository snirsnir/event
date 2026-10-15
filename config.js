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
