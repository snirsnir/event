// ============================================================
// APP.JS — מערכת ניהול אירועים: כניסה, ניתוב, טופס, שרשרת אישורים,
//          משימות ולוח מצב. עמדת הניהול ב-admin.js.
//
// מסלול האירוע:
//   draft → pending_security → pending_deputy → pending_scheduler → approved
//   כל שלב יכול להחזיר לתיקון (returned). אחרי תיקון ושליחה מחדש האירוע
//   חוזר ישירות לשלב שהחזיר אותו (returnedFrom), ולא מתחילת השרשרת.
// ============================================================

const S = {
  user: null,        // { email, name } מה-auth
  me: null,          // רשומת העובד/ת המחובר/ת (+ key)
  staff: {},         // emailKey → עובד/ת
  settings: {},
  events: {},        // id → אירוע (מנורמל)
  outbox: {},        // מצב הדגמה בלבד
  loaded: { staff: false, events: false, settings: false },
};

let unsubs = [];
let editing = null;     // { id|null, data, dirty, clonedFrom? } — טופס בעריכה
let mounted = "";       // מה מוצג כרגע ב-#page — כדי לא לבנות מחדש טופס בעריכה
let viewLock = false;   // המאשר/ת באמצע חתימה/עריכת זימון — לא לדרוס את המסך
let sigPad = null;
let homeTab = null;
let boardFilter = "active";
let showDoneTasks = false;
let showPast = false;
let skipHashGuard = false;
let renderQueued = false;

const FORM_FIELDS = ["name", "goals", "dateStart", "dateEnd", "timeStart", "timeEnd", "location",
  "participants", "coordinator", "eventManager", "eventManagerSub", "calendarCoordinated", "calendarDetails", "parallelEvents", "parallelDetails"];

const $ = id => document.getElementById(id);
const esc = escHtml;
const rid = () => Math.random().toString(36).slice(2, 9);
const clone = v => JSON.parse(JSON.stringify(v));
const toArr = v => Array.isArray(v) ? v.filter(x => x != null) : (v ? Object.values(v) : []);

// ════════════════════════════════════════════════════════════
//  עזרי תצוגה
// ════════════════════════════════════════════════════════════

function toast(msg, type = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "show " + type;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = ""), 3200);
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatEventWhen(ev) {
  if (!ev.dateStart) return "—";
  let s = fmtDate(ev.dateStart);
  if (ev.dateEnd && ev.dateEnd !== ev.dateStart) s += " – " + fmtDate(ev.dateEnd);
  if (ev.timeStart) s += " · " + ev.timeStart + (ev.timeEnd ? "–" + ev.timeEnd : "");
  return s;
}

function statusChip(ev) {
  const st = STATUS_LABELS[ev.status] || STATUS_LABELS.draft;
  let text = st.text;
  if (ev.status === "returned" && ev.returnedFrom) {
    const stage = STAGES.find(s => s.status === ev.returnedFrom);
    if (stage) text += " (" + stage.label + ")";
  }
  return `<span class="status ${st.cls}">${esc(text)}</span>`;
}

function roleTags(p) {
  const r = p.roles || {};
  return Object.keys(ROLE_LABELS).filter(k => r[k])
    .map(k => `<span class="role-tag ${k}">${esc(ROLE_LABELS[k])}</span>`).join("");
}

// ════════════════════════════════════════════════════════════
//  עובדים, הרשאות
// ════════════════════════════════════════════════════════════

function staffList() {
  return Object.entries(S.staff).map(([key, p]) => ({ key, ...p }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "he"));
}
function activeStaff() { return staffList().filter(p => p.active !== false); }
function staffMail(p) { return p ? (p.workEmail || p.authEmail) : ""; }
function approversFor(stage) { return activeStaff().filter(p => p.roles && p.roles[stage.role]); }
function isAdmin() { return !!(S.me && S.me.roles && S.me.roles.admin); }
function hasRole(role) { return !!(S.me && S.me.roles && S.me.roles[role]); }
function isCreator(ev) { return S.me && ev.createdByKey === S.me.key; }
function currentStage(ev) { return STAGES.find(s => s.status === ev.status) || null; }

function canEdit(ev) {
  return ["draft", "returned"].includes(ev.status) && (isCreator(ev) || isAdmin());
}
function canApprove(ev) {
  const st = currentStage(ev);
  return !!st && hasRole(st.role);
}
function isActiveEvent(ev) { return !["draft", "cancelled"].includes(ev.status); }
// מחיקה לצמיתות — רק אירוע שבוטל או טיוטה, ורק היוצר/ת או אדמין
function canDelete(ev) {
  return ["cancelled", "draft"].includes(ev.status) && (isCreator(ev) || isAdmin());
}

async function deleteEvent(ev) {
  const what = ev.status === "draft" ? "הטיוטה" : "האירוע שבוטל";
  if (!confirm(`למחוק את ${what} "${ev.name}" לצמיתות?\nלא ניתן לשחזר.`)) return false;
  await Store.set("events/" + ev.id, null);
  toast(what === "הטיוטה" ? "הטיוטה נמחקה" : "האירוע נמחק מהרשימה", "ok");
  return true;
}

// "אמילי" → אמילי גולן (אם יש בדיוק אחת). אחרת נשאר טקסט חופשי בלי קישור לעובד/ת.
function resolveOwner(name) {
  name = String(name || "").trim();
  if (!name) return null;
  const all = activeStaff();
  let hit = all.find(p => p.name === name);
  if (!hit) {
    const byFirst = all.filter(p => (p.name || "").split(" ")[0] === name);
    if (byFirst.length === 1) hit = byFirst[0];
  }
  return hit ? { name: hit.name, key: hit.key } : { name, key: null };
}

function rowOwnedByMe(row) {
  return toArr(row.owners).some(o => o.key && S.me && o.key === S.me.key);
}
function canMarkDone(ev, row) {
  return isActiveEvent(ev) && (rowOwnedByMe(row) || isCreator(ev) || isAdmin());
}

// ════════════════════════════════════════════════════════════
//  מודל האירוע
// ════════════════════════════════════════════════════════════

function newEventData() {
  return {
    name: "", goals: "", dateStart: "", dateEnd: "", timeStart: "", timeEnd: "", location: "",
    participants: "", coordinator: S.me ? S.me.name : "", eventManager: "", eventManagerSub: "",
    calendarCoordinated: "", calendarDetails: "", parallelEvents: "", parallelDetails: "",
    status: "draft",
    // התבנית מעמדת הניהול (settings/template), ואם אין — התבנית המקורית מהאקסל
    sections: currentTemplate().map(sec => ({
      id: rid(), title: sec.title, note: sec.note || "", enabled: true,
      groups: sec.groups.map(g => ({
        id: rid(), name: g.name,
        rows: g.rows.map(r => ({
          id: rid(), item: r.item, owners: r.owners.map(resolveOwner).filter(Boolean),
          qty: r.qty || "", location: "",
        })),
      })),
    })),
  };
}

function normEvent(id, ev) {
  ev = ev || {};
  ev.id = id;
  ev.sections = toArr(ev.sections).map(s => ({
    ...s, enabled: s.enabled !== false, title: s.title || "", note: s.note || "",
    groups: toArr(s.groups).map(g => ({
      ...g, name: g.name || "",
      rows: toArr(g.rows).map(r => ({ ...r, owners: toArr(r.owners), item: r.item || "", qty: r.qty || "", location: r.location || "" })),
    })),
  }));
  ev.signatures = ev.signatures || {};
  ev.done = ev.done || {};
  ev.history = toArr(ev.history).sort((a, b) => a.at - b.at);
  if (ev.invite) ev.invite.recipients = toArr(ev.invite.recipients);
  return ev;
}

// כל השורות של החלקים הכלולים, עם הקטגוריה
function allRows(ev) {
  const out = [];
  ev.sections.forEach(sec => {
    if (!sec.enabled) return;
    sec.groups.forEach(g => g.rows.forEach(r => {
      if (r.item || r.owners.length) out.push({ sec, group: g, row: r });
    }));
  });
  return out;
}

function taskProgress(ev) {
  const rows = allRows(ev);
  const done = rows.filter(x => ev.done[x.row.id]).length;
  return { done, total: rows.length };
}

function progressHtml(ev) {
  const { done, total } = taskProgress(ev);
  if (!total) return "";
  const pct = Math.round(done / total * 100);
  return `<span class="progress" title="${done}/${total} משימות בוצעו"><i style="width:${pct}%"></i></span> <span class="small muted">${done}/${total}</span>`;
}

// ── התנגשויות תאריכים ──
function dayNum(iso) { return Math.round(Date.parse(iso + "T00:00:00Z") / 86400000); }

function findConflicts(d, selfId) {
  if (!d.dateStart) return { overlap: [], adjacent: [] };
  const a1 = dayNum(d.dateStart), a2 = dayNum(d.dateEnd || d.dateStart);
  const overlap = [], adjacent = [];
  Object.values(S.events).forEach(ev => {
    if (ev.id === selfId || !isActiveEvent(ev) || !ev.dateStart) return;
    const b1 = dayNum(ev.dateStart), b2 = dayNum(ev.dateEnd || ev.dateStart);
    if (a1 <= b2 && b1 <= a2) overlap.push(ev);
    else if (b1 - a2 === 1 || a1 - b2 === 1) adjacent.push(ev);
  });
  return { overlap, adjacent };
}

function conflictsHtml(d, selfId) {
  if (!d.dateStart) return "";
  const { overlap, adjacent } = findConflicts(d, selfId);
  if (!overlap.length && !adjacent.length) {
    return `<div class="conflicts ok">✓ לא נמצאו אירועים אחרים במערכת בתאריכים האלה.</div>`;
  }
  const li = ev => `<li><a href="#event/${esc(ev.id)}">${esc(ev.name || "ללא שם")}</a> — ${esc(formatEventWhen(ev))} ${statusChip(ev)}</li>`;
  return `<div class="conflicts warn">
    ${overlap.length ? `<strong>⚠️ אירועים חופפים (${overlap.length}):</strong><ul>${overlap.map(li).join("")}</ul>` : ""}
    ${adjacent.length ? `<strong style="display:block;margin-top:6px">↔️ אירועים נושקים (יום לפני/אחרי):</strong><ul>${adjacent.map(li).join("")}</ul>` : ""}
  </div>`;
}

// ── "מה שכחתי?" — בדיקות לפי הנהלים והלקחים שבתיעוד (technoda-events-kb, סעיפים 4 ו-6) ──
// level: "warn" — כנראה חסר משהו מהותי. "tip" — תזכורת שכדאי לבדוק.
function eventChecks(d, selfId) {
  const out = [];
  const warn = text => out.push({ level: "warn", text });
  const tip = text => out.push({ level: "tip", text });
  const n = +d.participants || 0;
  const rows = allRows(d).filter(x => x.row.item);
  const has = re => rows.some(({ group, row }) => re.test(group.name + " " + row.item));
  const today = new Date().toISOString().slice(0, 10);

  const noOwner = rows.filter(x => !x.row.owners.length);
  if (noOwner.length) {
    warn(`${noOwner.length} משימות בלי אחראי/ת: ${noOwner.slice(0, 3).map(x => x.row.item).join(", ")}${noOwner.length > 3 ? " ועוד" : ""}.`);
  }
  if (!d.eventManager) warn("לא צוין/ה מנהל/ת אירוע בשטח (ומחליף/ה אם הוא/היא לא יכול/ה להיות).");
  if (!n) tip("לא צוין מספר משתתפים — הוא קובע כמויות כיבוד וכיסאות, ואם צריך מאבטח.");
  if (d.dateStart && !d.timeStart) tip("לא צוינו שעות לאירוע.");

  if (d.dateStart) {
    const a = d.dateStart, b = d.dateEnd || d.dateStart;
    HOLIDAYS.filter(h => h.start <= b && h.end >= a).forEach(h =>
      (h.closed ? warn : tip)(`האירוע חל ב${h.name}${h.closed ? " — המשרד סגור" : ""}.`));
    const c = findConflicts(d, selfId);
    if (c.overlap.length) warn(`יש ${c.overlap.length} אירועים חופפים במערכת — לבדוק שהמתחמים וכוח האדם לא מתנגשים.`);
    else if (c.adjacent.length) tip("יש אירוע צמוד (יום לפני או אחרי) — לבדוק זמני הקמה ופירוק.");

    const daysLeft = dayNum(a) - dayNum(today);
    if (n > 100 && daysLeft >= 0 && daysLeft < 21) {
      warn(`לפי הנוהל, אירוע מעל 100 משתתפים מוגש 3–4 שבועות מראש. נשארו ${daysLeft} ימים.`);
    }
    if (new Date(a + "T12:00:00Z").getUTCDay() === 5 && (!d.timeEnd || d.timeEnd > "14:00")) {
      tip("אירוע בשישי: האחזקה מסיימת ב-14:00 — לתאם מי סוגר, מכבה ומדווח למוקד.");
    }
  }

  if (n > 100) {
    if (!has(/בטיחות/)) warn("אירוע מעל 100 משתתפים בלי משימות בטיחות בטופס (תיק בטיחות, משקיף).");
    if (!has(/שמיר|אבטח|מאבטח|שומר/)) warn("מעל 100 משתתפים נדרש מאבטח חמוש — אין שורת שמירה/אבטחה. לשריין מוקדם, יש מחסור.");
    tip('הזימון יועבר לקב"ט העירייה — לצרף את ההנחיות שלו לטופס כשיגיעו.');
  }
  if (n >= 500) tip("אירוע גדול: לשקול אמבולנס — קשה להשיג פחות משבועיים לפני.");
  if (d.timeEnd && d.timeEnd >= "18:00") tip("אירוע ערב: איש אחזקה ומנקה שנשארים, והארכת שעות השומר.");
  if (has(/כיבוד|מזון|ארוח|לחמני|סופגני/)) tip("יש כיבוד — לבדוק אלרגיות מסכנות חיים (בוטנים, אגוזים) מול המלווים.");
  if (n > 0 && has(/כיבוד/) && !rows.some(x => /כיבוד/.test(x.row.item) && x.row.qty)) {
    tip(`לא צוינה כמות כיבוד. בדרך כלל מזמינים לכ-90% מהמשתתפים (כ-${Math.round(n * 0.9)}).`);
  }
  return out;
}

