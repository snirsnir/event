// ============================================================
// MAIL.JS — התראות במייל (EmailJS) וזימונים ליומן (Apps Script)
//           במצב הדגמה הכול נרשם ב"תיבת הדואר של ההדגמה" במקום להישלח.
// ============================================================

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function emailHtml(bodyContent, eventId) {
  const link = SYSTEM_URL + (eventId ? "#event/" + eventId : "");
  return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;direction:rtl;background:#eef2f7;padding:28px 16px;margin:0">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,86,0.10)">
    <div style="background:linear-gradient(135deg,#0056b3 0%,#0073e6 100%);padding:24px 32px;text-align:center">
      <div style="font-size:36px;margin-bottom:6px">🎪</div>
      <div style="color:#ffffff;font-size:18px;font-weight:700">ניהול אירועים — ${ORG_NAME}</div>
    </div>
    <div style="padding:28px 36px;color:#1a1a1a;font-size:15px;line-height:1.8">${bodyContent}</div>
    <div style="padding:0 36px 30px;text-align:center">
      <a href="${link}" style="display:inline-block;background:#0056b3;color:#ffffff;padding:13px 38px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">▶&nbsp; פתיחת האירוע במערכת</a>
    </div>
    <div style="background:#f4f6fa;padding:14px 32px;text-align:center;font-size:12px;color:#aaa;border-top:1px solid #eaecef">
      מערכת ניהול אירועים ${ORG_NAME} &nbsp;|&nbsp; הודעה אוטומטית — אין להשיב למייל זה
    </div>
  </div>
</div>`;
}

function infoBox(rows, borderColor = "#0056b3", bgColor = "#f0f6ff") {
  return `<div style="background:${bgColor};border-right:4px solid ${borderColor};padding:14px 18px;border-radius:6px;margin:18px 0;font-size:14px;line-height:2">
    ${rows.map(r => `<div>${r}</div>`).join("")}
  </div>`;
}

function eventInfoRows(ev) {
  return [
    `🎪 <strong>אירוע:</strong>&nbsp; ${escHtml(ev.name)}`,
    `📅 <strong>מועד:</strong>&nbsp; ${escHtml(formatEventWhen(ev))}`,
    `👤 <strong>רכז/ת אחראי/ת:</strong>&nbsp; ${escHtml(ev.coordinator || ev.createdByName)}`,
  ];
}

async function sendMail({ to, subject, html }) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return;
  if (IS_DEMO) {
    await Store.set("outbox/" + Store.newKey("outbox"),
      { kind: "mail", to: list, subject, html, at: Date.now() });
    return;
  }
  for (const toEmail of list) {
    try {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID,
        { to_name: toEmail, name: "ניהול אירועים " + ORG_NAME, email: REPLY_TO_EMAIL, subject, message: html },
        EMAILJS_PUBLIC_KEY);
    } catch (err) {
      console.error("❌ שגיאה בשליחת מייל ל-" + toEmail, err);
    }
  }
}

// ── התראות לפי שלב ───────────────────────────────────────

// האירוע הגיע לשלב — מייל לכל מי שמאשר/ת בשלב הזה
async function notifyStage(ev, stage, approvers, extraNote) {
  await sendMail({
    to: approvers.map(p => p.workEmail || p.authEmail),
    subject: `🖊️ אירוע ממתין לאישורך — ${ev.name}`,
    html: emailHtml(`
      <p>שלום,</p>
      <p>טופס ניהול אירוע ממתין לאישור שלך כ<strong>${escHtml(stage.label)}</strong>:</p>
      ${infoBox(eventInfoRows(ev))}
      ${extraNote ? infoBox([`💬 ${escHtml(extraNote)}`], "#e67e22", "#fef6ec") : ""}
    `, ev.id),
  });
}

// הוחזר לתיקון — מייל למי שיצר/ה את האירוע
async function notifyReturned(ev, stage, byName, reason) {
  await sendMail({
    to: ev.createdByWorkEmail || ev.createdBy,
    subject: `↩️ האירוע הוחזר לתיקון — ${ev.name}`,
    html: emailHtml(`
      <p>שלום <strong>${escHtml(ev.createdByName)}</strong>,</p>
      <p><strong>${escHtml(byName)}</strong> (${escHtml(stage.label)}) החזיר/ה את האירוע לתיקון.</p>
      ${infoBox(eventInfoRows(ev))}
      ${infoBox([`💬 <strong>הסיבה:</strong><br><em>${escHtml(reason)}</em>`], "#c0392b", "#fdf0ee")}
      <p style="color:#555;font-size:14px">אחרי התיקון והשליחה מחדש, האירוע יחזור ישירות ל${escHtml(stage.label)}.</p>
    `, ev.id),
  });
}

// אושר סופית — מייל ליוצר/ת
async function notifyApproved(ev) {
  await sendMail({
    to: ev.createdByWorkEmail || ev.createdBy,
    subject: `✅ האירוע אושר וזימון נשלח — ${ev.name}`,
    html: emailHtml(`
      <p>שלום <strong>${escHtml(ev.createdByName)}</strong>,</p>
      <p style="font-size:17px">🎉 האירוע <strong style="color:#1a7f4b">אושר בכל השלבים</strong>, וזימון נשלח ליומן.</p>
      ${infoBox(eventInfoRows(ev), "#1a7f4b", "#e8f7ee")}
    `, ev.id),
  });
}

// ── זימון ליומן ──────────────────────────────────────────
// מחזיר { ok, eventId?, error? }
async function sendCalendarInvite(invite) {
  const payload = {
    action: "create",
    token: APPS_SCRIPT_TOKEN,
    title: invite.title,
    description: invite.description,
    location: invite.location,
    dateStart: invite.dateStart,
    dateEnd: invite.dateEnd || invite.dateStart,
    timeStart: invite.timeStart,
    timeEnd: invite.timeEnd,
    guests: invite.recipients.map(r => r.email),
  };

  if (IS_DEMO) {
    await Store.set("outbox/" + Store.newKey("outbox"), {
      kind: "invite", to: payload.guests, subject: "📅 זימון: " + payload.title,
      html: `<pre style="white-space:pre-wrap;font-family:inherit">${escHtml(
        `${payload.dateStart}${payload.dateEnd !== payload.dateStart ? " – " + payload.dateEnd : ""}  ${payload.timeStart || ""}–${payload.timeEnd || ""}\n📍 ${payload.location || ""}\n\n${payload.description}`)}</pre>`,
      at: Date.now(),
    });
    return { ok: true, eventId: "demo" };
  }
  if (!APPS_SCRIPT_URL) return { ok: false, error: "כתובת Apps Script לא הוגדרה ב-config.js" };

  try {
    // POST עם text/plain — בקשה "פשוטה" בלי preflight, ותיאור ארוך לא נחתך כמו ב-URL
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data.success ? { ok: true, eventId: data.eventId } : { ok: false, error: data.error };
  } catch (err) {
    // שגיאת רשת/CORS — ייתכן שהזימון בכל זאת נשלח
    return { ok: false, error: "לא התקבלה תשובה משירות היומן (" + err.message + "). יש לבדוק ביומן אם הזימון נוצר." };
  }
}

// ביטול אירוע — מוחק אותו מהיומן ושולח הודעת ביטול לכל המוזמנים. מחזיר { ok, error? }
async function sendCalendarCancel(calendarEventId) {
  if (!APPS_SCRIPT_URL || !calendarEventId) return { ok: false, error: "אין מזהה זימון" };
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "cancel", token: APPS_SCRIPT_TOKEN, eventId: calendarEventId }),
    });
    const data = await res.json();
    return data.success ? { ok: true } : { ok: false, error: data.error };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── עוזר AI ── הבקשה עוברת דרך ה-Apps Script, שבודק שהמשתמש/ת עובד/ת פעיל/ה
// ושולח ל-Claude. מפתח ה-API ומאגר הידע נמצאים רק בהגדרות הסקריפט.
async function callAI(task, payload) {
  if (IS_DEMO) throw new Error("העוזר זמין רק במערכת האמיתית, לא במצב הדגמה");
  if (!APPS_SCRIPT_URL) throw new Error("כתובת Apps Script לא הוגדרה");
  const user = firebase.auth().currentUser;
  if (!user) throw new Error("נדרשת כניסה למערכת");
  const idToken = await user.getIdToken();
  let data;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "ai", token: APPS_SCRIPT_TOKEN, idToken, task, payload }),
    });
    data = await res.json();
  } catch (err) {
    throw new Error("אין תשובה מהעוזר (" + err.message + ")");
  }
  if (!data.success) throw new Error(data.error || "שגיאה בעוזר");
  return data.result;
}
