// ============================================================
// SIGNATURE.JS — משטח חתימה בציור (עכבר / אצבע / עט)
// ============================================================

function createSignaturePad(canvas) {
  const ctx = canvas.getContext("2d");
  let drawing = false, empty = true, last = null;

  function resize() {
    // ציור חד גם במסכים צפופים: גודל פנימי = גודל מוצג × יחס הפיקסלים
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * ratio;
    canvas.height = rect.height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b2a6b";
    empty = true;
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener("pointerdown", e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    last = point(e);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    empty = false;
  });
  canvas.addEventListener("pointermove", e => {
    if (!drawing) return;
    const p = point(e);
    // קו מוחלק: עקומה דרך נקודת האמצע בין הנקודה הקודמת לנוכחית
    const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  canvas.addEventListener("pointerleave", stop);

  resize();

  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; },
    isEmpty() { return empty; },
    toDataURL() { return canvas.toDataURL("image/png"); },
    load(dataUrl) {
      const img = new Image();
      img.onload = () => {
        const r = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, r.width, r.height);
        empty = false;
      };
      img.src = dataUrl;
    },
  };
}