function checksHtml(list, title = "🔎 מה שכחתי?") {
  if (!list.length) return `<div class="checks ok"><strong>${title}</strong> <span>✓ לא נמצא משהו חסר לפי הנהלים.</span></div>`;
  const warns = list.filter(c => c.level === "warn"), tips = list.filter(c => c.level === "tip");
  return `<div class="checks">
    <div class="checks-h"><strong>${title}</strong><span class="small muted">${warns.length ? warns.length + " לטיפול" : ""}${warns.length && tips.length ? " · " : ""}${tips.length ? tips.length + " תזכורות" : ""}</span></div>
    <ul>${warns.map(c => `<li class="warn">${esc(c.text)}</li>`).join("")}${tips.map(c => `<li class="tip">${esc(c.text)}</li>`).join("")}</ul>
  </div>`;
}

// ── סיכום אחרי האירוע: מה עבד, מה לא, מה לשנות. נשמר ב-events/{id}/summary ──
// זה גם המקור לזיכרון של העוזר בהמשך — לקחים מהאירועים שלכם, לא רק מהמייל.
function eventEnded(ev) {
  const today = new Date().toISOString().slice(0, 10);
  return ev.status === "approved" && !!ev.dateStart && (ev.dateEnd || ev.dateStart) < today;
}
function canSummarize(ev) {
  return eventEnded(ev) && (isCreator(ev) || isAdmin() || (S.me && ev.eventManager && ev.eventManager === S.me.name));
}
function awaitingSummary() {
  return Object.values(S.events).filter(ev => canSummarize(ev) && !ev.summary && isCreator(ev));
}

function summaryCardHtml(ev) {
  if (!eventEnded(ev)) return "";
  const s = ev.summary;
  if (s && !summaryEditing) {
    const block = (t, v) => v ? `<div class="field"><label>${t}</label><div style="white-space:pre-wrap">${esc(v)}</div></div>` : "";
    return `<div class="card">
      <div class="card-header"><span class="card-title">📝 סיכום אחרי האירוע</span>
        ${canSummarize(ev) ? `<button class="btn btn-light btn-sm no-print" data-act="editSummary">עריכה</button>` : ""}</div>
      ${s.actualParticipants ? `<div class="small" style="margin-bottom:10px">השתתפו בפועל: <strong>${esc(s.actualParticipants)}</strong>${ev.participants ? ` (צפי: ${esc(ev.participants)})` : ""}</div>` : ""}
      ${block("✅ מה עבד טוב", s.worked)}${block("⚠️ מה לא עבד", s.didnt)}${block("🔁 מה לשנות בפעם הבאה", s.change)}
      <div class="small muted">${esc(s.by)} · ${esc(fmtTs(s.at))}</div>
    </div>`;
  }
  if (!canSummarize(ev)) return "";
  const v = s || {};
  return `<div class="panel no-print" style="border-top-color:var(--blue)">
    <h3>📝 האירוע הסתיים — איך היה?</h3>
    <div class="small muted" style="margin-bottom:12px">שלוש שאלות קצרות. הלקחים יעזרו באירוע הבא, ויוצגו כשמשכפלים את האירוע.</div>
    <div class="field" style="max-width:220px"><label>כמה השתתפו בפועל?</label><input type="text" data-sum="actualParticipants" value="${esc(v.actualParticipants || "")}" placeholder="${esc(ev.participants || "")}"></div>
    <div class="field"><label>✅ מה עבד טוב?</label><textarea data-sum="worked">${esc(v.worked || "")}</textarea></div>
    <div class="field"><label>⚠️ מה לא עבד / מה שכחנו?</label><textarea data-sum="didnt">${esc(v.didnt || "")}</textarea></div>
    <div class="field"><label>🔁 מה לשנות בפעם הבאה?</label><textarea data-sum="change">${esc(v.change || "")}</textarea></div>
    <div class="actions" style="justify-content:flex-end">
      ${s ? `<button class="btn btn-light" data-act="cancelSummary">ביטול</button>` : ""}
      <button class="btn btn-green" data-act="saveSummary">💾 שמירת הסיכום</button>
    </div>
  </div>`;
}

let summaryEditing = false;

async function saveSummary(ev) {
  const val = f => (document.querySelector(`[data-sum="${f}"]`) || {}).value || "";
  const summary = {
    actualParticipants: val("actualParticipants").trim(), worked: val("worked").trim(),
    didnt: val("didnt").trim(), change: val("change").trim(), by: S.me.name, at: Date.now(),
  };
  if (!summary.worked && !summary.didnt && !summary.change) { toast("יש למלא לפחות שאלה אחת", "error"); return; }
  await Store.update("events/" + ev.id, {
    summary, ["history/" + Store.newKey("h")]: histEntry("summary"),
  });
  summaryEditing = false; viewLock = false;
  toast("הסיכום נשמר — תודה!", "ok");
  render(true);
}

// לקחים מאירועים קודמים באותו שם — מוצגים כשמשכפלים או פותחים אירוע דומה
function lessonsFor(name) {
  const key = String(name || "").replace(/\s*\(העתק\)$/, "").trim();
  if (!key) return [];
  return Object.values(S.events)
    .filter(ev => ev.summary && (ev.summary.didnt || ev.summary.change) && ev.name && (ev.name.includes(key) || key.includes(ev.name)))
    .sort((a, b) => (b.dateStart || "").localeCompare(a.dateStart || ""));
}

