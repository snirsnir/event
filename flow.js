// ============================================================
// FLOW.JS — שלב הבקשה, שיתוף הטופס, קבצים והערות הקב"ט, תמצית החלקים
//
// מסלול מלא:
//   בקשה (request) → סמנכ"ל תפעול מאשר/ת וממנה מנהל/ת אירוע → טיוטה (draft)
//   → הטופס המלא → pending_security → pending_deputy → pending_scheduler → approved
//   סמנכ"ל התפעול יכול/ה גם להחזיר את הבקשה למבקש/ת (request_returned),
//   והמבקש/ת מתקן/ת ושולח/ת שוב.
// ============================================================

const REQUEST_FIELDS = ["name", "goals", "dateStart", "dateEnd", "timeStart", "timeEnd", "location", "participants"];

function isRequest(ev) { return !!ev && ["request", "request_returned"].includes(ev.status); }
function canEditRequest(ev) { return ev.status === "request_returned" && (isRequester(ev) || isAdmin()); }
function canDecideRequest(ev) { return ev.status === "request" && hasRole("scheduler"); }

// האירוע "תופס" את התאריך: בקשה ממתינה, בקשה שאושרה (טיוטה עם מנהל/ת), וכל מה שבתהליך
function holdsDate(ev) {
  if (!ev.dateStart || ["cancelled", "request_returned"].includes(ev.status)) return false;
  return ev.status !== "draft" || !!ev.managerKey;
}

function ownerName(ev) { return ev.managerName || ev.createdByName || ""; }
function ownerMail(ev) {
  const p = S.staff[ownerKey(ev)];
  return (p && staffMail(p)) || ev.createdByWorkEmail || ev.createdBy;
}
function requesterMail(ev) {
  const p = S.staff[ev.createdByKey];
  return (p && staffMail(p)) || ev.createdByWorkEmail || ev.createdBy;
}
function schedulerName() {
  return approversFor(STAGES[STAGES.length - 1]).map(p => firstName(p.name)).join(" / ") || 'סמנכ"ל התפעול';
}

// ════════════════════════════════════════════════════════════
//  טופס הבקשה
// ════════════════════════════════════════════════════════════

function requestFieldsHtml(d) {
  return `<div class="hdr-grid">
    <div class="lbl req">שם האירוע:</div><div class="val"><input type="text" data-f="name" value="${esc(d.name)}" placeholder="למשל: ערב חוג ידידים"></div>
    <div class="lbl">פירוט הבקשה ומטרות:</div><div class="val"><textarea data-f="goals" placeholder="מה האירוע, למי הוא מיועד, ומה צריך">${esc(d.goals)}</textarea></div>
    <div class="lbl req">תאריך:</div><div class="val">
      <input type="date" data-f="dateStart" value="${esc(d.dateStart)}"> <span>עד</span>
      <input type="date" data-f="dateEnd" value="${esc(d.dateEnd)}" min="${esc(d.dateStart)}"> <span class="small muted">(ליום אחד — להשאיר ריק)</span></div>
    <div class="lbl">שעות:</div><div class="val"><input type="time" data-f="timeStart" value="${esc(d.timeStart)}"> <span>עד</span> <input type="time" data-f="timeEnd" value="${esc(d.timeEnd)}"></div>
    <div class="lbl">מיקום:</div><div class="val"><input type="text" data-f="location" value="${esc(d.location)}" placeholder="למשל: אודיטוריום ומבואה"></div>
    <div class="lbl">מס' משתתפים צפוי:</div><div class="val"><input type="number" min="0" data-f="participants" value="${esc(d.participants)}" style="width:140px"></div>
  </div>`;
}

