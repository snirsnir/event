// ============================================================
// Google Apps Script — זימוני אירועים ביומן (Google Calendar → Outlook)
// ============================================================
// האירוע נוצר ביומן של בעל/ת הסקריפט, עם כל הנמענים כמוזמנים.
// Google שולח לכל מוזמן/ת הזמנה רגילה (iCalendar), שנפתחת ב-Outlook
// כזימון עם כפתורי אישור/דחייה.
//
// התקנה:
//   1. script.google.com → New project → להדביק את הקובץ הזה
//   2. Project Settings → Time zone: Asia/Jerusalem  (חובה — השעות נקבעות לפיו)
//   3. Project Settings → Script properties → SHARED_TOKEN = מחרוזת אקראית,
//      ואותה מחרוזת ב-APPS_SCRIPT_TOKEN ב-config.js
//   4. Deploy → New deployment → Web app | Execute as: Me | Who has access: Anyone
//   5. להעתיק את כתובת ה-/exec ל-APPS_SCRIPT_URL ב-config.js
//
// ⚠️ לעדכון הקוד — לא ליצור פריסה חדשה (זה משנה את הכתובת):
//    Deploy → Manage deployments → עיפרון → Version: New version → Deploy
// ============================================================

function doPost(e) {
  try {
    return handleRequest(JSON.parse(e.postData.contents));
  } catch (err) {
    return buildResponse({ success: false, error: err.toString() });
  }
}

function doGet() {
  return buildResponse({ status: 'ok', message: 'Event calendar service is running', timeZone: Session.getScriptTimeZone() });
}

function handleRequest(data) {
  const token = PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN');
  if (token && data.token !== token) {
    return buildResponse({ success: false, error: 'unauthorized' });
  }
  if (data.action === 'cancel') return cancelEvent(data);
  return createEvent(data);
}

// אירוע של יום אחד — אירוע רגיל.
// כמה ימים עם שעות — סדרה יומית מ-dateStart עד dateEnd באותן שעות.
// בלי שעות — אירוע של יום שלם על כל הטווח.
function createEvent(data) {
  const cal = CalendarApp.getDefaultCalendar();
  const opts = {
    description: data.description || '',
    location: data.location || '',
    guests: (data.guests || []).join(','),
    sendInvites: true,
  };
  const multiDay = data.dateEnd && data.dateEnd !== data.dateStart;
  let ev;

  if (!data.timeStart) {
    const end = new Date((data.dateEnd || data.dateStart) + 'T00:00:00');
    end.setDate(end.getDate() + 1);                    // יום שלם — הסוף לא כולל
    ev = cal.createAllDayEvent(data.title, new Date(data.dateStart + 'T00:00:00'), end, opts);
  } else if (!multiDay) {
    ev = cal.createEvent(data.title, at(data.dateStart, data.timeStart), at(data.dateStart, data.timeEnd || data.timeStart), opts);
  } else {
    const recurrence = CalendarApp.newRecurrence().addDailyRule().until(new Date(data.dateEnd + 'T23:59:59'));
    ev = cal.createEventSeries(data.title, at(data.dateStart, data.timeStart), at(data.dateStart, data.timeEnd || data.timeStart), recurrence, opts);
  }

  Logger.log('✅ זימון נוצר: ' + data.title + ' | ' + opts.guests);
  return buildResponse({ success: true, eventId: ev.getId(), timeZone: Session.getScriptTimeZone() });
}

// ביטול זימון — שולח הודעת ביטול לכל המוזמנים
function cancelEvent(data) {
  const cal = CalendarApp.getDefaultCalendar();
  try {
    const series = cal.getEventSeriesById(data.eventId);
    if (series) { series.deleteEventSeries(); return buildResponse({ success: true }); }
  } catch (err) { /* לא סדרה — ננסה כאירוע בודד */ }
  const ev = cal.getEventById(data.eventId);
  if (!ev) return buildResponse({ success: false, error: 'event not found' });
  ev.deleteEvent();
  return buildResponse({ success: true });
}

// "2026-08-01" + "09:00" → Date לפי אזור הזמן של הסקריפט
function at(dateIso, time) {
  const t = (time || '00:00').split(':');
  const d = new Date(dateIso + 'T00:00:00');
  d.setHours(+t[0], +(t[1] || 0), 0, 0);
  return d;
}

function buildResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