function lessonsHtml(name) {
  const list = lessonsFor(name).slice(0, 3);
  if (!list.length) return "";
  return `<div class="checks" style="border-color:#cfdcf5;background:#f5f8ff">
    <div class="checks-h"><strong>📚 לקחים מאירועים קודמים</strong></div>
    <ul>${list.map(ev => `<li class="tip"><a href="#event/${esc(ev.id)}">${esc(ev.name)} (${esc(fmtDate(ev.dateStart))})</a>: ${esc([ev.summary.didnt, ev.summary.change].filter(Boolean).join(" · "))}</li>`).join("")}</ul>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  עוזר AI — מילוי מתיאור, ניסוח זימון, בדיקה ותקציר
// ════════════════════════════════════════════════════════════

let aiStyleChoice = "regular";   // הסגנון האחרון שנבחר לניסוח הזימון
const aiReviews = {};   // evId|"draft" → { brief, items } — תוצאת הבדיקה האחרונה בסשן

// האירוע בצורה קומפקטית לשליחה לעוזר: רק מה שהוא צריך, עם שמות האחראים
function aiEventPayload(d, id) {
  const out = { id: id || "" };
  FORM_FIELDS.forEach(f => { if (d[f]) out[f] = d[f]; });
  if (d.dateStart) out.weekday = weekdayOf(d.dateStart);
  out.sections = d.sections.filter(s => s.enabled).map(s => ({
    title: s.title, note: s.note || undefined,
    rows: s.groups.flatMap(g => g.rows.filter(r => r.item).map(r => ({
      group: g.name, item: r.item, owners: r.owners.map(o => o.name),
      qty: r.qty || undefined, location: r.location || undefined,
    }))),
  }));
  return out;
}

async function aiBusy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "⏳ " + label;
  try { await fn(); }
  catch (err) { toast(err.message, "error"); btn.disabled = false; btn.innerHTML = old; }
}

// ── 1. מילוי הטופס מתיאור חופשי (שלב הפרטים באשף) ──
function aiFillBoxHtml() {
  if (editing.id && S.events[editing.id] && S.events[editing.id].status !== "draft") return "";
  return `<div class="ai-box no-print">
    <div class="ai-h">✨ תאר/י את האירוע במילים שלך, והעוזר ימלא את הטופס</div>
    <textarea id="aiDesc" placeholder="למשל: ערב הורים וילדים לתוכנית המצוינות ב-12.11, 18:30–21:00, בערך 160 משתתפים, סדנאות במעבדות 3–6 וקבלת פנים באודיטוריום. מרי מנהלת את האירוע.">${esc(editing.aiDesc || "")}</textarea>
    <div class="actions" style="justify-content:space-between">
      <span class="small muted">העוזר ממלא את הפרטים ומתאים את השורות לפי אירועים דומים מהעבר. אחר כך עוברים על הכול ומתקנים.</span>
      <button class="btn btn-sm" data-act="aiFill">✨ מלא לי את הטופס</button>
    </div>
    ${editing.aiNotes ? `<div class="ai-notes">💬 ${esc(editing.aiNotes)}</div>` : ""}
  </div>`;
}

async function doAiFill(btn) {
  const description = ($("aiDesc").value || "").trim();
  if (description.length < 10) { toast("כתבו כמה מילים על האירוע", "error"); return; }
  editing.aiDesc = description;
  const d = editing.data;
  await aiBusy(btn, "העוזר ממלא...", async () => {
    const r = await callAI("fill", {
      description,
      today: new Date().toISOString().slice(0, 10),
      template: d.sections.map(s => ({ title: s.title, groups: s.groups.map(g => ({ name: g.name, rows: g.rows.map(x => ({ item: x.item, owners: x.owners.map(o => o.name) })) })) })),
      staff: activeStaff().map(p => ({ name: p.name, roles: Object.keys(p.roles || {}).filter(k => p.roles[k]) })),
    });
    const stats = applyAiFill(d, r);
    editing.aiNotes = r.notes || "";
    markDirty();
    renderEditor();
    toast(`העוזר מילא את הטופס${stats ? " · " + stats : ""} — כדאי לעבור על השלבים`, "ok");
  });
}

function applyAiFill(d, r) {
  const norm = s => String(s || "").trim();
  ["name", "goals", "dateStart", "dateEnd", "timeStart", "timeEnd", "location", "participants", "eventManager"].forEach(f => {
    if (norm(r[f])) d[f] = norm(r[f]);
  });
  if (d.dateEnd && d.dateEnd <= d.dateStart) d.dateEnd = "";
  const sec = t => d.sections.find(s => norm(s.title) === norm(t));
  const findRow = x => {
    const s = sec(x.section); if (!s) return null;
    for (const g of s.groups) {
      if (x.group && norm(g.name) !== norm(x.group)) continue;
      const i = g.rows.findIndex(row => norm(row.item) === norm(x.item));
      if (i >= 0) return { g, i };
    }
    return null;
  };
  let off = 0, removed = 0, added = 0;
  (r.sectionsOff || []).forEach(t => { const s = sec(t); if (s && s.enabled) { s.enabled = false; off++; } });
  (r.remove || []).forEach(x => { const f = findRow(x); if (f) { f.g.rows.splice(f.i, 1); removed++; } });
  (r.qty || []).forEach(x => { const f = findRow(x); if (f && norm(x.qty)) f.g.rows[f.i].qty = norm(x.qty); });
  (r.add || []).forEach(x => {
    if (!norm(x.item) || findRow(x)) return;
    let s = sec(x.section);
    if (!s) {
      s = { id: rid(), title: norm(x.section) || "חלק נוסף", note: "", enabled: true, groups: [] };
      d.sections.push(s);
    }
    s.enabled = true;
    let g = s.groups.find(g => norm(g.name) === norm(x.group));
    if (!g) { g = { id: rid(), name: norm(x.group), rows: [] }; s.groups.push(g); }
    g.rows.push({ id: rid(), item: norm(x.item), owners: (x.owners || []).map(resolveOwner).filter(Boolean), qty: norm(x.qty), location: "" });
    added++;
  });
  const parts = [];
  if (added) parts.push(`${added} שורות נוספו`);
  if (removed) parts.push(`${removed} הוסרו`);
  if (off) parts.push(`${off} חלקים כובו`);
  return parts.join(", ");
}

// ── 2. ניסוח הזימון (שלב סמנכ"ל התפעול) ──
function aiInviteToolsHtml() {
  return `<span class="ai-inline">
    <select id="aiStyle" class="inp" title="סגנון הניסוח">
      ${[["regular", "רגיל"], ["short", "קצר"], ["detailed", "מפורט"]].map(([v, l]) => `<option value="${v}" ${v === aiStyleChoice ? "selected" : ""}>${l}</option>`).join("")}
    </select>
    <button class="btn btn-sm" data-act="aiInvite">✨ נסח לי</button>
  </span>`;
}

async function doAiInvite(ev, btn) {
  const style = aiStyleChoice = $("aiStyle").value;
  await aiBusy(btn, "מנסח...", async () => {
    const inv = currentInvite(ev);
    const r = await callAI("invite", {
      style, event: aiEventPayload(ev, ev.id),
      current: { title: inv.title, body: inv.description },
    });
    if (r.title) inv.title = r.title;
    if (r.body) inv.description = r.body;
    rerenderApproval(ev);
    toast("העוזר ניסח את הזימון — אפשר לערוך לפני השליחה", "ok");
  });
}

// ── 3. בדיקה ותקציר (סיכום באשף, ופאנל המאשרים) ──
function aiReviewHtml(key, forApprover) {
  const r = aiReviews[key];
  const label = forApprover ? "✨ תקציר ובדיקה של העוזר" : "✨ בדיקה נוספת של העוזר";
  if (!r) return `<div class="no-print" style="margin:-6px 0 16px"><button class="btn btn-light btn-sm" data-act="aiReview" data-key="${esc(key)}">${label}</button></div>`;
  return `<div class="checks ai">
    <div class="checks-h"><strong>✨ העוזר</strong><button class="btn btn-light btn-sm no-print" data-act="aiReview" data-key="${esc(key)}" style="margin-right:auto">בדיקה מחדש</button></div>
    ${r.brief ? `<p style="margin-bottom:8px">${esc(r.brief)}</p>` : ""}
    ${(r.items || []).length ? `<ul>${r.items.map(c => `<li class="${c.level === "warn" ? "warn" : "tip"}">${esc(c.text)}</li>`).join("")}</ul>` : `<div class="small">לא נמצאו נקודות נוספות.</div>`}
  </div>`;
}

async function doAiReview(key, btn) {
  const isDraft = key === "draft";
  const d = isDraft ? editing.data : S.events[key];
  const id = isDraft ? editing.id : key;
  await aiBusy(btn, "העוזר בודק...", async () => {
    aiReviews[key] = await callAI("review", {
      event: aiEventPayload(d, id),
      known: eventChecks(d, id).map(c => c.text),
    });
    if (isDraft) renderEditor(); else rerenderApproval(S.events[key]);
  });
}

// ════════════════════════════════════════════════════════════
//  אתחול וכניסה
// ════════════════════════════════════════════════════════════

window.addEventListener("load", async () => {
  Store.init();
  bindPageEvents();

  $("btnLogin").onclick = async () => {
    try { await Store.signIn(); }
    catch (err) { const m = authErrorMessage(err); if (m) showLoginError(m); }
  };
  $("btnDemoLogin").onclick = () => Store.signInAs($("demoUser").value);
  $("btnLogout").onclick = () => {
    if (editing && editing.dirty && !confirm("יש שינויים שלא נשמרו. לצאת בכל זאת?")) return;
    editing = null;
    Store.signOut();
  };
  $("demoFab").onclick = openOutbox;
  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("beforeunload", e => {
    if (editing && editing.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  if (IS_DEMO) {
    await demoSeedIfEmpty();
    $("demoFab").classList.remove("hidden");
  }
  Store.onAuth(onAuth);
});

function showLoginError(msg) {
  const el = $("loginError");
  el.innerHTML = msg;
  el.classList.toggle("hidden", !msg);
}

async function showLogin() {
  $("loading").classList.add("hidden");
  $("appView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
  if (IS_DEMO) {
    const staff = (await Store.get("staff")) || {};
    $("demoUser").innerHTML = Object.entries(staff)
      .sort((a, b) => a[1].name.localeCompare(b[1].name, "he"))
      .map(([k, p]) => {
        const roles = Object.keys(ROLE_LABELS).filter(r => p.roles && p.roles[r]).map(r => ROLE_LABELS[r]).join(", ");
        return `<option value="${esc(p.authEmail)}">${esc(p.name)}${roles ? " — " + esc(roles) : ""}</option>`;
      }).join("");
    $("loginDemo").classList.remove("hidden");
  } else {
    $("btnLogin").classList.remove("hidden");
  }
}

async function onAuth(user) {
  unsubs.forEach(u => u()); unsubs = [];
  S.user = user; S.me = null;
  S.loaded = { staff: false, events: false, settings: false };
  mounted = "";
  if (!user) { showLogin(); return; }

  $("loading").classList.remove("hidden");
  let staff;
  try { staff = await Store.get("staff"); }
  catch (err) { staff = undefined; console.error(err); }

  if (!staff && BOOTSTRAP_ADMINS.includes(user.email)) {
    staff = buildSeedStaff(user);
    await Store.set("staff", staff);
    toast("רשימת העובדים נטענה לראשונה — אפשר לערוך בעמדת הניהול", "ok");
  }
  const key = emailKey(user.email);
  const me = staff && staff[key];
  if (!me || me.active === false) {
    showLogin();
    showLoginError(`לחשבון <b dir="ltr">${esc(user.email)}</b> אין הרשאה למערכת.<br>
      <span class="small">יש לפנות לאדמין שיוסיף אותך, או להתחבר בחשבון אחר.</span>`);
    if (!IS_DEMO) $("btnLogin").classList.remove("hidden");
    return;
  }
  showLoginError("");
  S.me = { key, ...me };

  unsubs.push(Store.listen("staff", v => {
    S.staff = v || {};
    if (S.staff[key]) S.me = { key, ...S.staff[key] };
    S.loaded.staff = true;
    $("staffNames").innerHTML = activeStaff().map(p => `<option value="${esc(p.name)}">`).join("");
    queueRender(true);
  }));
  unsubs.push(Store.listen("settings", v => { S.settings = v || {}; S.loaded.settings = true; queueRender(true); }));
  unsubs.push(Store.listen("events", v => {
    S.events = {};
    Object.entries(v || {}).forEach(([id, ev]) => (S.events[id] = normEvent(id, ev)));
    S.loaded.events = true;
    queueRender(true);
  }));
  if (IS_DEMO) unsubs.push(Store.listen("outbox", v => {
    S.outbox = v || {};
    $("demoFab").textContent = `📬 דואר הדגמה (${Object.keys(S.outbox).length})`;
  }));

  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
}

function buildSeedStaff(user) {
  const out = {};
  STAFF_SEED.forEach(p => {
    out[emailKey(p.authEmail)] = { name: p.name, authEmail: p.authEmail.toLowerCase(), workEmail: p.workEmail || "", active: true, roles: p.roles || {} };
  });
  const k = emailKey(user.email);
  if (!out[k]) out[k] = { name: user.name || user.email, authEmail: user.email, workEmail: "", active: true, roles: {} };
  out[k].roles = { ...out[k].roles, admin: true };
  return out;
}

// ════════════════════════════════════════════════════════════
//  ניתוב
// ════════════════════════════════════════════════════════════

function route() {
  const h = location.hash.replace(/^#/, "");
  const [name, arg] = h.split("/");
  return { name: name || "home", arg: arg ? decodeURIComponent(arg) : "" };
}

function go(hash) {
  if (location.hash === hash) render(true);
  else location.hash = hash;
}

let lastHash = location.hash;
function onHashChange() {
  if (skipHashGuard) { skipHashGuard = false; lastHash = location.hash; return; }
  const r = route();
  const stillEditing = editing && r.name === "event" && r.arg === (editing.id || "new");
  if (editing && editing.dirty && !stillEditing) {
    if (!confirm("יש שינויים שלא נשמרו בטופס. לצאת בלי לשמור?")) {
      skipHashGuard = true;
      location.hash = lastHash;
      return;
    }
  }
  if (!stillEditing) editing = null;
  viewLock = false;
  lastHash = location.hash;
  render(true);
}

function queueRender(fromData) {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(false, fromData); });
}

// force — בנייה מחדש גם אם אותו מסך כבר מוצג
function render(force, fromData) {
  if (!S.me || !S.loaded.staff || !S.loaded.events || !S.loaded.settings) return;
  $("loading").classList.add("hidden");
  $("whoAmI").textContent = S.me.name;
  $("lnkAdmin").classList.toggle("hidden", !isAdmin());

  const r = route();
  const page = $("page");

  if (r.name === "admin") {
    if (!isAdmin()) { go("#home"); return; }
    if (fromData && mounted === "admin" && adminBusy()) return;
    mounted = "admin";
    renderAdmin(page);
    return;
  }

  if (r.name === "event") {
    if (r.arg === "new") {
      if (!editing || editing.id) editing = { id: null, data: newEventData(), dirty: false };
      if (mounted === "edit:new" && !force) return;
      mounted = "edit:new";
      renderEditor();
      return;
    }
    const ev = S.events[r.arg];
    if (!ev) {
      mounted = "";
      page.innerHTML = `<div class="card empty">האירוע לא נמצא. <a href="#home">חזרה לדף הבית</a></div>`;
      return;
    }
    if (canEdit(ev)) {
      if (!editing || editing.id !== ev.id) editing = { id: ev.id, data: clone(ev), dirty: false };
      if (mounted === "edit:" + ev.id && !force) return;
      mounted = "edit:" + ev.id;
      renderEditor();
      return;
    }
    editing = null;
    if (mounted === "view:" + ev.id && viewLock && !force) {
      $("staleBanner") && $("staleBanner").classList.remove("hidden");
      return;
    }
    mounted = "view:" + ev.id;
    renderView(ev);
    return;
  }

  mounted = "home";
  renderHome(page);
}

// ════════════════════════════════════════════════════════════
//  דף הבית — הלשוניות
// ════════════════════════════════════════════════════════════

function myApprovalQueue() {
  return Object.values(S.events).filter(canApprove).sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
}

function myTasks() {
  const out = [];
  Object.values(S.events).filter(isActiveEvent).forEach(ev => {
    const rows = allRows(ev).filter(x => rowOwnedByMe(x.row));
    if (rows.length) out.push({ ev, rows });
  });
  return out.sort((a, b) => (a.ev.dateStart || "").localeCompare(b.ev.dateStart || ""));
}

function renderHome(page) {
  const r = route();
  const queue = myApprovalQueue();
  const isApprover = STAGES.some(s => hasRole(s.role));
  const tasks = myTasks();
  const openTasks = tasks.reduce((n, t) => n + t.rows.filter(x => !t.ev.done[x.row.id]).length, 0);

  const tabs = [
    { id: "mine", label: "📁 האירועים שלי" },
    ...(isApprover ? [{ id: "approvals", label: "🖊️ ממתינים לאישורי", badge: queue.length }] : []),
    { id: "tasks", label: "✅ המשימות שלי", badge: openTasks },
    { id: "board", label: "📊 לוח מצב" },
  ];
  let tab = r.arg || homeTab || (queue.length ? "approvals" : "mine");
  if (!tabs.some(t => t.id === tab)) tab = "mine";
  homeTab = tab;

  let body = "";
  if (tab === "mine") body = homeMine();
  if (tab === "approvals") body = homeApprovals(queue);
  if (tab === "tasks") body = homeTasks(tasks);
  if (tab === "board") body = homeBoard();

  page.innerHTML = `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:20px;font-weight:600;color:var(--ink)">שלום ${esc(S.me.name)} 👋</div>
        <div class="small muted" style="margin-top:2px">${roleTags(S.me) || "עובד/ת"}</div>
      </div>
      <a class="btn" href="#event/new" style="font-size:15px;padding:11px 20px">➕ פתיחת אירוע חדש</a>
    </div>
    <div class="tabs">
      ${tabs.map(t => `<button class="tab ${t.id === tab ? "active" : ""}" data-act="tab" data-tab="${t.id}">${t.label}${t.badge ? ` <span class="badge">${t.badge}</span>` : ""}</button>`).join("")}
    </div>
    ${body}
    ${calendarHtml()}`;
}

// ════════════════════════════════════════════════════════════
//  יומן האירועים — כל האירועים בטכנודע, לכל העובדים
// ════════════════════════════════════════════════════════════

let calMonth = null;      // { y, m } — החודש המוצג (m מ-0)
// היומן תמיד נפתח סגור. נפתח/נסגר בלחיצה, עד הכניסה הבאה.
let calOpen = false;
const CHEVRON = `<svg class="cal-chev" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const HE_DAYS = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];

function isoFromDay(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }

// צבע ותיאור קצר לפי שלב: ירוק = מאושר לגמרי, כתום = בתהליך (ובאיזה שלב), אדום = הוחזר
function calStatus(ev) {
  if (ev.status === "approved") return { cls: "cal-ok", text: "מאושר" };
  if (ev.status === "returned") return { cls: "cal-ret", text: "הוחזר לתיקון" };
  const st = currentStage(ev);
  return { cls: "cal-wait", text: st ? "ממתין ל" + st.label : "" };
}