function requestReadHtml(ev) {
  const row = (l, v) => `<div class="lbl">${l}</div><div class="val"><span class="ro">${v ? esc(v) : '<span class="muted">—</span>'}</span></div>`;
  return `<div class="hdr-grid">
    ${row("שם האירוע:", ev.name)}
    ${row("פירוט הבקשה ומטרות:", ev.goals)}
    ${row("מועד:", formatEventWhen(ev))}
    ${row("מיקום:", ev.location)}
    ${row("מס' משתתפים צפוי:", ev.participants)}
    ${row("הוגש ע\"י:", ev.createdByName + (ev.requestedAt ? " · " + fmtTs(ev.requestedAt) : ""))}
  </div>`;
}

function aiRequestBoxHtml() {
  return `<div class="ai-box no-print">
    <div class="ai-h">✨ כתבו במילים שלכם, והעוזר ינסח את הבקשה</div>
    <textarea id="reqDesc" placeholder="למשל: ערב לחוג הידידים ביום ראשון הבא מ-17:00 עד 21:00, בערך 80 איש, כמו בשנה שעברה.">${esc(editing.reqDesc || "")}</textarea>
    <div class="actions" style="justify-content:flex-end">
      <button class="btn btn-sm" data-act="aiRequest">✨ נסח לי את הבקשה</button>
    </div>
  </div>`;
}

function renderRequestForm() {
  const d = editing.data;
  const ev = editing.id ? S.events[editing.id] : null;
  const returned = ev && ev.status === "request_returned";
  const y = window.scrollY;
  $("page").innerHTML = `
    ${returned ? `<div class="panel returned">
      <h3>↩️ הבקשה הוחזרה אליך${ev.returnedByName ? " ע\"י " + esc(ev.returnedByName) : ""}</h3>
      <div style="white-space:pre-wrap">${esc(ev.returnReason || "")}</div>
      <div class="small muted" style="margin-top:8px">אחרי התיקון לחצו "שליחת הבקשה מחדש".</div>
    </div>` : ""}
    <div class="actions no-print" style="justify-content:space-between;margin-bottom:12px">
      <a href="#home" class="btn btn-light btn-sm">→ חזרה</a>
      <span>${ev ? statusChip(ev) : '<span class="status st-draft">בקשה חדשה</span>'} <span id="dirtyMark" class="small muted">${editing.dirty ? "● יש שינויים שלא נשמרו" : ""}</span></span>
    </div>
    <div class="form-title">${esc(d.name) || "בקשה לאירוע חדש"}</div>
    <div class="form-sub small muted">שלב ראשון: בקשה קצרה ל${esc(schedulerName())} (סמנכ"ל תפעול). אחרי האישור נפתח טופס ניהול האירוע המלא.</div>
    <div class="card">
      ${aiRequestBoxHtml()}
      ${editing.clonedFrom ? `<div class="banner"><span>⧉ הבקשה מבוססת על "${esc(editing.clonedFrom)}" — אחרי האישור הטופס המלא יגיע עם כל השורות שלו.</span></div>` : ""}
      ${requestFieldsHtml(d)}
      <div id="conflictsBox">${conflictsHtml(d, editing.id)}</div>
    </div>
    <div class="card no-print wiz-foot">
      <div class="actions" style="justify-content:space-between">
        <div class="actions">
          ${ev ? `<button class="btn btn-red btn-sm" data-act="cancelEvent">ביטול הבקשה</button>` : ""}
        </div>
        <button class="btn btn-green" data-act="submitRequest" style="font-size:15px;padding:11px 22px">${returned ? "📤 שליחת הבקשה מחדש" : "📤 שליחת הבקשה"}</button>
      </div>
    </div>
    ${ev ? historyHtml(ev) : ""}`;
  window.scrollTo(0, y);
}

