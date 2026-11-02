/**
 * Lo poco que se mueve en el sitio (30/10, Nico: «las animaciones son pésimas, retiralas»): sin
 * librerías de animación ni scroll suave. Los videos corren sólo mientras se ven (batería y datos),
 * y con «menos movimiento» quedan quietos en su foto. El recorrido por los datos de un evento
 * (2/11, Nico: «si podés animala, para explicar cada dato») es lo único que avanza solo, y sólo a
 * la vista. Más los filtros de detecciones y las descargas.
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

// ── Así se ve un evento: un recorrido por los datos de cada ficha ──────────────────────────
// Ilumina un dato por vez y dice qué es abajo; avanza solo mientras se ve (cada PASO_MS) y se
// detiene si la persona toca uno o pasa el mouse por encima. Con «menos movimiento» no avanza solo.
const PASO_MS = 4200, RETOMA_MS = 12000;
document.querySelectorAll(".evento").forEach((fig) => {
    const puntos = [...fig.querySelectorAll(".punto")];
    const items = [...fig.querySelectorAll(".evento-lista button")];
    const texto = fig.querySelector(".evento-texto");
    if (!puntos.length || !texto) return;
    fig.classList.add("con-recorrido");
    texto.innerHTML = '<span class="n"></span><div><b></b><p></p></div><span class="barra-avance" aria-hidden="true"><i></i></span>';
    const n = texto.querySelector(".n"), b = texto.querySelector("b"), p = texto.querySelector("p"), avance = texto.querySelector(".barra-avance i");
    let actual = 0, reloj = null, pausaHasta = 0, visible = false;
    const mostrar = (i) => {
        actual = (i + puntos.length) % puntos.length;
        puntos.forEach((x, k) => x.classList.toggle("activo", k === actual));
        items.forEach((x, k) => x.setAttribute("aria-current", String(k === actual)));
        const it = items[actual];
        n.textContent = String(actual + 1);
        b.textContent = it.querySelector("b").textContent;
        p.textContent = it.querySelector(".d").textContent;
        if (avance && !menosMovimiento.matches) { avance.style.transition = "none"; avance.style.width = "0"; void avance.offsetWidth; avance.style.transition = `width ${PASO_MS}ms linear`; avance.style.width = "100%"; }
    };
    const andar = () => {
        clearInterval(reloj); reloj = null;
        if (!visible || menosMovimiento.matches) { if (avance) avance.style.width = "0"; return; }
        reloj = setInterval(() => { if (Date.now() >= pausaHasta) mostrar(actual + 1); }, PASO_MS);
    };
    const elegir = (i) => { pausaHasta = Date.now() + RETOMA_MS; mostrar(i); };
    puntos.forEach((x, k) => x.addEventListener("click", () => elegir(k)));
    items.forEach((x, k) => x.addEventListener("click", () => elegir(k)));
    fig.addEventListener("mouseenter", () => { pausaHasta = Infinity; });
    fig.addEventListener("mouseleave", () => { pausaHasta = Date.now() + 1500; });
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; andar(); }, { threshold: 0.4 }).observe(fig);
    menosMovimiento.addEventListener("change", andar);
    mostrar(0);
});

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