function calendarHtml() {
  if (!calMonth) { const t = new Date(); calMonth = { y: t.getFullYear(), m: t.getMonth() }; }
  const { y, m } = calMonth;
  const first = Date.UTC(y, m, 1) / 86400000;
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const startDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const weeks = Math.ceil((startDow + daysInMonth) / 7);
  const todayIso = new Date().toISOString().slice(0, 10);
  const last = first + daysInMonth - 1;

  const evs = Object.values(S.events)
    .filter(ev => ev.dateStart && !["draft", "cancelled"].includes(ev.status))
    .map(ev => ({ ev, a: dayNum(ev.dateStart), b: dayNum(ev.dateEnd || ev.dateStart) }))
    .sort((p, q) => p.a - q.a || (p.ev.name || "").localeCompare(q.ev.name || "", "he"));
  const inMonth = evs.filter(x => x.a <= last && x.b >= first);

  const chip = ({ ev }) => {
    const s = calStatus(ev);
    const tip = `${ev.name} · ${formatEventWhen(ev)} · ${s.text}`;
    return `<a class="cal-ev ${s.cls}" href="#event/${esc(ev.id)}" title="${esc(tip)}">
      <span class="cal-name">${esc(ev.name)}</span><span class="cal-st">${esc(s.text)}</span></a>`;
  };

  let cells = "";
  for (let i = 0; i < weeks * 7; i++) {
    const n = first - startDow + i;
    const iso = isoFromDay(n);
    const out = n < first || n > last;
    const hol = HOLIDAYS.filter(h => iso >= h.start && iso <= h.end);
    const dayEvs = evs.filter(x => x.a <= n && x.b >= n);
    cells += `<div class="cal-cell ${out ? "out" : ""} ${iso === todayIso ? "today" : ""} ${i % 7 === 6 ? "sat" : ""} ${hol.some(h => h.closed) ? "closed" : ""}">
      <div class="cal-top"><span class="cal-day">${+iso.slice(8)}</span>${!out && iso >= todayIso
        ? `<button class="cal-add" data-act="calNew" data-date="${iso}" title="אירוע חדש ב-${fmtDate(iso)}">+</button>` : ""}</div>
      ${hol.map(h => `<div class="cal-hol">${esc(h.name)}</div>`).join("")}
      ${out ? "" : dayEvs.map(chip).join("")}
    </div>`;
  }

  // תצוגת רשימה — למסך צר
  const agenda = inMonth.length ? inMonth.map(({ ev }) => {
    const s = calStatus(ev);
    return `<a class="cal-ag ${s.cls}" href="#event/${esc(ev.id)}">
      <div class="cal-ag-when">${esc(formatEventWhen(ev))}</div>
      <div><strong>${esc(ev.name)}</strong></div>
      <div class="cal-st">${esc(s.text)}</div></a>`;
  }).join("") : `<div class="empty">אין אירועים בחודש הזה</div>`;

  // סגור — שורת כותרת בלבד, עם מספר האירועים הקרובים
  if (!calOpen) {
    const upcoming = evs.filter(x => isoFromDay(x.b) >= todayIso).length;
    return `<button class="cal-collapsed" data-act="calToggle">
      <span class="card-title">📅 יומן האירועים בטכנודע</span>${CHEVRON}
      <span class="small muted">${upcoming > 1 ? upcoming + " אירועים קרובים" : upcoming === 1 ? "אירוע קרוב אחד" : "אין אירועים קרובים"}</span>
    </button>`;
  }

  return `<div class="card cal">
    <div class="card-header">
      <button class="cal-head-toggle" data-act="calToggle" title="סגירת היומן">
        <span class="card-title">📅 יומן האירועים בטכנודע</span>${CHEVRON.replace('class="cal-chev"', 'class="cal-chev open"')}
      </button>
      <div class="actions">
        <button class="btn btn-light btn-sm" data-act="calMove" data-d="-1" title="החודש הקודם">→</button>
        <strong class="cal-title">${HE_MONTHS[m]} ${y}</strong>
        <button class="btn btn-light btn-sm" data-act="calMove" data-d="1" title="החודש הבא">←</button>
        <button class="btn btn-light btn-sm" data-act="calMove" data-d="0">היום</button>
      </div>
    </div>
    <div class="cal-legend">
      <span><i class="cal-ok"></i>מאושר — זימון נשלח</span>
      <span><i class="cal-wait"></i>בתהליך אישור (כתוב באיזה שלב)</span>
      <span><i class="cal-ret"></i>הוחזר לתיקון</span>
      <span class="small muted">${inMonth.length} אירועים החודש</span>
    </div>
    <div class="cal-grid">
      ${HE_DAYS.map(d => `<div class="cal-dow">${d}</div>`).join("")}
      ${cells}
    </div>
    <div class="cal-agenda">${agenda}</div>
  </div>`;
}

function eventsTable(list, opts = {}) {
  if (!list.length) return `<div class="card empty">${opts.empty || "אין אירועים להצגה"}</div>`;
  return `<div class="card"><div class="table-wrap"><table class="list">
    <thead><tr><th>שם האירוע</th><th>מועד</th><th>רכז/ת</th><th>סטטוס</th><th>משימות</th>${opts.extraHead || ""}<th></th></tr></thead>
    <tbody>${list.map(ev => {
      const conf = isActiveEvent(ev) ? findConflicts(ev, ev.id).overlap.length : 0;
      return `<tr class="click" data-act="open" data-id="${esc(ev.id)}">
        <td><strong>${esc(ev.name || "ללא שם")}</strong>${conf ? ` <span title="יש ${conf} אירועים חופפים">⚠️</span>` : ""}</td>
        <td>${esc(formatEventWhen(ev))}</td>
        <td>${esc(ev.coordinator || ev.createdByName || "")}</td>
        <td>${statusChip(ev)}</td>
        <td>${progressHtml(ev)}</td>
        ${opts.extraCell ? opts.extraCell(ev) : ""}
        <td style="white-space:nowrap"><button class="btn btn-light btn-sm" data-act="clone" data-id="${esc(ev.id)}" title="פתיחת אירוע חדש על בסיס זה">⧉ שכפול</button>
          ${canDelete(ev) ? `<button class="btn btn-red btn-sm" data-act="deleteEvent" data-id="${esc(ev.id)}" title="מחיקה לצמיתות">🗑 מחיקה</button>` : ""}</td>
      </tr>`;
    }).join("")}</tbody></table></div></div>`;
}

function homeMine() {
  const list = Object.values(S.events).filter(isCreator).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const waiting = awaitingSummary();
  const banner = waiting.length ? `<div class="banner"><span>📝 ${waiting.length === 1 ? "אירוע אחד הסתיים ומחכה" : waiting.length + " אירועים הסתיימו ומחכים"} לסיכום קצר: ${waiting.map(ev => `<a href="#event/${esc(ev.id)}">${esc(ev.name)}</a>`).join(", ")}</span></div>` : "";
  return banner + eventsTable(list, { empty: 'עדיין לא פתחת אירועים. לחצו על "פתיחת אירוע חדש" כדי להתחיל.' });
}

function homeApprovals(queue) {
  return eventsTable(queue, {
    empty: "🎉 אין אירועים שממתינים לאישור שלך",
    extraHead: "<th>ממתין מאז</th>",
    extraCell: ev => `<td class="small">${esc(fmtTs(ev.updatedAt))}</td>`,
  });
}

function homeTasks(tasks) {
  if (!tasks.length) return `<div class="card empty">אין משימות שמשויכות אליך באירועים פעילים.</div>`;
  return `<div class="card">
    <div class="card-header"><span class="card-title">משימות שאני אחראי/ת עליהן</span>
      <label class="switch"><input type="checkbox" data-act="toggleDoneTasks" ${showDoneTasks ? "checked" : ""}> הצג גם משימות שבוצעו</label>
    </div>
    ${tasks.map(({ ev, rows }) => {
      const visible = rows.filter(x => showDoneTasks || !ev.done[x.row.id]);
      const doneN = rows.filter(x => ev.done[x.row.id]).length;
      return `<div class="task-event">
        <h4><a href="#event/${esc(ev.id)}">${esc(ev.name)}</a> <span class="small muted">${esc(formatEventWhen(ev))}</span> ${statusChip(ev)}
          <span class="small muted">· ${doneN}/${rows.length} שלי בוצעו</span></h4>
        ${visible.length ? visible.map(({ sec, group, row }) => {
          const d = ev.done[row.id];
          return `<label class="task ${d ? "done" : ""}">
            <input type="checkbox" class="done-box" data-act="done" data-id="${esc(ev.id)}" data-row="${esc(row.id)}" ${d ? "checked" : ""}>
            <div style="flex:1"><div class="t-item">${esc(row.item)}</div>
              <div class="t-cat">${esc(sec.title)} · ${esc(group.name)}${row.qty ? " · כמות: " + esc(row.qty) : ""}${row.location ? " · " + esc(row.location) : ""}</div></div>
            ${d ? `<span class="small muted">${esc(d.by)} · ${esc(fmtTs(d.at))}</span>` : ""}
          </label>`;
        }).join("") : `<div class="small muted">כל המשימות שלך באירוע הזה בוצעו ✓</div>`}
      </div>`;
    }).join("")}
  </div>`;
}

function homeBoard() {
  const today = new Date().toISOString().slice(0, 10);
  const all = Object.values(S.events).filter(ev => ev.status !== "draft" || isCreator(ev));
  const groups = {
    active:   { label: "כל הפעילים", cls: "", test: ev => !["cancelled", "draft"].includes(ev.status) },
    pending:  { label: "בתהליך אישור", cls: "pending", test: ev => !!currentStage(ev) },
    returned: { label: "הוחזרו לתיקון", cls: "returned", test: ev => ev.status === "returned" },
    approved: { label: "מאושרים", cls: "approved", test: ev => ev.status === "approved" },
    other:    { label: "טיוטות שלי / בוטלו", cls: "", test: ev => ["draft", "cancelled"].includes(ev.status) },
  };
  const g = groups[boardFilter] || groups.active;
  const list = all.filter(g.test)
    .filter(ev => showPast || !ev.dateStart || (ev.dateEnd || ev.dateStart) >= today)
    .sort((a, b) => (a.dateStart || "9").localeCompare(b.dateStart || "9"));

  return `
    <div class="stats">
      ${Object.entries(groups).map(([k, gg]) => `<div class="stat ${gg.cls} ${k === boardFilter ? "active" : ""}" data-act="boardFilter" data-f="${k}">
        <div class="n">${all.filter(gg.test).length}</div><div class="l">${gg.label}</div></div>`).join("")}
    </div>
    <div style="margin-bottom:10px"><label class="switch"><input type="checkbox" data-act="togglePast" ${showPast ? "checked" : ""}> הצג גם אירועים שהסתיימו</label></div>
    ${eventsTable(list, {
      empty: "אין אירועים בקטגוריה הזו",
      extraHead: "<th>שלב נוכחי</th>",
      extraCell: ev => { const st = currentStage(ev); return `<td class="small">${st ? esc(st.label) : "—"}</td>`; },
    })}`;
}

// ════════════════════════════════════════════════════════════
//  טופס האירוע — רכיבים משותפים לעריכה ולצפייה
// ════════════════════════════════════════════════════════════

function ynHtml(field, val, edit) {
  if (!edit) {
    return val === "yes" ? `<span class="status st-approved">כן</span>` : val === "no" ? `<span class="status st-returned">לא</span>` : `<span class="muted">—</span>`;
  }
  return `<span class="yn">
    <label class="${val === "yes" ? "on-yes" : ""}"><input type="radio" name="${field}" value="yes" data-f="${field}" ${val === "yes" ? "checked" : ""}>כן</label>
    <label class="${val === "no" ? "on-no" : ""}"><input type="radio" name="${field}" value="no" data-f="${field}" ${val === "no" ? "checked" : ""}>לא</label>
  </span>`;
}

function headerHtml(d, edit, selfId) {
  const inp = (f, attrs = "") => edit
    ? `<input type="text" data-f="${f}" value="${esc(d[f])}" ${attrs}>`
    : `<span class="ro">${esc(d[f]) || '<span class="muted">—</span>'}</span>`;
  const dateRow = edit
    ? `<input type="date" data-f="dateStart" value="${esc(d.dateStart)}"> <span>עד</span>
       <input type="date" data-f="dateEnd" value="${esc(d.dateEnd)}" min="${esc(d.dateStart)}"> <span class="small muted">(לאירוע של יום אחד — להשאיר ריק)</span>`
    : `<span class="ro">${esc(d.dateStart ? fmtDate(d.dateStart) + (d.dateEnd && d.dateEnd !== d.dateStart ? " – " + fmtDate(d.dateEnd) : "") : "—")}</span>`;
  const timeRow = edit
    ? `<input type="time" data-f="timeStart" value="${esc(d.timeStart)}"> <span>עד</span> <input type="time" data-f="timeEnd" value="${esc(d.timeEnd)}">`
    : `<span class="ro">${esc(d.timeStart ? d.timeStart + (d.timeEnd ? "–" + d.timeEnd : "") : "—")}</span>`;

  return `
    <div class="hdr-grid">
      <div class="lbl req">שם האירוע:</div><div class="val">${inp("name", 'placeholder="למשל: הפנינג קיץ"')}</div>
      <div class="lbl">פרטי ומטרות האירוע:</div><div class="val">${edit
        ? `<textarea data-f="goals" placeholder="תיאור קצר ומטרות">${esc(d.goals)}</textarea>`
        : `<span class="ro">${esc(d.goals) || '<span class="muted">—</span>'}</span>`}</div>
      <div class="lbl req">תאריך האירוע:</div><div class="val">${dateRow}</div>
      <div class="lbl">שעת האירוע:</div><div class="val">${timeRow}</div>
      <div class="lbl">מיקום:</div><div class="val">${inp("location", 'placeholder="למשל: טכנודע, אולם ראשי"')}</div>
      <div class="lbl">מס' משתתפים צפוי:</div><div class="val">${edit
        ? `<input type="number" min="0" data-f="participants" value="${esc(d.participants)}" style="width:140px">`
        : `<span class="ro">${esc(d.participants) || "—"}</span>`}</div>
      <div class="lbl">שם הרכז האחראי:</div><div class="val">${inp("coordinator", 'list="staffNames"')}</div>
      <div class="lbl">מנהל/ת האירוע בשטח:</div><div class="val">${inp("eventManager", 'list="staffNames" placeholder="מי נמצא/ת בשטח ביום האירוע"')}</div>
      <div class="lbl">מחליף/ה:</div><div class="val">${inp("eventManagerSub", 'list="staffNames" placeholder="אם מנהל/ת האירוע לא יכול/ה להיות בשטח"')}</div>
      <div class="lbl">תאריך הגשת הבקשה:</div><div class="val"><span class="ro">${d.submittedAt ? esc(fmtTs(d.submittedAt)) : '<span class="muted">יתמלא אוטומטית בשליחה לאישור</span>'}</span></div>
      <div class="lbl">תואם מול לוח אירועים (דינה):</div><div class="val">${ynHtml("calendarCoordinated", d.calendarCoordinated, edit)} ${inp("calendarDetails", 'placeholder="פירוט האירוע"')}</div>
      <div class="lbl">אירועים נושקים / מקבילים:</div><div class="val">${ynHtml("parallelEvents", d.parallelEvents, edit)} ${inp("parallelDetails", 'placeholder="פירוט האירוע"')}</div>
    </div>
    <div id="conflictsBox">${conflictsHtml(d, selfId)}</div>`;
}