async function doAiRequest(btn) {
  const description = ($("reqDesc").value || "").trim();
  if (description.length < 10) { toast("כתבו כמה מילים על האירוע", "error"); return; }
  editing.reqDesc = description;
  await aiBusy(btn, "מנסח...", async () => {
    const r = await callAI("request", { description, today: new Date().toISOString().slice(0, 10) });
    REQUEST_FIELDS.forEach(f => { if (r[f] && String(r[f]).trim()) editing.data[f] = String(r[f]).trim(); });
    if (editing.data.dateEnd && editing.data.dateEnd <= editing.data.dateStart) editing.data.dateEnd = "";
    markDirty();
    renderRequestForm();
    toast("העוזר ניסח את הבקשה — כדאי לעבור ולתקן לפני השליחה", "ok");
  });
}

async function submitRequest() {
  const d = editing.data;
  const err = validate(d);
  if (err) { toast(err, "error"); return; }
  const isNew = !editing.id;
  const id = editing.id || Store.newKey("events");
  const prev = isNew ? null : S.events[id];
  const now = Date.now();
  const patch = { updatedAt: now, updatedBy: S.me.name, status: "request", requestedAt: now,
    returnReason: null, returnedByName: null };
  if (isNew) {
    FORM_FIELDS.forEach(f => (patch[f] = d[f] == null ? "" : d[f]));
    Object.assign(patch, {
      sections: clone(d.sections), coordinator: S.me.name,
      createdAt: now, createdBy: S.me.authEmail, createdByKey: S.me.key,
      createdByName: S.me.name, createdByWorkEmail: S.me.workEmail || "",
    });
  }
  REQUEST_FIELDS.forEach(f => (patch[f] = d[f] == null ? "" : d[f]));
  if (patch.dateEnd === patch.dateStart) patch.dateEnd = "";
  patch["history/" + Store.newKey("h")] = histEntry(isNew ? "requested" : "re_requested",
    editing.clonedFrom ? { note: "על בסיס: " + editing.clonedFrom } : {});

  $("loading").classList.remove("hidden");
  try { await Store.update("events/" + id, patch); }
  catch (e) { $("loading").classList.add("hidden"); toast("שגיאה בשמירה: " + e.message, "error"); return; }
  $("loading").classList.add("hidden");
  editing = null;
  notifyRequest({ ...(prev || {}), ...patch, id }, approversFor(STAGES[STAGES.length - 1]));
  toast("הבקשה נשלחה ל" + schedulerName(), "ok");
  go("#event/" + id);
}

// ════════════════════════════════════════════════════════════
//  הבקשה אצל סמנכ"ל התפעול — אישור ומינוי מנהל/ת, או החזרה
// ════════════════════════════════════════════════════════════

