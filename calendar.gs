// ============================================================
// Google Apps Script — זימוני אירועים ביומן (Google Calendar → Outlook)
// ============================================================
// האירוע נוצר ביומן של בעל/ת הסקריפט, עם כל הנמענים כמוזמנים.
// Google שולח לכל מוזמן/ת הזמנה רגילה (iCalendar), שנפתחת ב-Outlook
// כזימון עם כפתורי אישור/דחייה. בביטול נשלחת הודעת ביטול שמסירה
// את האירוע גם מה-Outlook של המוזמנים.
//
// משתמש ב-Calendar API המלא (Advanced Service) ולא ב-CalendarApp:
//   - CalendarApp לא שולח הודעת ביטול למוזמנים כשמוחקים אירוע —
//     האירוע נמחק רק אצל המארגן ונשאר אצל כל השאר.
//   - ה-API מאפשר sendUpdates: 'all' ביצירה ובביטול, ולהסיר את קישור
//     ה-Google Meet שגוגל מוסיף אוטומטית.
//
// התקנה:
//   1. script.google.com → להדביק את הקובץ הזה
//   2. Services (+) בתפריט השמאלי → Google Calendar API → Add
//      (המזהה חייב להישאר Calendar)
//   3. Project Settings → Time zone: Asia/Jerusalem
//   4. Project Settings → Script properties → SHARED_TOKEN = אותו ערך כמו APPS_SCRIPT_TOKEN ב-config.js
//   5. פריסה ראשונה: Deploy → New deployment → Web app | Execute as: Me | Who has access: Anyone
//      והעתקת כתובת ה-/exec ל-APPS_SCRIPT_URL ב-config.js
//
// ⚠️ לעדכון הקוד — לא ליצור פריסה חדשה (זה משנה את הכתובת):
//    Deploy → Manage deployments → עיפרון → Version: New version → Deploy
// ============================================================

var CALENDAR_ID = 'primary';
var TIME_ZONE   = 'Asia/Jerusalem';

function doPost(e) {
  try {
    return handleRequest(JSON.parse(e.postData.contents));
  } catch (err) {
    return buildResponse({ success: false, error: err.toString() });
  }
}

function doGet() {
  return buildResponse({
    status: 'ok', message: 'Event calendar service is running',
    timeZone: Session.getScriptTimeZone(),
    advancedCalendar: typeof Calendar !== 'undefined',
  });
}

function handleRequest(data) {
  const token = PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN');
  if (token && data.token !== token) {
    return buildResponse({ success: false, error: 'unauthorized' });
  }
  if (typeof Calendar === 'undefined') {
    return buildResponse({ success: false, error: 'יש להפעיל את Google Calendar API בתפריט Services של הסקריפט' });
  }
  if (data.action === 'cancel') return cancelEvent(data);
  return createEvent(data);
}

// אירוע של יום אחד — אירוע רגיל.
// כמה ימים עם שעות — סדרה יומית מ-dateStart עד dateEnd באותן שעות.
// בלי שעות — אירוע של יום שלם על כל הטווח.
function createEvent(data) {
  const dateEnd = data.dateEnd || data.dateStart;
  const multiDay = dateEnd !== data.dateStart;
  const resource = {
    summary: data.title,
    description: data.description || '',
    location: data.location || '',
    attendees: (data.guests || []).map(function (g) { return { email: g }; }),
    guestsCanModify: false,
    reminders: { useDefault: true },
  };

  if (!data.timeStart) {
    resource.start = { date: data.dateStart };
    resource.end   = { date: addDays(dateEnd, 1) };      // יום שלם — הסוף לא כולל
  } else {
    const timeEnd = data.timeEnd || data.timeStart;
    resource.start = { dateTime: data.dateStart + 'T' + data.timeStart + ':00', timeZone: TIME_ZONE };
    resource.end   = { dateTime: data.dateStart + 'T' + timeEnd + ':00', timeZone: TIME_ZONE };
    if (multiDay) {
      resource.recurrence = ['RRULE:FREQ=DAILY;UNTIL=' + dateEnd.replace(/-/g, '') + 'T235959Z'];
    }
  }

  const ev = Calendar.Events.insert(resource, CALENDAR_ID, { sendUpdates: 'all', conferenceDataVersion: 1 });

  // אם בהגדרות היומן מופעל "הוסף Google Meet אוטומטית" — מסירים את הקישור
  if (ev.conferenceData || ev.hangoutLink) {
    try {
      Calendar.Events.patch({ conferenceData: null }, CALENDAR_ID, ev.id, { conferenceDataVersion: 1, sendUpdates: 'none' });
    } catch (err) {
      Logger.log('⚠️ הסרת Meet נכשלה: ' + err);
    }
  }

  Logger.log('✅ זימון נוצר: ' + data.title + ' | ' + (data.guests || []).join(','));
  return buildResponse({ success: true, eventId: ev.id, timeZone: Session.getScriptTimeZone() });
}

// ביטול — מוחק את האירוע (כולל סדרה שלמה) ושולח הודעת ביטול לכל המוזמנים
function cancelEvent(data) {
  // אירועים שנוצרו בגרסה הקודמת (CalendarApp) נשמרו עם הסיומת @google.com
  const id = String(data.eventId || '').replace(/@google\.com$/, '');
  if (!id) return buildResponse({ success: false, error: 'missing eventId' });
  try {
    Calendar.Events.remove(CALENDAR_ID, id, { sendUpdates: 'all' });
  } catch (err) {
    return buildResponse({ success: false, error: err.toString() });
  }
  Logger.log('🗑️ זימון בוטל: ' + id);
  return buildResponse({ success: true });
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