function sigsHtml(ev) {
  return `<div class="sigs">${STAGES.map(st => {
    const s = ev.signatures && ev.signatures[st.status];
    const isCur = ev.status === st.status;
    return `<div class="sig ${s ? "signed" : ""} ${isCur ? "current" : ""}">
      <div class="sig-label">${esc(st.sigLabel)}:</div>
      ${s ? `<img src="${esc(s.img)}" alt="חתימה">
        <div class="who"><strong>${esc(s.name)}</strong></div>
        <div class="small muted">תאריך: ${esc(fmtTs(s.at))}</div>
        ${s.note ? `<div class="small" style="margin-top:4px">💬 ${esc(s.note)}</div>` : ""}`
      : `<div class="muted small" style="margin:auto">${isCur ? "⏳ ממתין לחתימה" : "חתימה: ________ &nbsp; תאריך: ________"}</div>`}
    </div>`;
  }).join("")}</div>`;
}

function ownersHtml(owners, path, edit) {
  const chips = owners.map((o, oi) => `<span class="chip ${o.key ? "" : "free"} ${o.key && S.me && o.key === S.me.key ? "me" : ""}" title="${o.key ? "מקושר לעובד/ת — המשימה תופיע בדשבורד שלו/ה" : "טקסט חופשי — לא מקושר לעובד/ת במערכת"}">${esc(o.name)}${edit ? `<button type="button" data-act="delOwner" data-p="${path}" data-oi="${oi}">×</button>` : ""}</span>`).join("");
  if (!edit) return `<div class="chips">${chips || '<span class="muted">—</span>'}</div>`;
  return `<div class="chips">${chips}<input class="chip-in" list="staffNames" placeholder="+ אחראי/ת" data-owner-in="${path}"></div>`;
}

// opts.only — להציג רק את החלק הזה (שלב באשף). opts.noAdd — בלי כפתור "הוספת חלק".
function sectionsHtml(d, edit, ev, opts = {}) {
  const html = d.sections.map((sec, si) => {
    if (opts.only != null && si !== opts.only) return "";
    if (!edit && !sec.enabled) return "";
    const sp = `sections.${si}`;
    const head = edit
      ? `<input class="sec-title" data-p="${sp}.title" value="${esc(sec.title)}">
         <input class="sec-note" data-p="${sp}.note" value="${esc(sec.note)}" placeholder="הערה לחלק (אופציונלי)">
         ${opts.only == null ? `<label class="switch" title="חלק שלא כלול לא יופיע בטופס, במשימות ובזימון"><input type="checkbox" data-act="toggleSec" data-si="${si}" ${sec.enabled ? "checked" : ""}> כלול בטופס</label>` : ""}
         <button class="btn-icon" data-act="delSec" data-si="${si}" title="מחיקת החלק">🗑</button>`
      : `<span class="sec-title">${esc(sec.title)}</span>${sec.note ? `<span class="sec-note-ro">${esc(sec.note)}</span>` : ""}`;

    const showDone = !edit && isActiveEvent(ev);
    const rowsHtml = sec.groups.map((g, gi) => {
      const gp = `${sp}.groups.${gi}`;
      const rows = edit ? g.rows : g.rows.filter(r => r.item || r.owners.length);
      if (!rows.length && !edit) return "";
      const catCell = n => `<td class="cat" rowspan="${n}">${edit
        ? `<input data-p="${gp}.name" value="${esc(g.name)}" placeholder="קטגוריה">
           <div class="cat-tools"><button class="btn btn-light btn-sm" data-act="addRow" data-si="${si}" data-gi="${gi}">+ שורה</button>
           <button class="btn-icon" data-act="delGroup" data-si="${si}" data-gi="${gi}" title="מחיקת הקטגוריה">🗑</button></div>`
        : esc(g.name)}</td>`;
      if (!rows.length) {
        return `<tr>${catCell(1)}<td colspan="5" class="muted small">אין שורות בקטגוריה — "+ שורה" כדי להוסיף</td></tr>`;
      }
      return rows.map((r, ri) => {
        const rp = `${gp}.rows.${g.rows.indexOf(r)}`;
        const done = ev && ev.done[r.id];
        const doneCell = showDone ? `<td class="w-done">${canMarkDone(ev, r)
          ? `<input type="checkbox" class="done-box" data-act="done" data-id="${esc(ev.id)}" data-row="${esc(r.id)}" ${done ? "checked" : ""}>`
          : (done ? "✓" : "")}${done ? `<span class="done-meta">${esc(done.by)}<br>${esc(fmtTs(done.at).split(" ")[0])}</span>` : ""}</td>` : "";
        return `<tr class="${done ? "done" : ""}">
          ${ri === 0 ? catCell(rows.length) : ""}
          <td>${edit ? `<input data-p="${rp}.item" value="${esc(r.item)}" placeholder="פריט / משימה">` : `<span class="item-ro">${esc(r.item)}</span>`}</td>
          <td>${ownersHtml(r.owners, rp, edit)}</td>
          <td class="w-qty">${edit ? `<input data-p="${rp}.qty" value="${esc(r.qty)}" placeholder="—">` : esc(r.qty)}</td>
          <td class="w-loc">${edit ? `<input data-p="${rp}.location" value="${esc(r.location)}" placeholder="—">` : esc(r.location)}</td>
          ${doneCell}
          ${edit ? `<td class="w-x"><button class="btn-icon" data-act="delRow" data-si="${si}" data-gi="${gi}" data-ri="${g.rows.indexOf(r)}" title="מחיקת השורה">✕</button></td>` : ""}
        </tr>`;
      }).join("");
    }).join("");

    return `<div class="section ${sec.enabled ? "" : "off"}">
      <div class="sec-head">${head}</div>
      <div class="sec-body">
        <div class="sheet-wrap"><table class="sheet">
          <thead><tr><th>קטגוריה</th><th>פריט</th><th>שם האחראי</th><th class="w-qty">כמות דרושה</th><th class="w-loc">מיקום</th>${showDone ? '<th class="w-done">בוצע</th>' : ""}${edit ? '<th class="w-x"></th>' : ""}</tr></thead>
          <tbody>${rowsHtml || `<tr><td colspan="6" class="muted small" style="padding:14px">אין שורות בחלק הזה</td></tr>`}</tbody>
        </table></div>
        ${edit ? `<div class="sec-foot"><button class="btn btn-light btn-sm" data-act="addGroup" data-si="${si}">+ קטגוריה חדשה</button></div>` : ""}
      </div>
    </div>`;
  }).join("");
  return html + (edit && !opts.noAdd ? `<div style="margin-top:14px"><button class="btn btn-light" data-act="addSec">+ הוספת חלק חדש</button></div>` : "");
}

const HISTORY_TEXT = {
  created: "פתח/ה את הטופס", cloned: "פתח/ה את הטופס כשכפול של אירוע קודם",
  submitted: "שלח/ה לאישור", resubmitted: "תיקן/ה ושלח/ה מחדש",
  approved: "אישר/ה וחתם/ה", returned: "החזיר/ה לתיקון", invite: "שלח/ה זימון ליומן",
  invite_failed: "אישר/ה — שליחת הזימון נכשלה", cancelled: "ביטל/ה את האירוע", summary: "כתב/ה סיכום אחרי האירוע",
};

function historyHtml(ev) {
  if (!ev.history || !ev.history.length) return "";
  return `<div class="card no-print"><div class="card-title" style="margin-bottom:12px">🕓 היסטוריה</div>
    <ul class="timeline">${ev.history.slice().reverse().map(h => `<li class="${h.action === "returned" ? "returned" : h.action === "approved" || h.action === "invite" ? "approved" : ""}">
      <strong>${esc(h.by)}</strong> ${esc(HISTORY_TEXT[h.action] || h.action)}${h.stage ? ` <span class="small muted">(${esc(h.stage)})</span>` : ""}
      <span class="small muted">· ${esc(fmtTs(h.at))}</span>
      ${h.note ? `<div class="t-note">${esc(h.note)}</div>` : ""}
    </li>`).join("")}</ul></div>`;
}

function histEntry(action, extra = {}) {
  return { at: Date.now(), by: S.me.name, byKey: S.me.key, action, ...extra };
}

// ════════════════════════════════════════════════════════════
//  מצב עריכה
// ════════════════════════════════════════════════════════════

// ── האשף: פרטי האירוע → כל חלק בשלב משלו → סיכום ושליחה ──
function wizardSteps(d) {
  return [
    { key: "details", label: "פרטי האירוע" },
    ...d.sections.map((s, si) => ({ key: "sec", si, label: s.title || "חלק " + (si + 1), off: !s.enabled })),
    { key: "summary", label: "סיכום ושליחה" },
  ];
}

function goStep(n) {
  const steps = wizardSteps(editing.data);
  n = Math.max(0, Math.min(n, steps.length - 1));
  // אי אפשר לעבור את שלב הפרטים בלי שם ותאריך
  if (n > 0 && (editing.step || 0) === 0) {
    const err = validate(editing.data);
    if (err) { toast(err, "error"); return; }
  }
  editing.step = n;
  renderEditor();
  window.scrollTo(0, 0);
}

function renderEditor(focusSel) {
  const d = editing.data;
  const ev = editing.id ? S.events[editing.id] : null;
  const returned = ev && ev.status === "returned";
  const retStage = returned && STAGES.find(s => s.status === ev.returnedFrom);
  const steps = wizardSteps(d);
  if (editing.step == null || editing.step >= steps.length) editing.step = Math.min(editing.step || 0, steps.length - 1);
  const step = steps[editing.step];
  const y = window.scrollY;
  const next = steps[editing.step + 1];

  let body = "";
  if (step.key === "details") {
    body = `<div class="card">
      <div class="wiz-h">שלב 1 — פרטי האירוע</div>
      <div class="small muted" style="margin-bottom:12px">שדות עם * הם חובה.</div>
      ${aiFillBoxHtml()}
      ${lessonsHtml(d.name)}
      ${headerHtml(d, true, editing.id)}
    </div>`;
  } else if (step.key === "sec") {
    const sec = d.sections[step.si];
    body = `<div class="card">
      <div class="wiz-h">שלב ${editing.step + 1} — ${esc(sec.title)}</div>
      <div class="wiz-q ${sec.enabled ? "" : "off"}">
        <span>האם ${esc(sec.title)} רלוונטי לאירוע?</span>
        <div class="actions">
          <button class="btn ${sec.enabled ? "btn-green" : "btn-light"} btn-sm" data-act="secRelevant" data-v="1">כן, כלול בטופס</button>
          <button class="btn ${sec.enabled ? "btn-light" : "btn-red"} btn-sm" data-act="secRelevant" data-v="0">לא — דלג לשלב הבא</button>
        </div>
      </div>
      ${sec.enabled
        ? `<div class="small muted" style="margin:10px 0 0">אפשר לערוך כל שורה, לשנות אחראים, להוסיף שורות וקטגוריות. "כמות דרושה" ו"מיקום" — רק אם רלוונטי.</div>
           ${sectionsHtml(d, true, ev, { only: step.si, noAdd: true })}`
        : `<div class="empty">החלק הזה לא ייכלל בטופס, במשימות ובזימון.</div>`}
    </div>`;
  } else {
    const pseudo = { id: editing.id || "", status: "draft", done: {} };
    body = `<div class="card">
      <div class="wiz-h">סיכום — בדיקה אחרונה לפני שליחה</div>
      <div class="small muted" style="margin-bottom:12px">כך ייראה הטופס אצל המאשרים. לתיקון — לוחצים על השלב בפס למעלה.</div>
      ${checksHtml(eventChecks(d, editing.id))}
      ${aiReviewHtml("draft")}
      ${lessonsHtml(d.name)}
      ${headerHtml(d, false, editing.id)}
      ${sectionsHtml(d, false, pseudo) || `<div class="empty">לא נכלל אף חלק בטופס</div>`}
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-light" data-act="addSec">+ הוספת חלק נוסף לטופס</button>
      </div>
    </div>
    ${ev && Object.keys(ev.signatures || {}).length ? `<div class="card"><div class="card-title" style="margin-bottom:12px">חתימות</div>${sigsHtml(ev)}</div>` : ""}`;
  }

  $("page").innerHTML = `
    ${returned ? `<div class="panel returned">
      <h3>↩️ האירוע הוחזר לתיקון${retStage ? " ע\"י " + esc(retStage.label) : ""}${ev.returnedByName ? " — " + esc(ev.returnedByName) : ""}</h3>
      <div style="white-space:pre-wrap">${esc(ev.returnReason || "")}</div>
      <div class="small muted" style="margin-top:8px">אחרי התיקון לחצו "שליחה מחדש" — האירוע יחזור ישירות ל${esc(retStage ? retStage.label : "שלב שהחזיר אותו")}.</div>
    </div>` : ""}
    <div class="actions no-print" style="justify-content:space-between;margin-bottom:12px">
      <a href="#home" class="btn btn-light btn-sm">→ חזרה</a>
      <span>${ev ? statusChip(ev) : '<span class="status st-draft">טיוטה חדשה</span>'} <span id="dirtyMark" class="small muted">${editing.dirty ? "● יש שינויים שלא נשמרו" : ""}</span></span>
    </div>
    <div class="form-title">${esc(d.name) || "אירוע חדש"}</div>
    <div class="wiz-bar no-print">
      ${steps.map((s, i) => `<button class="wiz-step ${i === editing.step ? "cur" : ""} ${i < editing.step ? "past" : ""} ${s.off ? "off" : ""}" data-act="goStep" data-n="${i}">
        <span class="wiz-n">${i < editing.step && !s.off ? "✓" : i + 1}</span><span class="wiz-l">${esc(s.label)}${s.off ? " (דילוג)" : ""}</span></button>`).join("")}
    </div>
    ${body}
    <div class="card no-print wiz-foot">
      <div class="actions" style="justify-content:space-between">
        <div class="actions">
          ${editing.step > 0 ? `<button class="btn btn-light" data-act="goStep" data-n="${editing.step - 1}">→ הקודם</button>` : ""}
          <button class="btn btn-light" data-act="saveDraft">💾 שמירת טיוטה</button>
          ${ev && ev.status === "draft" ? `<button class="btn btn-red btn-sm" data-act="deleteDraft">🗑 מחיקת טיוטה</button>` : ""}
          ${ev && ev.status === "returned" ? `<button class="btn btn-red btn-sm" data-act="cancelEvent">ביטול האירוע</button>` : ""}
        </div>
        ${next
          ? `<button class="btn" data-act="goStep" data-n="${editing.step + 1}" style="font-size:15px;padding:11px 22px">הבא: ${esc(next.label)} ←</button>`
          : `<button class="btn btn-green" data-act="submit" style="font-size:15px;padding:11px 22px">${returned ? "📤 שליחה מחדש" : "📤 שליחה לאישור"}</button>`}
      </div>
    </div>
    ${ev && step.key === "summary" ? historyHtml(ev) : ""}`;
  window.scrollTo(0, y);
  if (focusSel) { const el = document.querySelector(focusSel); if (el) el.focus(); }
}