function renderRequestView(ev) {
  const y = window.scrollY;
  const decide = canDecideRequest(ev);
  const hol = ev.dateStart ? HOLIDAYS.filter(h => h.start <= (ev.dateEnd || ev.dateStart) && h.end >= ev.dateStart) : [];
  $("page").innerHTML = `
    <div id="staleBanner" class="banner hidden no-print">הבקשה עודכנה בינתיים. <button class="btn btn-light btn-sm" data-act="refresh">רענון התצוגה</button></div>
    <div class="actions no-print" style="justify-content:space-between;margin-bottom:14px">
      <a href="#home" class="btn btn-light btn-sm">→ חזרה</a>
      <div class="actions">
        ${(isRequester(ev) || isAdmin()) ? `<button class="btn btn-red btn-sm" data-act="cancelEvent">ביטול הבקשה</button>` : ""}
      </div>
    </div>
    ${ev.status === "request_returned" ? `<div class="panel returned"><h3>↩️ הבקשה הוחזרה ל${esc(ev.createdByName)}</h3><div style="white-space:pre-wrap">${esc(ev.returnReason || "")}</div></div>` : ""}
    ${decide ? `<div class="panel no-print">
      <h3>📝 בקשה לאירוע — ההחלטה שלך</h3>
      ${conflictsHtml(ev, ev.id)}
      ${hol.length ? `<div class="conflicts warn">📅 ${hol.map(h => esc(h.name) + (h.closed ? " (המשרד סגור)" : "")).join(", ")}</div>` : ""}
      <div class="row2" style="margin-top:14px">
        <div class="field"><label>מנהל/ת האירוע</label>
          <select id="reqManager" class="inp" style="width:100%">
            ${activeStaff().map(p => `<option value="${esc(p.key)}" ${p.key === ev.createdByKey ? "selected" : ""}>${esc(p.name)}${p.key === ev.createdByKey ? " (הגיש/ה את הבקשה)" : ""}</option>`).join("")}
          </select>
          <div class="small muted" style="margin-top:4px">מנהל/ת האירוע ממלא/ת את הטופס המלא ושולח/ת אותו לאישורים.</div>
        </div>
      </div>
      <div class="field"><label>הערה ל${esc(firstName(ev.createdByName))} (בהחזרה — חובה)</label>
        <textarea id="reqNote" placeholder="למשל: התאריך תפוס, אפשר להזיז לשבוע אחרי?"></textarea></div>
      <div class="actions" style="justify-content:space-between">
        <button class="btn btn-red" data-act="returnRequest">↩️ החזרה למבקש/ת עם הערות</button>
        <button class="btn btn-green" data-act="approveRequest" style="font-size:15px;padding:11px 22px">✅ אישור הבקשה</button>
      </div>
    </div>` : ""}
    <div class="card">
      <div class="form-title">${esc(ev.name || "בקשה לאירוע")}</div>
      <div class="form-sub">${statusChip(ev)}</div>
      ${requestReadHtml(ev)}
    </div>
    ${historyHtml(ev)}`;
  window.scrollTo(0, y);
}

async function approveRequest(ev) {
  if (!canDecideRequest(ev)) return;
  const key = $("reqManager").value;
  const m = S.staff[key];
  if (!m) { toast("יש לבחור מנהל/ת אירוע", "error"); return; }
  const note = $("reqNote").value.trim();
  const now = Date.now();
  const patch = {
    status: "draft", managerKey: key, managerName: m.name, coordinator: m.name,
    eventManager: ev.eventManager || m.name,
    requestDecision: { by: S.me.name, at: now, note },
    updatedAt: now, updatedBy: S.me.name, returnReason: null, returnedByName: null,
    ["history/" + Store.newKey("h")]: histEntry("request_approved", { note: "מנהל/ת האירוע: " + m.name + (note ? "\n" + note : "") }),
  };
  await Store.update("events/" + ev.id, patch);
  notifyManagerAssigned({ ...ev, ...patch }, { key, ...m }, S.me.name, note);
  viewLock = false;
  toast("הבקשה אושרה — " + m.name + " קיבל/ה הודעה", "ok");
  render(true);
}

async function returnRequest(ev) {
  if (!canDecideRequest(ev)) return;
  const reason = $("reqNote").value.trim();
  if (!reason) { toast("יש לכתוב למבקש/ת מה לשנות", "error"); $("reqNote").focus(); return; }
  await Store.update("events/" + ev.id, {
    status: "request_returned", returnReason: reason, returnedByName: S.me.name, updatedAt: Date.now(), updatedBy: S.me.name,
    ["history/" + Store.newKey("h")]: histEntry("request_returned", { note: reason }),
  });
  notifyRequestReturned(ev, S.me.name, reason);
  viewLock = false;
  toast("הבקשה הוחזרה ל" + ev.createdByName, "ok");
  render(true);
}

// ════════════════════════════════════════════════════════════
//  מי עובד על האירוע: מבקש/ת, מנהל/ת, שותפים
// ════════════════════════════════════════════════════════════

function partnersOf(ev) {
  return Object.entries((ev && ev.partners) || {}).map(([key, p]) => ({ key, ...p }));
}
function canManagePartners(ev) { return !!ev && (isOwner(ev) || isAdmin()) && !["cancelled"].includes(ev.status); }

