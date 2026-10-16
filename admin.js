// ============================================================
// ADMIN.JS — עמדת ניהול: עובדים והרשאות, מוזמנים קבועים לזימון
// ============================================================

let adminSearch = "";
let adminModalOpen = false;
let adminTpl = null;      // עותק התבנית בעריכה — null כשהעורך סגור

// לא בונים את העמוד מחדש מתחת לידיים של מי שמקליד/ה בו
function adminBusy() {
  const a = document.activeElement;
  return adminModalOpen || !!adminTpl || (a && a.id === "admSearch");
}

function renderAdmin(page) {
  const all = staffList();
  const q = adminSearch.trim().toLowerCase();
  const list = all.filter(p => !q || (p.name || "").toLowerCase().includes(q) || (p.authEmail || "").includes(q) || (p.workEmail || "").includes(q));
  const invitees = toArr(S.settings.defaultInvitees);

  page.innerHTML = `
    <div class="actions" style="justify-content:space-between;margin-bottom:14px">
      <a href="#home" class="btn btn-light btn-sm">→ חזרה</a>
      <span class="card-title">⚙️ עמדת ניהול</span>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">שרשרת האישורים</span></div>
      <div class="sigs">${STAGES.map((st, i) => {
        const who = approversFor(st);
        return `<div class="sig ${who.length ? "signed" : "current"}" style="min-height:0">
          <div class="sig-label">${i + 1}. ${esc(st.label)}</div>
          <div class="small">${who.length ? who.map(p => esc(p.name)).join(", ") : "⚠️ אין אף אחד בתפקיד — אירועים ייתקעו בשלב הזה"}</div>
        </div>`;
      }).join("")}</div>
      <div class="small muted" style="margin-top:10px">מסמנים את התפקיד בטבלת העובדים למטה. אפשר כמה אנשים לאותו שלב (למשל ממלא/ת מקום) — כל אחד מהם יכול לאשר.</div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">עובדים (${all.filter(p => p.active !== false).length} פעילים)</span>
        <div class="actions">
          <input id="admSearch" class="inp" placeholder="🔍 חיפוש" value="${esc(adminSearch)}" style="width:180px">
          <button class="btn btn-sm" id="admAdd">➕ הוספת עובד/ת</button>
        </div>
      </div>
      <div class="small muted" style="margin-bottom:10px">הכניסה למערכת היא עם חשבון ה-Gmail האישי. מיילים וזימונים נשלחים למייל העבודה (ואם אין — ל-Gmail).</div>
      <div class="table-wrap"><table class="list">
        <thead><tr><th>שם</th><th>Gmail לכניסה</th><th>מייל עבודה</th><th>תפקידים</th><th>פעיל/ה</th><th></th></tr></thead>
        <tbody>${list.map(p => `<tr class="${p.active === false ? "inactive" : ""}">
          <td><strong>${esc(p.name)}</strong></td>
          <td dir="ltr" style="text-align:right" class="small">${esc(p.authEmail)}</td>
          <td dir="ltr" style="text-align:right" class="small">${esc(p.workEmail || "—")}</td>
          <td><div class="role-cbs">${Object.keys(ROLE_LABELS).map(r => `<label title="${esc(ROLE_LABELS[r])}">
            <input type="checkbox" data-adm="role" data-k="${esc(p.key)}" data-r="${r}" ${p.roles && p.roles[r] ? "checked" : ""}>
            <span class="role-tag ${r}">${esc(ROLE_LABELS[r].split(" —")[0])}</span></label>`).join("")}</div></td>
          <td><input type="checkbox" data-adm="active" data-k="${esc(p.key)}" ${p.active !== false ? "checked" : ""}></td>
          <td style="white-space:nowrap">
            <button class="btn btn-light btn-sm" data-adm="edit" data-k="${esc(p.key)}">עריכה</button>
            <button class="btn-icon" data-adm="del" data-k="${esc(p.key)}" title="מחיקה">🗑</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="6" class="empty">לא נמצאו עובדים</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">📅 מוזמנים קבועים לכל זימון</span></div>
      <div class="small muted" style="margin-bottom:10px">הם נוספים אוטומטית לזימון שמוכן לדינה, יחד עם יוצר/ת האירוע וכל האחראים בטופס. בשלב האישור אפשר תמיד להוסיף ולהוריד.</div>
      <div class="chips" style="border:1px solid #d5dce6;border-radius:6px;padding:6px">
        ${invitees.map((r, i) => `<span class="chip" title="${esc(r.email)}">${esc(r.name)}<button type="button" data-adm="delInvitee" data-i="${i}">×</button></span>`).join("")}
        <input class="chip-in" id="admInvitee" list="staffNames" placeholder="+ שם עובד/ת או כתובת מייל" style="border:0">
      </div>
    </div>

    ${templateCardHtml()}

    ${IS_DEMO ? `<div class="card">
      <div class="card-header"><span class="card-title">🧪 מצב הדגמה</span></div>
      <button class="btn btn-red" id="admReset">איפוס כל נתוני ההדגמה</button>
    </div>` : ""}`;

  $("admSearch").oninput = e => {
    adminSearch = e.target.value;
    renderAdmin(page);
    const s = $("admSearch"); s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  };
  $("admAdd").onclick = () => staffModal(null);
  bindTemplateEditor(page);
  if ($("admReset")) $("admReset").onclick = () => { if (confirm("למחוק את כל נתוני ההדגמה ולהתחיל מחדש?")) Store.resetDemo(); };

  const inv = $("admInvitee");
  const addInv = () => {
    const v = inv.value.trim().replace(/,$/, "");
    if (!v) return;
    let rec = null;
    if (v.includes("@")) rec = { name: v, email: v };
    else {
      const o = resolveOwner(v);
      if (o && o.key) rec = { name: S.staff[o.key].name, email: staffMail(S.staff[o.key]) };
    }
    if (!rec) { toast("לא נמצא/ה עובד/ת בשם הזה — אפשר להקליד כתובת מייל", "error"); return; }
    if (invitees.some(x => x.email.toLowerCase() === rec.email.toLowerCase())) { inv.value = ""; return; }
    Store.update("settings", { defaultInvitees: [...invitees, rec] });
  };
  inv.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addInv(); } };
  inv.oninput = e => { if (e.inputType !== "insertText" && pickedFromList(inv)) addInv(); };

  page.querySelectorAll("[data-adm]").forEach(el => {
    const k = el.dataset.k;
    const p = k ? S.staff[k] : null;
    switch (el.dataset.adm) {
      case "role":
        el.onchange = async () => {
          if (el.dataset.r === "admin" && k === S.me.key && !el.checked &&
              !confirm("להסיר את הרשאת האדמין שלך? לא תוכל/י להיכנס יותר לעמדת הניהול.")) { el.checked = true; return; }
          await Store.update("staff/" + k + "/roles", { [el.dataset.r]: el.checked || null });
        };
        break;
      case "active":
        el.onchange = () => Store.update("staff/" + k, { active: el.checked });
        break;
      case "edit":
        el.onclick = () => staffModal(k);
        break;
      case "del":
        el.onclick = async () => {
          if (k === S.me.key) { toast("אי אפשר למחוק את עצמך", "error"); return; }
          if (!confirm(`למחוק את ${p.name}? (אפשר גם רק לסמן כלא פעיל/ה)`)) return;
          await Store.set("staff/" + k, null);
        };
        break;
      case "delInvitee":
        el.onclick = () => {
          const next = invitees.slice(); next.splice(+el.dataset.i, 1);
          Store.update("settings", { defaultInvitees: next });
        };
        break;
    }
  });
}

function staffModal(key) {
  const p = key ? S.staff[key] : { name: "", authEmail: "", workEmail: "" };
  adminModalOpen = true;
  $("modalRoot").innerHTML = `<div class="modal-bg"><div class="modal" style="width:460px">
    <div class="modal-head"><strong>${key ? "עריכת עובד/ת" : "הוספת עובד/ת"}</strong></div>
    <div class="panel" style="box-shadow:none;border:0;padding:0;margin:0">
      <div class="field"><label>שם מלא</label><input type="text" id="smName" value="${esc(p.name)}"></div>
      <div class="field"><label>Gmail לכניסה</label><input type="text" id="smAuth" dir="ltr" value="${esc(p.authEmail)}" placeholder="name@gmail.com"></div>
      <div class="field"><label>מייל עבודה (להתראות וזימונים)</label><input type="text" id="smWork" dir="ltr" value="${esc(p.workEmail || "")}" placeholder="name@technoda.org.il"></div>
    </div>
    <div class="actions" style="justify-content:flex-end;margin-top:8px">
      <button class="btn btn-light" id="smCancel">ביטול</button>
      <button class="btn" id="smSave">שמירה</button>
    </div>
  </div></div>`;
  const close = () => { adminModalOpen = false; $("modalRoot").innerHTML = ""; render(true); };
  $("smCancel").onclick = close;
  $("smName").focus();
  $("smSave").onclick = async () => {
    const name = $("smName").value.trim();
    const authEmail = $("smAuth").value.trim().toLowerCase();
    const workEmail = $("smWork").value.trim().toLowerCase();
    const mailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!name) { toast("יש למלא שם", "error"); return; }
    if (!mailRe.test(authEmail)) { toast("כתובת Gmail לא תקינה", "error"); return; }
    if (workEmail && !mailRe.test(workEmail)) { toast("מייל העבודה לא תקין", "error"); return; }
    const newKey = emailKey(authEmail);
    if (newKey !== key && S.staff[newKey]) { toast("כבר קיים/ת עובד/ת עם ה-Gmail הזה", "error"); return; }

    const rec = { ...(key ? S.staff[key] : { active: true, roles: {} }), name, authEmail, workEmail };
    if (key && newKey !== key) {
      // המפתח הוא כתובת ה-Gmail — שינוי שלה מעביר את הרשומה
      await Store.update("staff", { [newKey]: rec, [key]: null });
    } else {
      await Store.set("staff/" + newKey, rec);
    }
    toast("נשמר", "ok");
    close();
  };
}

// ════════════════════════════════════════════════════════════
//  תבנית ברירת המחדל של הטופס — החלקים, הקטגוריות והשורות שכל אירוע חדש מתחיל מהם
//  נשמרת ב-settings/template. בלי תבנית שמורה — DEFAULT_SECTIONS מ-template.js.
// ════════════════════════════════════════════════════════════

function templateCardHtml() {
  const custom = toArr(S.settings.template).length > 0;
  if (!adminTpl) {
    const tpl = currentTemplate();
    const rowsN = tpl.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.rows.length, 0), 0);
    return `<div class="card">
      <div class="card-header">
        <span class="card-title">📋 תבנית ברירת המחדל של הטופס</span>
        <button class="btn btn-sm" id="tplOpen">עריכת התבנית</button>
      </div>
      <div class="small muted">${tpl.length} חלקים · ${rowsN} שורות · ${custom ? "תבנית מותאמת" : "התבנית המקורית מהאקסל"}.
        כל אירוע חדש מתחיל מהתבנית הזו. שינוי בה לא משנה אירועים שכבר נפתחו.</div>
    </div>`;
  }
  const t = adminTpl;
  return `<div class="card" id="tplCard">
    <div class="card-header">
      <span class="card-title">📋 עריכת תבנית ברירת המחדל</span>
      <div class="actions">
        ${custom ? `<button class="btn btn-red btn-sm" id="tplReset">שחזור התבנית המקורית</button>` : ""}
        <button class="btn btn-light btn-sm" id="tplCancel">ביטול</button>
        <button class="btn btn-green btn-sm" id="tplSave">💾 שמירת התבנית</button>
      </div>
    </div>
    <div class="small muted" style="margin-bottom:10px">אחראים — שמות פרטיים מופרדים בפסיק (למשל: אמילי, מידן). הם מותאמים לעובדים במערכת כשנפתח אירוע.</div>
    ${t.map((sec, si) => `<div class="section">
      <div class="sec-head">
        <input class="sec-title" data-tp="${si}.title" value="${esc(sec.title)}">
        <input class="sec-note" data-tp="${si}.note" value="${esc(sec.note || "")}" placeholder="הערה לחלק (אופציונלי)">
        <button class="btn-icon" data-tpa="delSec" data-si="${si}" title="מחיקת החלק">🗑</button>
      </div>
      <div class="sheet-wrap"><table class="sheet">
        <thead><tr><th>קטגוריה</th><th>פריט</th><th>אחראים</th><th class="w-x"></th></tr></thead>
        <tbody>${sec.groups.map((g, gi) => (g.rows.length ? g.rows : [null]).map((r, ri) => `<tr>
          ${ri === 0 ? `<td class="cat" rowspan="${Math.max(g.rows.length, 1)}">
            <input data-tp="${si}.groups.${gi}.name" value="${esc(g.name)}" placeholder="קטגוריה">
            <div class="cat-tools"><button class="btn btn-light btn-sm" data-tpa="addRow" data-si="${si}" data-gi="${gi}">+ שורה</button>
            <button class="btn-icon" data-tpa="delGroup" data-si="${si}" data-gi="${gi}" title="מחיקת הקטגוריה">🗑</button></div></td>` : ""}
          ${r ? `<td><input data-tp="${si}.groups.${gi}.rows.${ri}.item" value="${esc(r.item)}" placeholder="פריט / משימה"></td>
            <td><input data-tp="${si}.groups.${gi}.rows.${ri}.ownersText" value="${esc(r.ownersText)}" placeholder="—" list="staffNames"></td>
            <td class="w-x"><button class="btn-icon" data-tpa="delRow" data-si="${si}" data-gi="${gi}" data-ri="${ri}" title="מחיקת השורה">✕</button></td>`
          : `<td colspan="3" class="muted small">אין שורות — "+ שורה"</td>`}
        </tr>`).join("")).join("")}</tbody>
      </table></div>
      <div class="sec-foot"><button class="btn btn-light btn-sm" data-tpa="addGroup" data-si="${si}">+ קטגוריה חדשה</button></div>
    </div>`).join("")}
    <div style="margin-top:14px"><button class="btn btn-light" data-tpa="addSec">+ הוספת חלק</button></div>
  </div>`;
}

// התבנית הנוכחית: השמורה ב-settings, או המקורית
function currentTemplate() {
  const saved = toArr(S.settings.template);
  const src = saved.length ? saved : DEFAULT_SECTIONS;
  return src.map(s => ({
    title: s.title || "", note: s.note || "",
    groups: toArr(s.groups).map(g => ({
      name: g.name || "",
      rows: toArr(g.rows).map(r => ({ item: r.item || "", owners: toArr(r.owners) })),
    })),
  }));
}

function bindTemplateEditor(page) {
  const rerender = () => {
    const y = window.scrollY;
    $("tplCard").outerHTML = templateCardHtml();
    bindTemplateEditor(page);
    window.scrollTo(0, y);
  };
  if ($("tplOpen")) {
    $("tplOpen").onclick = () => {
      adminTpl = currentTemplate().map(s => ({ ...s, groups: s.groups.map(g => ({ ...g, rows: g.rows.map(r => ({ item: r.item, ownersText: r.owners.join(", ") })) })) }));
      renderAdmin(page);
      $("tplCard").scrollIntoView({ block: "start" });
    };
    return;
  }
  if (!$("tplCard")) return;

  $("tplCancel").onclick = () => { adminTpl = null; renderAdmin(page); };
  if ($("tplReset")) $("tplReset").onclick = async () => {
    if (!confirm("לחזור לתבנית המקורית מהאקסל? השינויים בתבנית יימחקו (אירועים קיימים לא ישתנו).")) return;
    await Store.update("settings", { template: null });
    adminTpl = null; toast("התבנית המקורית שוחזרה", "ok");
  };
  $("tplSave").onclick = async () => {
    const tpl = adminTpl.map(s => ({
      title: s.title.trim() || "חלק", note: (s.note || "").trim(),
      groups: s.groups.map(g => ({
        name: g.name.trim(),
        rows: g.rows.filter(r => r.item.trim()).map(r => ({
          item: r.item.trim(),
          owners: r.ownersText.split(",").map(x => x.trim()).filter(Boolean),
        })),
      })).filter(g => g.name || g.rows.length),
    }));
    await Store.update("settings", { template: tpl });
    adminTpl = null; toast("התבנית נשמרה — אירועים חדשים ייפתחו ממנה", "ok");
  };

  $("tplCard").querySelectorAll("[data-tp]").forEach(el => {
    el.oninput = () => {
      const ps = el.dataset.tp.split(".");
      let o = adminTpl;
      for (let i = 0; i < ps.length - 1; i++) o = o[ps[i]];
      o[ps[ps.length - 1]] = el.value;
    };
  });
  $("tplCard").querySelectorAll("[data-tpa]").forEach(el => {
    el.onclick = () => {
      const si = +el.dataset.si, gi = +el.dataset.gi, ri = +el.dataset.ri;
      const emptyRow = () => ({ item: "", ownersText: "" });
      switch (el.dataset.tpa) {
        case "addSec": adminTpl.push({ title: "חלק " + "אבגדהוזחטי"[adminTpl.length] + "'", note: "", groups: [{ name: "", rows: [emptyRow()] }] }); break;
        case "delSec": if (!confirm(`למחוק את "${adminTpl[si].title}" מהתבנית?`)) return; adminTpl.splice(si, 1); break;
        case "addGroup": adminTpl[si].groups.push({ name: "", rows: [emptyRow()] }); break;
        case "delGroup": adminTpl[si].groups.splice(gi, 1); break;
        case "addRow": adminTpl[si].groups[gi].rows.push(emptyRow()); break;
        case "delRow": adminTpl[si].groups[gi].rows.splice(ri, 1); break;
      }
      rerender();
    };
  });
}