function setPath(obj, path, val) {
  const ps = path.split(".");
  let o = obj;
  for (let i = 0; i < ps.length - 1; i++) o = o[ps[i]];
  o[ps[ps.length - 1]] = val;
}
function getPath(obj, path) { return path.split(".").reduce((o, p) => o && o[p], obj); }

function markDirty() {
  if (!editing) return;
  editing.dirty = true;
  const m = $("dirtyMark");
  if (m) m.textContent = "● יש שינויים שלא נשמרו";
}

// מעדכן רק את רשימת האחראים של השורה — בלי לבנות את כל הטופס מחדש,
// כדי שלחיצה על כפתור שגרמה ל-blur לא "תיבלע"
function refreshOwners(path, keepFocus) {
  const input = document.querySelector(`[data-owner-in="${path}"]`);
  if (!input) return;
  input.closest(".chips").outerHTML = ownersHtml(getPath(editing.data, path).owners, path, true);
  if (keepFocus) document.querySelector(`[data-owner-in="${path}"]`).focus();
}

function commitOwnerInput(input, keepFocus = true) {
  const path = input.dataset.ownerIn;
  const names = input.value.split(",").map(s => s.trim()).filter(Boolean);
  if (!names.length) return;
  const row = getPath(editing.data, path);
  names.forEach(n => {
    const o = resolveOwner(n);
    if (o && !row.owners.some(x => x.name === o.name)) row.owners.push(o);
  });
  input.value = "";
  markDirty();
  refreshOwners(path, keepFocus);
}

// בחירה מרשימת ההשלמה — מוסיפים מיד, בלי לחכות ל-Enter
function pickedFromList(input) {
  const v = input.value.trim();
  return !!v && activeStaff().some(p => p.name === v);
}

function validate(d) {
  if (!d.name.trim()) return "יש למלא את שם האירוע";
  if (!d.dateStart) return "יש לבחור תאריך לאירוע";
  if (d.dateEnd && d.dateEnd < d.dateStart) return "תאריך הסיום לפני תאריך ההתחלה";
  if (d.timeStart && d.timeEnd && d.timeEnd <= d.timeStart) return "שעת הסיום לפני שעת ההתחלה";
  return null;
}

async function saveEvent(submit) {
  const d = editing.data;
  if (submit) {
    const err = validate(d);
    if (err) { toast(err, "error"); return; }
  } else if (!d.name.trim()) { toast("יש לתת לאירוע שם לפני שמירה", "error"); return; }

  const isNew = !editing.id;
  const id = editing.id || Store.newKey("events");
  const prev = isNew ? null : S.events[id];
  const now = Date.now();
  const patch = { updatedAt: now, sections: clone(d.sections) };
  FORM_FIELDS.forEach(f => (patch[f] = d[f] == null ? "" : d[f]));
  if (patch.dateEnd === patch.dateStart) patch.dateEnd = "";

  if (isNew) {
    Object.assign(patch, {
      status: "draft", createdAt: now, createdBy: S.me.authEmail, createdByKey: S.me.key,
      createdByName: S.me.name, createdByWorkEmail: S.me.workEmail || "",
    });
    patch["history/" + Store.newKey("h")] = histEntry(editing.clonedFrom ? "cloned" : "created",
      editing.clonedFrom ? { note: "שוכפל מ: " + editing.clonedFrom } : {});
  }

  let stage = null;
  if (submit) {
    const resubmit = prev && prev.status === "returned";
    stage = STAGES.find(s => s.status === (resubmit && prev.returnedFrom)) || STAGES[0];
    Object.assign(patch, { status: stage.status, returnedFrom: null, returnReason: null, returnedByName: null });
    if (!prev || !prev.submittedAt) patch.submittedAt = now;
    patch["history/" + Store.newKey("h")] = histEntry(resubmit ? "resubmitted" : "submitted");
  }

  $("loading").classList.remove("hidden");
  try {
    await Store.update("events/" + id, patch);
  } catch (err) {
    $("loading").classList.add("hidden");
    toast("שגיאה בשמירה: " + err.message, "error");
    return;
  }
  $("loading").classList.add("hidden");
  editing.dirty = false;

  if (submit) {
    const ev = { ...(prev || {}), ...patch, id };
    notifyStage(ev, stage, approversFor(stage), prev && prev.status === "returned" ? "האירוע תוקן ונשלח מחדש אחרי החזרה." : "");
    toast(`נשלח לאישור — ${stage.label}`, "ok");
    editing = null;
    go("#event/" + id);
  } else {
    toast("הטיוטה נשמרה", "ok");
    editing.id = id;
    editing.clonedFrom = null;
    if (isNew) { skipHashGuard = true; location.hash = "#event/" + id; mounted = "edit:" + id; }
    renderEditor();
  }
}

// ── שכפול ──
function cloneEvent(id) {
  const src = S.events[id];
  if (!src) return;
  const d = newEventData();
  FORM_FIELDS.forEach(f => (d[f] = src[f] || ""));
  Object.assign(d, { name: src.name + " (העתק)", dateStart: "", dateEnd: "", calendarCoordinated: "", calendarDetails: "",
    parallelEvents: "", parallelDetails: "", coordinator: src.coordinator || S.me.name });
  d.sections = clone(src.sections).map(s => ({ ...s, id: rid(), groups: s.groups.map(g => ({ ...g, id: rid(), rows: g.rows.map(r => ({ ...r, id: rid() })) })) }));
  editing = { id: null, data: d, dirty: true, clonedFrom: src.name };
  mounted = "";
  skipHashGuard = location.hash !== "#event/new";
  location.hash = "#event/new";
  render(true);
  toast("נפתח אירוע חדש על בסיס " + src.name + " — יש לבחור תאריך", "ok");
}

// ════════════════════════════════════════════════════════════
//  מצב צפייה + פאנל אישור
// ════════════════════════════════════════════════════════════

function renderView(ev) {
  const y = window.scrollY;
  const approve = canApprove(ev);
  const stage = currentStage(ev);
  const { done, total } = taskProgress(ev);

  $("page").innerHTML = `
    <div id="staleBanner" class="banner hidden no-print">האירוע עודכן בינתיים במערכת. <button class="btn btn-light btn-sm" data-act="refresh">רענון התצוגה</button></div>
    <div class="actions no-print" style="justify-content:space-between;margin-bottom:14px">
      <a href="#home" class="btn btn-light btn-sm">→ חזרה</a>
      <div class="actions">
        <button class="btn btn-light btn-sm" data-act="print">🖨️ ייצוא PDF / הדפסה</button>
        <button class="btn btn-light btn-sm" data-act="clone" data-id="${esc(ev.id)}">⧉ שכפול לאירוע חדש</button>
        ${(isCreator(ev) || isAdmin()) && !["cancelled"].includes(ev.status) ? `<button class="btn btn-red btn-sm" data-act="cancelEvent">ביטול האירוע</button>` : ""}
        ${canDelete(ev) ? `<button class="btn btn-red btn-sm" data-act="deleteEvent" data-id="${esc(ev.id)}">🗑 מחיקה מהרשימה</button>` : ""}
      </div>
    </div>
    ${ev.status === "returned" ? `<div class="panel returned"><h3>↩️ הוחזר לתיקון — ממתין ל${esc(ev.createdByName)}</h3><div style="white-space:pre-wrap">${esc(ev.returnReason || "")}</div></div>` : ""}
    ${approve ? approvalPanelHtml(ev, stage) : ""}
    <div class="card">
      <div class="form-title">טבלת שליטה להכנה וניהול אירוע ב${ORG_NAME}</div>
      <div class="form-sub">${statusChip(ev)} ${total ? `<span class="small muted" style="margin-right:8px">משימות: ${done}/${total} בוצעו</span>` : ""}</div>
      ${headerHtml(ev, false, ev.id)}
    </div>
    <div class="card"><div class="card-title" style="margin-bottom:12px">חתימות</div>${sigsHtml(ev)}</div>
    ${ev.invite && ev.invite.sentAt ? `<div class="card no-print"><div class="card-title">📅 זימון נשלח</div>
      <div class="small" style="margin-top:6px">${esc(fmtTs(ev.invite.sentAt))} · ${ev.invite.recipients.length} נמענים: ${ev.invite.recipients.map(r => esc(r.name)).join(", ")}</div></div>` : ""}
    <div class="card">${sectionsHtml(ev, false, ev)}</div>
    ${summaryCardHtml(ev)}
    ${historyHtml(ev)}`;

  window.scrollTo(0, y);
  const canvas = $("sigCanvas");
  sigPad = canvas ? createSignaturePad(canvas) : null;
}

// ── זימון: ברירות מחדל מתוך הטופס ──
function defaultRecipients(ev) {
  const out = [];
  const add = (name, email) => {
    if (!email) return;
    if (!out.some(r => r.email.toLowerCase() === email.toLowerCase())) out.push({ name: name || email, email });
  };
  toArr(S.settings.defaultInvitees).forEach(r => add(r.name, r.email));
  add(ev.createdByName, ev.createdByWorkEmail || ev.createdBy);
  allRows(ev).forEach(({ row }) => row.owners.forEach(o => { if (o.key && S.staff[o.key]) add(S.staff[o.key].name, staffMail(S.staff[o.key])); }));
  return out;
}

// ── זימון לפי המוסכמות של טכנודע (מתוך technoda-events-kb, סעיפים 2–3) ──
// כותרת: [שם] - [משתתפים] - [מתחמים] - באחריות [שם פרטי] - משימות בגוף הזימון
// גוף: "שלום לכולם", שורת פרטים, משימות לפי שם בסדר הקבוע, שורת בטיחות, סגירה.
const INVITE_OWNER_ORDER = ["לירון", "דינה", "מידן", "עזריאל", "קרן", "שניר"];
const HE_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const firstName = n => String(n || "").trim().split(/\s+/)[0];
const shortDate = iso => { const [y, m, d] = iso.split("-"); return `${+d}.${+m}.${y.slice(2)}`; };
const weekdayOf = iso => HE_WEEKDAYS[new Date(iso + "T12:00:00Z").getUTCDay()];

function buildInviteTitle(ev) {
  const parts = [ev.name];
  if (ev.participants) parts.push(`${ev.participants} משתתפים`);
  if (ev.location) parts.push(ev.location);
  const resp = firstName(ev.eventManager || ev.coordinator);
  if (resp) parts.push(`באחריות ${resp}`);
  if (allRows(ev).some(x => x.row.item)) parts.push("משימות בגוף הזימון");
  return parts.filter(Boolean).join(" - ");
}

