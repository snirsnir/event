// ============================================================
// ADMIN.JS — עמדת ניהול: עובדים והרשאות, מוזמנים קבועים לזימון
// ============================================================

let adminSearch = "";
let adminModalOpen = false;

// לא בונים את העמוד מחדש מתחת לידיים של מי שמקליד/ה בו
function adminBusy() {
  const a = document.activeElement;
  return adminModalOpen || (a && a.id === "admSearch");
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
