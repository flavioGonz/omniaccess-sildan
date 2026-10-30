/**
 * Lo poco que se mueve en el sitio (30/10, Nico: «las animaciones son pésimas, retiralas»): sin
 * librerías de animación ni scroll suave. Los videos corren sólo mientras se ven (batería y datos),
 * y con «menos movimiento» quedan quietos en su foto. Más los filtros de detecciones y las descargas.
 */
const menosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)");

// ── Videos: se reproducen sólo a la vista ──────────────────────────────────────────────────
const videos = [...document.querySelectorAll("video.video")];
const mirar = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
        const v = e.target;
        if (e.isIntersecting && !menosMovimiento.matches) v.play().catch(() => { /* el navegador no dejó: queda la foto */ });
        else v.pause();
    }
}, { threshold: 0.25 });
videos.forEach((v) => { v.muted = true; mirar.observe(v); });
menosMovimiento.addEventListener("change", (e) => { if (e.matches) videos.forEach((v) => v.pause()); });

// ── Filtros de detecciones ───────────────────────────────────────────────────────────────
const filtros = [...document.querySelectorAll(".filtro")];
const grupos = [...document.querySelectorAll(".grupo")];
filtros.forEach((f) => f.addEventListener("click", () => {
    const g = f.dataset.g;
    filtros.forEach((x) => x.setAttribute("aria-pressed", String(x === f)));
    grupos.forEach((x) => { x.hidden = g !== "todos" && x.dataset.g !== g; });
}));

// ── Descargas dentro de claude.ai: el visor pide permiso para guardar el archivo ─────────
(async () => {
    const usar = window.claude?.use;
    if (!usar) return;
    let descargas = null;
    try { descargas = await usar("downloads"); } catch { /* sin el permiso, el enlace queda como estaba */ }
    if (!descargas) return;
    document.querySelectorAll(".lista-descargas a").forEach((a) => a.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const href = a.getAttribute("href"), nombre = href.split("/").pop();
        const etiqueta = a.querySelector("span"), antes = etiqueta.textContent;
        etiqueta.textContent = "Preparando…";
        try {
            const r = await fetch(href); if (!r.ok) throw new Error(String(r.status));
            await descargas.save({ filename: nombre, data: await r.blob() });
        } catch (e) { if (!e || e.code !== "declined") window.open(href, "_blank"); }
        etiqueta.textContent = antes;
    }));
})();