function peopleBarHtml(ev) {
  if (!ev) return "";
  const manage = canManagePartners(ev) && ["draft", "returned"].includes(ev.status);
  const parts = partnersOf(ev);
  if (!manage && !parts.length && !ev.managerKey) return "";
  return `<div class="people-bar no-print" id="peopleBar">
    ${ev.managerKey && ev.managerKey !== ev.createdByKey ? `<span class="small muted">📝 הוגש ע"י ${esc(ev.createdByName)}</span>` : ""}
    <span class="small">👤 מנהל/ת האירוע: <strong>${esc(ownerName(ev))}</strong></span>
    <span class="small muted">👥 שותפים:</span>
    <span class="chips">
      ${parts.map(p => `<span class="chip" title="שותף/ה מ-${esc(fmtTs(p.at))}">${esc(p.name)}${manage ? `<button type="button" data-act="unshare" data-key="${esc(p.key)}">×</button>` : ""}</span>`).join("") || (manage ? "" : '<span class="small muted">—</span>')}
      ${manage ? `<input class="chip-in" id="partnerIn" list="staffNames" placeholder="+ שיתוף עם עובד/ת">` : ""}
    </span>
  </div>`;
}

function refreshPeopleBar(ev) {
  const el = $("peopleBar");
  if (el) el.outerHTML = peopleBarHtml(ev) || "";
}

async function addPartner(input) {
  const ev = S.events[editing && editing.id];
  if (!ev) return;
  const o = resolveOwner(input.value.trim());
  input.value = "";
  if (!o || !o.key) { toast("לא נמצא/ה עובד/ת בשם הזה", "error"); return; }
  if (o.key === ownerKey(ev)) { toast(o.name + " כבר מנהל/ת את האירוע", "error"); return; }
  if (ev.partners && ev.partners[o.key]) return;
  await Store.update("events/" + ev.id, {
    ["partners/" + o.key]: { name: o.name, at: Date.now(), by: S.me.name },
    ["history/" + Store.newKey("h")]: histEntry("shared", { note: o.name }),
  });
  notifyShared(ev, { key: o.key, ...S.staff[o.key] }, S.me.name);
  toast(o.name + " יכול/ה עכשיו לעזור בטופס — נשלח מייל", "ok");
}

async function removePartner(key) {
  const ev = S.events[editing && editing.id];
  if (!ev || !ev.partners || !ev.partners[key]) return;
  await Store.update("events/" + ev.id, {
    ["partners/" + key]: null,
    ["history/" + Store.newKey("h")]: histEntry("unshared", { note: ev.partners[key].name }),
  });
}

// שותף/ה סיים/ה — שומרים, ומודיעים למנהל/ת האירוע לבדוק
async function partnerDone() {
  const id = editing && editing.id;
  if (!id) return;
  if (editing.dirty) { await saveEvent(false); if (editing && editing.dirty) return; }
  const ev = S.events[id];
  await Store.update("events/" + id, { ["history/" + Store.newKey("h")]: histEntry("partner_done") });
  notifyPartnerDone(ev, S.me.name);
  toast("נשלחה הודעה ל" + ownerName(ev) + " לבדוק את הטופס", "ok");
}

// ════════════════════════════════════════════════════════════
//  קבצים מצורפים והערות הקב"ט
// ════════════════════════════════════════════════════════════

function filesOf(ev) {
  return Object.entries((ev && ev.files) || {}).map(([key, f]) => ({ key, ...f })).sort((a, b) => a.at - b.at);
}
function hasKabatFile(ev) { return filesOf(ev).some(f => f.kind === "kabat"); }

function filesListHtml(ev, removable) {
  const files = filesOf(ev);
  if (!files.length) return "";
  return `<ul class="files">${files.map(f => `<li>
    <a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>
    <span class="small muted">${f.kind === "kabat" ? 'הנחיות קב"ט · ' : ""}${esc(f.by)} · ${esc(fmtTs(f.at))}</span>
    ${removable && (f.byKey === S.me.key || isAdmin()) ? `<button class="btn-icon no-print" data-act="removeFile" data-key="${esc(f.key)}" title="הסרה">✕</button>` : ""}
  </li>`).join("")}</ul>`;
}

function filesCardHtml(ev) {
  const list = filesListHtml(ev, false);
  return list ? `<div class="card"><div class="card-title" style="margin-bottom:8px">📎 קבצים מצורפים</div>${list}</div>` : "";
}

// הערות הקב"ט לסמנכ"ל התפעול ולמשנה למנכ"ל — גלויות להן, למנהל/ת האירוע ולשותפים
function securityNotesHtml(ev) {
  const n = ev && ev.securityNotes;
  if (!n || !n.text) return "";
  const can = isOwner(ev) || isPartner(ev) || isAdmin() || STAGES.some(s => hasRole(s.role));
  if (!can) return "";
  return `<div class="sec-notes">
    <div class="sec-notes-h">🛡️ הערות הקב"ט לסמנכ"ל התפעול ולמשנה למנכ"ל <span class="small muted">· ${esc(n.by)}, ${esc(fmtTs(n.at))}</span></div>
    <div style="white-space:pre-wrap">${esc(n.text)}</div>
  </div>`;
}

// חלק נוסף בפאנל האישור של הקב"ט: העלאת קובץ ההנחיות והערות למנהלות
function securityExtrasHtml(ev) {
  const big = +ev.participants > 100;
  return `<div class="sec-extras">
    <div class="field"><label>📎 קובץ הנחיות קב"ט העירייה</label>
      ${filesListHtml(ev, true)}
      <input type="file" id="kabatFile" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png">
      ${!hasKabatFile(ev) && big ? `<div class="small" style="color:var(--orange);margin-top:4px">⚠️ אירוע מעל 100 משתתפים — עדיין לא צורף קובץ הנחיות.</div>` : ""}
    </div>
    <div class="field"><label>הערות לסמנכ"ל התפעול ולמשנה למנכ"ל <span class="muted" style="font-weight:400">(יוצגו גם למנהל/ת האירוע)</span></label>
      <textarea id="secNotes" placeholder="למשל: הקב"ט העירוני דורש 2 מאבטחים מ-17:00, לתאם מול העירייה">${esc((ev.securityNotes && ev.securityNotes.text) || "")}</textarea></div>
  </div>`;
}

async function uploadEventFile(ev, file, kind) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast("הקובץ גדול מ-10MB", "error"); return; }
  $("loading").classList.remove("hidden");
  try {
    let url = "#";
    let driveId = "";
    if (!IS_DEMO) {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(new Error("קריאת הקובץ נכשלה"));
        r.readAsDataURL(file);
      });
      const res = await scriptCall("upload", { name: file.name, mime: file.type || "application/octet-stream", data, eventName: ev.name });
      url = res.url; driveId = res.id;
    }
    await Store.update("events/" + ev.id, {
      ["files/" + Store.newKey("f")]: { name: file.name, url, driveId, kind, by: S.me.name, byKey: S.me.key, at: Date.now() },
      ["history/" + Store.newKey("h")]: histEntry("file", { note: file.name }),
    });
    toast("הקובץ צורף", "ok");
  } catch (err) {
    toast("העלאת הקובץ נכשלה: " + err.message, "error");
  }
  $("loading").classList.add("hidden");
}

// ════════════════════════════════════════════════════════════
//  תמצית לכל חלק בטופס
// ════════════════════════════════════════════════════════════

// תיאור שהוגדר בתבנית, ואם אין — שמות הקטגוריות שבחלק
function sectionSummary(sec) {
  const own = String(sec.description || "").trim();
  if (own) return own;
  return [...new Set(toArr(sec.groups).map(g => String(g.name || "").trim()).filter(Boolean))].join(", ");
}