function buildInviteDescription(ev) {
  const L = [];
  const multi = ev.dateEnd && ev.dateEnd !== ev.dateStart;
  const when = multi
    ? `בתאריכים ${shortDate(ev.dateStart)}–${shortDate(ev.dateEnd)}`
    : `ביום ${weekdayOf(ev.dateStart)} ב-${shortDate(ev.dateStart)}`;
  const hours = ev.timeStart ? ` בין השעות ${ev.timeStart}${ev.timeEnd ? "-" + ev.timeEnd : ""}` : "";

  L.push("שלום לכולם,");
  L.push("");
  L.push(`לקראת ${ev.name}, שיתקיים ${when}${hours}, אשמח לעזרתכם בהיערכות.`);
  if (ev.goals) L.push(ev.goals);
  if (ev.participants) L.push(`בפעילות ישתתפו כ-${ev.participants} משתתפים.`);
  if (ev.location) L.push(`מיקום: ${ev.location}`);
  if (ev.eventManager) L.push(`מנהל/ת האירוע בשטח: ${ev.eventManager}${ev.eventManagerSub ? ` (מחליף/ה: ${ev.eventManagerSub})` : ""}`);

  // משימות לפי שם. משימה של כמה אנשים מופיעה אצל כל אחד מהם.
  const byOwner = new Map();
  const add = (name, line) => { if (!byOwner.has(name)) byOwner.set(name, []); byOwner.get(name).push(line); };
  allRows(ev).forEach(({ group, row }) => {
    if (!row.item) return;
    const line = `${group.name ? group.name + " — " : ""}${row.item}` +
      (row.qty ? ` (כמות: ${row.qty})` : "") + (row.location ? ` · ${row.location}` : "");
    if (row.owners.length) row.owners.forEach(o => add(o.name, line));
    else add("", line);
  });
  const rank = name => { const i = INVITE_OWNER_ORDER.indexOf(firstName(name)); return i < 0 ? 99 : i; };
  const names = [...byOwner.keys()].filter(Boolean)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "he"));
  if (names.length || byOwner.has("")) {
    L.push("");
    L.push("אשמח לעזרתכם בנושאים הבאים:");
    names.forEach(name => {
      L.push("");
      L.push(firstName(name));
      byOwner.get(name).forEach((line, i) => L.push(`${i + 1}. ${line}`));
    });
    if (byOwner.has("")) {
      L.push("");
      L.push("עדיין ללא אחראי/ת:");
      byOwner.get("").forEach((line, i) => L.push(`${i + 1}. ${line}`));
    }
  }

  const notes = ev.sections.filter(s => s.enabled && s.note).map(s => `• ${s.title}: ${s.note}`);
  if (notes.length) { L.push(""); L.push("שימו לב:"); notes.forEach(n => L.push(n)); }

  // נוהל: מעל 100 משתתפים — הקב"ט מעביר לקב"ט העירייה, ונדרש מאבטח חמוש
  if (+ev.participants > 100) {
    const sec = approversFor(STAGES[0]).map(p => firstName(p.name)).join(" / ") || 'הקב"ט';
    L.push("");
    L.push(`בטיחות: אירוע מעל 100 משתתפים — ${sec} מעביר/ה לקב"ט העירייה ומוודא/ת ביצוע ההנחיות. נדרש מאבטח חמוש.`);
  }

  L.push("");
  L.push("אשמח לדעת אם יש צורך בתיאום נוסף.");
  L.push("תודה רבה,");
  L.push(ev.coordinator || ev.createdByName || "");
  L.push("");
  L.push("לטופס המלא: " + SYSTEM_URL + "#event/" + ev.id);
  return L.join("\n");
}

function defaultInvite(ev) {
  return {
    title: buildInviteTitle(ev), location: ev.location || "", description: buildInviteDescription(ev),
    dateStart: ev.dateStart, dateEnd: ev.dateEnd || "", timeStart: ev.timeStart || "", timeEnd: ev.timeEnd || "",
    recipients: defaultRecipients(ev),
  };
}

let inviteDraft = null;   // { evId, data } — הזימון שדינה עורכת כרגע

function currentInvite(ev) {
  if (!inviteDraft || inviteDraft.evId !== ev.id) {
    const saved = ev.invite && !ev.invite.sentAt ? clone(ev.invite) : null;
    inviteDraft = { evId: ev.id, data: saved || defaultInvite(ev) };
  }
  return inviteDraft.data;
}

function inviteEditorHtml(ev) {
  const inv = currentInvite(ev);
  return `<div style="background:var(--gray-light);border-radius:8px;padding:14px;margin-bottom:14px">
    <div class="actions" style="justify-content:space-between;margin-bottom:10px">
      <strong>📅 הזימון שיישלח ל-Outlook / יומן Google</strong>
      <div class="actions">
        ${aiInviteToolsHtml()}
        <button class="btn btn-light btn-sm" data-act="saveInvite">💾 שמירת טיוטת זימון</button>
        <button class="btn btn-light btn-sm" data-act="resetInvite" title="בנייה מחדש מתוך הטופס">↺ מחדש מהטופס</button>
      </div>
    </div>
    <div class="field"><label>נושא</label><input type="text" data-inv="title" value="${esc(inv.title)}"></div>
    <div class="row2">
      <div class="field"><label>מתאריך</label><input type="date" data-inv="dateStart" value="${esc(inv.dateStart)}"></div>
      <div class="field"><label>עד תאריך</label><input type="date" data-inv="dateEnd" value="${esc(inv.dateEnd)}"></div>
      <div class="field"><label>משעה</label><input type="time" data-inv="timeStart" value="${esc(inv.timeStart)}"></div>
      <div class="field"><label>עד שעה</label><input type="time" data-inv="timeEnd" value="${esc(inv.timeEnd)}"></div>
    </div>
    <div class="small muted" style="margin:-4px 0 10px">אירוע של כמה ימים עם שעות נשלח כסדרה יומית. בלי שעות — אירוע של יום שלם.</div>
    <div class="field"><label>מיקום</label><input type="text" data-inv="location" value="${esc(inv.location)}"></div>
    <div class="field"><label>נמענים (${inv.recipients.length})</label>
      <div class="chips" style="background:#fff;border:1px solid #d5dce6;border-radius:6px;padding:6px">
        ${inv.recipients.map((r, i) => `<span class="chip" title="${esc(r.email)}">${esc(r.name)}<button type="button" data-act="delRecipient" data-i="${i}">×</button></span>`).join("")}
        <input class="chip-in" id="recipientIn" list="staffNames" placeholder="+ שם עובד/ת או כתובת מייל" style="border:0">
      </div>
    </div>
    <div class="field"><label>תוכן הזימון</label><textarea data-inv="description" style="min-height:220px;font-size:13px">${esc(inv.description)}</textarea></div>
  </div>`;
}

function approvalPanelHtml(ev, stage) {
  const sched = stage.role === "scheduler";
  const conf = findConflicts(ev, ev.id);
  return `<div class="panel no-print">
    <h3>🖊️ האישור שלך נדרש — ${esc(stage.label)}</h3>
    ${conf.overlap.length || conf.adjacent.length ? conflictsHtml(ev, ev.id) + "<div style='height:12px'></div>" : ""}
    ${checksHtml(eventChecks(ev, ev.id), "🔎 נקודות לבדיקה לפני אישור")}
    ${aiReviewHtml(ev.id, true)}
    ${sched ? inviteEditorHtml(ev) : ""}
    <div class="field"><label>הערה / סיבת החזרה ${sched ? "(למשל: המועד לא מתאים כי...)" : ""}</label>
      <textarea id="approveNote" placeholder="בהחזרה — חובה לפרט למה"></textarea></div>
    <div class="field"><label>חתימה</label>
      <div class="sig-pad-wrap"><canvas id="sigCanvas"></canvas><div class="sig-line"></div><div class="sig-hint">חתמו כאן עם העכבר או האצבע</div></div>
      <div class="sig-tools">
        <button class="btn btn-light btn-sm" data-act="sigClear">ניקוי</button>
        ${S.me.savedSignature ? `<button class="btn btn-light btn-sm" data-act="sigSaved">✍️ החתימה השמורה שלי</button>` : ""}
        <label class="switch"><input type="checkbox" id="sigRemember" ${S.me.savedSignature ? "" : "checked"}> לשמור את החתימה לפעם הבאה</label>
      </div>
    </div>
    <div class="actions" style="justify-content:space-between;margin-top:6px">
      <button class="btn btn-red" data-act="return">${sched ? "↩️ החזרה לשינוי מועד" : "↩️ החזרה לתיקון"}</button>
      <button class="btn btn-green" data-act="approve" style="font-size:15px;padding:11px 22px">${sched ? "✅ אישור ושליחת זימון" : "✅ אישור וחתימה"}</button>
    </div>
  </div>`;
}

async function doApprove(ev) {
  const stage = currentStage(ev);
  if (!stage || !canApprove(ev)) return;
  if (!sigPad || sigPad.isEmpty()) { toast("יש לחתום לפני האישור", "error"); return; }
  const img = sigPad.toDataURL();
  const note = $("approveNote").value.trim();
  const now = Date.now();
  const patch = {
    updatedAt: now,
    ["signatures/" + stage.status]: { name: S.me.name, key: S.me.key, at: now, img, note },
    ["history/" + Store.newKey("h")]: histEntry("approved", { stage: stage.label, note }),
  };
  const next = STAGES[STAGES.indexOf(stage) + 1];

  if (stage.role === "scheduler") {
    const inv = currentInvite(ev);
    if (!inv.recipients.length) { toast("אין נמענים לזימון", "error"); return; }
    if (!inv.dateStart) { toast("חסר תאריך בזימון", "error"); return; }
    if (inv.dateEnd && inv.dateEnd < inv.dateStart) { toast("תאריך הסיום בזימון לפני תאריך ההתחלה", "error"); return; }
    $("loading").classList.remove("hidden");
    const res = await sendCalendarInvite(inv);
    $("loading").classList.add("hidden");
    if (!res.ok && !confirm("שליחת הזימון נכשלה:\n" + res.error + "\n\nלאשר את האירוע בכל זאת, בלי זימון?")) return;
    patch.invite = { ...clone(inv), sentAt: res.ok ? now : null, calendarEventId: res.eventId || null };
    patch.status = "approved";
    patch["history/" + Store.newKey("h")] = histEntry(res.ok ? "invite" : "invite_failed",
      { note: res.ok ? inv.recipients.length + " נמענים" : res.error, at: now + 1 });
  } else {
    patch.status = next.status;
  }

  $("loading").classList.remove("hidden");
  try {
    await Store.update("events/" + ev.id, patch);
    if ($("sigRemember") && $("sigRemember").checked) await Store.update("staff/" + S.me.key, { savedSignature: img });
  } catch (err) {
    $("loading").classList.add("hidden");
    toast("שגיאה בשמירה: " + err.message, "error");
    return;
  }
  $("loading").classList.add("hidden");
  inviteDraft = null; viewLock = false;

  const updated = { ...ev, ...patch };
  if (patch.status === "approved") { notifyApproved(updated); toast("האירוע אושר" + (patch.invite.sentAt ? " והזימון נשלח 🎉" : ""), "ok"); }
  else { notifyStage(updated, next, approversFor(next)); toast("אושר ונחתם — עבר ל" + next.label, "ok"); }
  render(true);
}

async function doReturn(ev) {
  const stage = currentStage(ev);
  if (!stage || !canApprove(ev)) return;
  const reason = $("approveNote").value.trim();
  if (!reason) { toast("יש לפרט בשדה ההערה למה האירוע מוחזר", "error"); $("approveNote").focus(); return; }
  const patch = {
    status: "returned", returnedFrom: stage.status, returnReason: reason, returnedByName: S.me.name, updatedAt: Date.now(),
    ["history/" + Store.newKey("h")]: histEntry("returned", { stage: stage.label, note: reason }),
  };
  if (stage.role === "scheduler" && inviteDraft && inviteDraft.evId === ev.id) patch.invite = clone(inviteDraft.data);
  await Store.update("events/" + ev.id, patch);
  notifyReturned(ev, stage, S.me.name, reason);
  inviteDraft = null; viewLock = false;
  toast("האירוע הוחזר ל" + ev.createdByName, "ok");
  render(true);
}

async function doCancel(ev) {
  const reason = prompt("ביטול האירוע \"" + ev.name + "\".\nסיבת הביטול:");
  if (reason === null) return;
  const calId = ev.invite && ev.invite.calendarEventId;
  let calRes = null;
  if (calId && !IS_DEMO) {
    $("loading").classList.remove("hidden");
    calRes = await sendCalendarCancel(calId);
    $("loading").classList.add("hidden");
  }
  await Store.update("events/" + ev.id, {
    status: "cancelled", updatedAt: Date.now(),
    ["history/" + Store.newKey("h")]: histEntry("cancelled", {
      note: reason + (calRes ? (calRes.ok ? "\nהזימון בוטל ביומן ונשלחה הודעת ביטול למוזמנים." : "\n⚠️ ביטול הזימון ביומן נכשל: " + calRes.error) : ""),
    }),
  });
  editing = null;
  if (calRes && !calRes.ok) toast("האירוע בוטל, אבל ביטול הזימון ביומן נכשל: " + calRes.error, "error");
  else toast("האירוע בוטל" + (calRes ? " — הזימון בוטל אצל כל המוזמנים" : ""), "ok");
  render(true);
}

// ════════════════════════════════════════════════════════════
//  אירועי ממשק — האזנה אחת על #page
// ════════════════════════════════════════════════════════════

