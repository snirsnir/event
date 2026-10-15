// ============================================================
// TEMPLATE.JS — תבנית ברירת המחדל של הטופס (מתוך tofes.xlsx)
//               ורשימת העובדים ההתחלתית (מתוך מערכת החופשות)
// ============================================================

// owners — שמות פרטיים. בטופס הם מותאמים אוטומטית לעובדים במערכת,
// כדי שהמשימה תופיע בדשבורד של האחראי/ת. שם שאין לו עובד/ת נשאר טקסט חופשי.
const DEFAULT_SECTIONS = [
  {
    title: "חלק א'", note: "",
    groups: [
      { name: "כוח אדם", rows: [
        { item: "הוראה (בעלי רקע מדעי ו/או עובדי הטכנודע)", owners: ["אמילי"] },
        { item: "עוזרי מדריכים",  owners: ["עזריאל"] },
        { item: "לבורנטיות",      owners: ["לירון"] },
        { item: "עובדי אחזקה",    owners: ["מידן"] },
        { item: "עובדי ניקיון",   owners: ["מידן"] },
      ]},
      { name: "מזכירות", rows: [
        { item: "טלפונים",        owners: ["דינה"] },
        { item: "מכירת כרטיסים",  owners: ["דינה"] },
      ]},
      { name: "קביעת תכנים", rows: [
        { item: "סדנאות",          owners: ["אמילי", "שניר", "אלי"] },
        { item: "מוזיאון הרפואה",  owners: ["אמילי", "בני"] },
      ]},
      { name: "רכישות וציוד", rows: [
        { item: "ציוד מדעי",              owners: ["לירון"] },
        { item: "תפאורה",                 owners: ["דינה", "מידן"] },
        { item: "קופות",                  owners: ["דינה"] },
        { item: "ציוד אור קולי",          owners: ["מידן"] },
        { item: "שולחנות כמות מיקומים",   owners: ["אמילי", "מידן"] },
        { item: "עמודי תור",              owners: ["מידן"] },
        { item: "מזגנים ניידים",          owners: ["מידן"] },
      ]},
    ],
  },
  {
    title: "חלק ב'", note: 'יש לצרף הנחיות קב"ט עירוני',
    groups: [
      { name: "שמירה", rows: [
        { item: "עיריית חדרה", owners: ["דינה"] },
      ]},
      { name: "בטיחות וביטחון", rows: [
        { item: "הכנת תיק הוראות בטיחות", owners: ["אלי"] },
        { item: "חזרה גנראלית",           owners: ["אמילי", "אלי"] },
        { item: "משקיף בטיחות",           owners: ["אלי"] },
      ]},
    ],
  },
  {
    title: "חלק ג'", note: "",
    groups: [
      { name: "שיווק", rows: [
        { item: "עיתונות ארצית",                 owners: ["דינה"] },
        { item: "עיתונות מקומית",                owners: ["דינה"] },
        { item: "פרסום באתר וברשתות החברתיות",   owners: ["דינה"] },
      ]},
      { name: 'יח"צ', rows: [
        { item: "טלויזיה", owners: ["דינה"] },
        { item: "רדיו",    owners: ["דינה"] },
      ]},
      { name: "תיעוד האירוע", rows: [
        { item: "תמונות/וידאו פנימי עצמאי", owners: ["קרן"] },
      ]},
    ],
  },
];

// רשימה התחלתית — נטענת פעם אחת כשרשימת העובדים ריקה. משם מנהלים מעמדת הניהול.
const STAFF_SEED = [
  { name: "גדי מדור",       authEmail: "gadimador@gmail.com",          workEmail: "gadi1@technoda.org.il" },
  { name: "אמילי גולן",     authEmail: "emilygolan1@gmail.com",        workEmail: "emily@technoda.org.il",       roles: { deputy: true, admin: true } },
  { name: "קרן דהן",        authEmail: "kerenbaileydahan@gmail.com",   workEmail: "keren.dahan@technoda.org.il" },
  { name: "יונת נחשון",     authEmail: "yonatnahshon@gmail.com",       workEmail: "yonat@technoda.org.il" },
  { name: "דינה כחלון בש",  authEmail: "dinaka2611@gmail.com",         workEmail: "dina@technoda.org.il",        roles: { scheduler: true } },
  { name: "מידן קדוש",      authEmail: "meidankadosh@gmail.com",       workEmail: "meidan@technoda.org.il" },
  { name: "שולי ששון",      authEmail: "shulisason@gmail.com",         workEmail: "shuli@technoda.org.il" },
  { name: "ספיר מלמד",      authEmail: "melamedsapir@gmail.com",       workEmail: "sapir@technoda.org.il" },
  { name: "מעיין שוורצר",   authEmail: "maayan.schvartzer@gmail.com",  workEmail: "maayan.s@technoda.org.il" },
  { name: "שי גלס",         authEmail: "shayglass97@gmail.com",        workEmail: "shay@technoda.org.il" },
  { name: "ויטה אגאייב",    authEmail: "agaev.vita@gmail.com",         workEmail: "vita@technoda.org.il" },
  { name: "דוד אוחיון",     authEmail: "sokshi@gmail.com",             workEmail: "david@technoda.org.il" },
  { name: "ניצן מורן",      authEmail: "nitsanm@gmail.com",            workEmail: "nitsan@technoda.org.il" },
  { name: "ורד טל",         authEmail: "vered.tal.2006@gmail.com",     workEmail: "vered@technoda.org.il" },
  { name: "עזריאל שניידר",  authEmail: "azriel.sch2@gmail.com",        workEmail: "azriel@technoda.org.il",      roles: { security: true } },
  { name: "מרי דהן",        authEmail: "mary.dahan902@gmail.com",      workEmail: "mary@technoda.org.il" },
  { name: "אלי זריהן",      authEmail: "zrihaneli@gmail.com",          workEmail: "eli@technoda.org.il" },
  { name: "שניר דואני",     authEmail: "snirdoani@gmail.com",          workEmail: "snir@technoda.org.il",        roles: { admin: true } },
  { name: "יעלה חדד",       authEmail: "lilachh16@gmail.com",          workEmail: "yeela@technoda.org.il" },
  { name: "איציק חיים",     authEmail: "izhakhaime@gmail.com",         workEmail: "izhak@technoda.org.il" },
  { name: "לירון אהרן",     authEmail: "lironlidi@gmail.com",          workEmail: "liron@technoda.org.il" },
  { name: "מור וייס",       authEmail: "morklein1@gmail.com",          workEmail: "mor@technoda.org.il" },
];