function bindPageEvents() {
  const page = $("page");

  page.addEventListener("click", async e => {
    const t = e.target.closest("[data-act]");
    if (!t || t.tagName === "INPUT") return;
    const act = t.dataset.act;
    const r = route();
    const ev = r.name === "event" ? S.events[r.arg] : null;
    const d = editing && editing.data;

    switch (act) {
      case "tab": homeTab = t.dataset.tab; location.hash = "#home/" + homeTab; break;
      case "open": if (!e.target.closest("button")) go("#event/" + t.dataset.id); break;
      case "clone": e.stopPropagation(); cloneEvent(t.dataset.id); break;
      case "deleteEvent": {
        e.stopPropagation();
        const target = S.events[t.dataset.id];
        if (target && canDelete(target) && await deleteEvent(target) && r.name === "event") go("#home");
        break;
      }
      case "boardFilter": boardFilter = t.dataset.f; render(true); break;
      case "calNew": {
        // קיצור דרך מהיומן: טופס חדש שהתאריך כבר ממולא בו
        const data = newEventData();
        data.dateStart = t.dataset.date;
        editing = { id: null, data, dirty: false };
        mounted = "";
        if (location.hash === "#event/new") render(true); else location.hash = "#event/new";
        window.scrollTo(0, 0);
        toast("אירוע חדש ל-" + fmtDate(t.dataset.date) + " — נשאר רק למלא את הפרטים", "ok");
        break;
      }
      case "calToggle":
        calOpen = !calOpen;
        render(true);
        if (calOpen) document.querySelector(".cal").scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      case "calMove": {
        const dlt = +t.dataset.d;
        if (!dlt) { const n = new Date(); calMonth = { y: n.getFullYear(), m: n.getMonth() }; }
        else {
          const mm = calMonth.m + dlt;
          calMonth = { y: calMonth.y + Math.floor(mm / 12), m: ((mm % 12) + 12) % 12 };
        }
        render(true); break;
      }
      case "refresh": viewLock = false; inviteDraft = null; render(true); break;
      case "print": window.print(); break;
      case "aiFill": doAiFill(t); break;
      case "aiInvite": viewLock = true; doAiInvite(ev, t); break;
      case "aiReview": doAiReview(t.dataset.key, t); break;
      case "saveSummary": saveSummary(ev); break;
      case "editSummary": summaryEditing = true; viewLock = true; renderView(ev); break;
      case "cancelSummary": summaryEditing = false; viewLock = false; render(true); break;

      // עריכה — מבנה
      case "goStep": goStep(+t.dataset.n); break;
      case "secRelevant": {
        const si = wizardSteps(d)[editing.step].si;
        d.sections[si].enabled = t.dataset.v === "1";
        markDirty();
        if (d.sections[si].enabled) renderEditor(); else goStep(editing.step + 1);
        break;
      }
      case "addSec":
        d.sections.push({ id: rid(), title: "חלק " + "אבגדהוזחטי"[d.sections.length] + "'", note: "", enabled: true,
          groups: [{ id: rid(), name: "", rows: [{ id: rid(), item: "", owners: [], qty: "", location: "" }] }] });
        markDirty();
        goStep(d.sections.length);           // השלב של החלק החדש (שלב 0 הוא פרטי האירוע)
        break;
      case "delSec":
        if (!confirm(`למחוק את "${d.sections[t.dataset.si].title}" וכל השורות שבו?`)) return;
        d.sections.splice(+t.dataset.si, 1); markDirty(); renderEditor(); break;
      case "addGroup":
        d.sections[t.dataset.si].groups.push({ id: rid(), name: "", rows: [{ id: rid(), item: "", owners: [], qty: "", location: "" }] });
        markDirty(); renderEditor(`[data-p="sections.${t.dataset.si}.groups.${d.sections[t.dataset.si].groups.length - 1}.name"]`); break;
      case "delGroup": {
        const g = d.sections[t.dataset.si].groups[t.dataset.gi];
        if (g.rows.some(x => x.item) && !confirm(`למחוק את הקטגוריה "${g.name}" וכל השורות שבה?`)) return;
        d.sections[t.dataset.si].groups.splice(+t.dataset.gi, 1); markDirty(); renderEditor(); break;
      }
      case "addRow": {
        const rows = d.sections[t.dataset.si].groups[t.dataset.gi].rows;
        rows.push({ id: rid(), item: "", owners: [], qty: "", location: "" });
        markDirty(); renderEditor(`[data-p="sections.${t.dataset.si}.groups.${t.dataset.gi}.rows.${rows.length - 1}.item"]`); break;
      }
      case "delRow":
        d.sections[t.dataset.si].groups[t.dataset.gi].rows.splice(+t.dataset.ri, 1); markDirty(); renderEditor(); break;
      case "delOwner":
        getPath(d, t.dataset.p).owners.splice(+t.dataset.oi, 1); markDirty(); refreshOwners(t.dataset.p, false); break;

      case "saveDraft": saveEvent(false); break;
      case "submit": saveEvent(true); break;
      case "deleteDraft":
        if (!confirm("למחוק את הטיוטה לצמיתות?")) return;
        await Store.set("events/" + editing.id, null);
        editing = null; toast("הטיוטה נמחקה"); go("#home"); break;
      case "cancelEvent": doCancel(ev || S.events[editing.id]); break;

      // אישור
      case "approve": doApprove(ev); break;
      case "return": doReturn(ev); break;
      case "sigClear": sigPad && sigPad.clear(); break;
      case "sigSaved": sigPad && sigPad.load(S.me.savedSignature); viewLock = true; break;
      case "delRecipient": inviteDraft.data.recipients.splice(+t.dataset.i, 1); rerenderApproval(ev); break;
      case "saveInvite":
        await Store.update("events/" + ev.id, { invite: clone(inviteDraft.data) });
        toast("טיוטת הזימון נשמרה", "ok"); break;
      case "resetInvite":
        if (!confirm("לבנות את הזימון מחדש מתוך הטופס? שינויים שעשית בזימון יימחקו.")) return;
        inviteDraft = { evId: ev.id, data: defaultInvite(ev) }; rerenderApproval(ev); break;
    }
  });

  page.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.f && editing && t.type !== "radio") {
      editing.data[t.dataset.f] = t.value;
      markDirty();
      if (["dateStart", "dateEnd"].includes(t.dataset.f)) {
        $("conflictsBox").innerHTML = conflictsHtml(editing.data, editing.id);
        if (t.dataset.f === "dateStart") { const de = document.querySelector('[data-f="dateEnd"]'); if (de) de.min = t.value; }
      }
    } else if (t.dataset.p && editing) {
      setPath(editing.data, t.dataset.p, t.value);
      markDirty();
    } else if (t.dataset.ownerIn) {
      if (pickedFromList(t) && e.inputType !== "insertText") commitOwnerInput(t);
    } else if (t.id === "recipientIn") {
      if (pickedFromList(t) && e.inputType !== "insertText") addRecipient(t);
    } else if (t.dataset.inv && inviteDraft) {
      inviteDraft.data[t.dataset.inv] = t.value;
      viewLock = true;
    } else if (t.id === "aiDesc" && editing) {
      editing.aiDesc = t.value;
    } else if (t.dataset.sum) {
      viewLock = true;
    } else if (t.id === "approveNote") {
      viewLock = true;
    }
  });

  page.addEventListener("change", async e => {
    const t = e.target;
    if (t.type === "radio" && t.dataset.f && editing) {
      editing.data[t.dataset.f] = t.value;
      markDirty();
      t.closest(".yn").querySelectorAll("label").forEach(l => (l.className = ""));
      t.parentElement.className = t.value === "yes" ? "on-yes" : "on-no";
    }
    if (t.dataset.act === "toggleSec") {
      editing.data.sections[t.dataset.si].enabled = t.checked;
      markDirty(); renderEditor();
    }
    if (t.dataset.act === "done") {
      const ev = S.events[t.dataset.id];
      const rowId = t.dataset.row;
      await Store.update("events/" + ev.id, {
        ["done/" + rowId]: t.checked ? { by: S.me.name, key: S.me.key, at: Date.now() } : null,
      });
    }
    if (t.dataset.act === "toggleDoneTasks") { showDoneTasks = t.checked; render(true); }
    if (t.dataset.act === "togglePast") { showPast = t.checked; render(true); }
    if (t.dataset.ownerIn && t.value.trim()) commitOwnerInput(t, false);
    if (t.id === "recipientIn" && t.value.trim()) addRecipient(t);
  });

  page.addEventListener("keydown", e => {
    const t = e.target;
    if ((e.key === "Enter" || e.key === ",") && (t.dataset.ownerIn || t.id === "recipientIn")) {
      e.preventDefault();
      if (t.dataset.ownerIn) commitOwnerInput(t); else addRecipient(t);
    } else if (e.key === "Backspace" && t.dataset.ownerIn && !t.value) {
      const row = getPath(editing.data, t.dataset.ownerIn);
      if (row.owners.length) { row.owners.pop(); markDirty(); renderEditor(`[data-owner-in="${t.dataset.ownerIn}"]`); }
    } else if (e.key === "Enter" && t.tagName === "INPUT" && (t.dataset.p || t.dataset.f)) {
      e.preventDefault();
    }
  });

  page.addEventListener("pointerdown", e => { if (e.target.id === "sigCanvas") viewLock = true; });
}

function addRecipient(input) {
  const v = input.value.trim().replace(/,$/, "");
  if (!v) return;
  const r = route();
  const ev = S.events[r.arg];
  let rec = null;
  if (v.includes("@")) rec = { name: v, email: v };
  else {
    const o = resolveOwner(v);
    if (o && o.key) rec = { name: S.staff[o.key].name, email: staffMail(S.staff[o.key]) };
  }
  if (!rec) { toast("לא נמצא/ה עובד/ת בשם הזה — אפשר להקליד כתובת מייל", "error"); return; }
  const list = inviteDraft.data.recipients;
  if (!list.some(x => x.email.toLowerCase() === rec.email.toLowerCase())) list.push(rec);
  input.value = "";
  rerenderApproval(ev);
  $("recipientIn").focus();
}

// בנייה מחדש של המסך בלי לאבד חתימה שכבר צוירה והערה שכבר נכתבה
function rerenderApproval(ev) {
  viewLock = true;
  const sig = sigPad && !sigPad.isEmpty() ? sigPad.toDataURL() : null;
  const note = $("approveNote") ? $("approveNote").value : "";
  renderView(ev);
  if (sig && sigPad) sigPad.load(sig);
  if ($("approveNote")) $("approveNote").value = note;
}

// ════════════════════════════════════════════════════════════
//  מצב הדגמה
// ════════════════════════════════════════════════════════════

async function demoSeedIfEmpty() {
  if (await Store.get("staff")) return;
  const staff = buildSeedStaff({ email: "snirdoani@gmail.com", name: "שניר דואני" });
  await Store.set("staff", staff);
  S.staff = staff;

  // אירוע לדוגמה — מתוך tofes.xlsx, ממתין לאישור הקב"ט
  const creatorKey = emailKey("snirdoani@gmail.com");
  S.me = { key: creatorKey, ...staff[creatorKey] };
  const d = newEventData();
  const qty = { "הוראה (בעלי רקע מדעי ו/או עובדי הטכנודע)": 20, "עוזרי מדריכים": 20, "לבורנטיות": 6, "עובדי אחזקה": 4, "עובדי ניקיון": 4, "טלפונים": 1, "מכירת כרטיסים": 3, "עיריית חדרה": 2 };
  d.sections.forEach(s => s.groups.forEach(g => g.rows.forEach(r => { if (qty[r.item]) r.qty = String(qty[r.item]); })));
  const now = Date.now();
  Object.assign(d, {
    name: "הפנינג קיץ", goals: "מסע במנהרת הזמן", dateStart: "2027-08-01", dateEnd: "2027-08-31",
    timeStart: "09:00", timeEnd: "16:00", location: "טכנודע", participants: "21241", coordinator: "אמילי גולן",
    calendarCoordinated: "yes", parallelEvents: "no",
    status: "pending_security", createdAt: now, updatedAt: now, submittedAt: now,
    createdBy: "snirdoani@gmail.com", createdByKey: creatorKey, createdByName: "שניר דואני", createdByWorkEmail: "snir@technoda.org.il",
    history: { h1: { at: now, by: "שניר דואני", action: "created" }, h2: { at: now + 1, by: "שניר דואני", action: "submitted" } },
  });
  await Store.set("events/demo1", d);
  S.me = null;
}

function openOutbox() {
  const items = Object.values(S.outbox).sort((a, b) => b.at - a.at);
  $("modalRoot").innerHTML = `<div class="modal-bg" id="mbg"><div class="modal">
    <div class="modal-head"><strong>📬 תיבת הדואר של ההדגמה — ${items.length} הודעות</strong>
      <div class="actions"><button class="btn btn-light btn-sm" id="obClear">ריקון</button><button class="btn btn-light btn-sm" id="obClose">סגירה</button></div></div>
    <div class="small muted" style="margin-bottom:10px">כאן מופיע כל מה שהמערכת הייתה שולחת במייל או כזימון ליומן.</div>
    ${items.length ? items.map(m => `<details class="mail-item"><summary>
        <span>${m.kind === "invite" ? "📅" : "✉️"}</span><strong>${esc(m.subject)}</strong>
        <span class="small muted" dir="ltr">→ ${esc(toArr(m.to).join(", "))}</span><span class="small muted">${esc(fmtTs(m.at))}</span>
      </summary><div class="mail-body">${m.html}</div></details>`).join("") : `<div class="empty">עדיין לא נשלח כלום</div>`}
  </div></div>`;
  const close = () => ($("modalRoot").innerHTML = "");
  $("obClose").onclick = close;
  $("mbg").onclick = e => { if (e.target.id === "mbg") close(); };
  $("obClear").onclick = async () => { await Store.set("outbox", null); close(); };
}
