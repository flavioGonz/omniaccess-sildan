/**
 * Lo que se mueve en el sitio: el scroll suave (Lenis), la escena 3D atada al scroll (GSAP
 * ScrollTrigger) y los filtros de detecciones. El contenido ya viene escrito en el HTML (lo arma
 * scripts/construir.mjs desde contenido.js): sin JavaScript, el sitio se lee igual.
 */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { crearEscena } from "./escena.js";

gsap.registerPlugin(ScrollTrigger);

/** Un equipo modesto (o un teléfono): escena liviana, sin brillo y con menos casas. */
const bajo = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || window.innerWidth < 700;
const menosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)");

// ── Barra: transparente sobre la portada, con fondo al bajar ────────────────────────────────
const barra = document.getElementById("barra");
const fondoBarra = () => barra.classList.toggle("con-fondo", window.scrollY > 40);
window.addEventListener("scroll", fondoBarra, { passive: true });
fondoBarra();

// ── Scroll suave: Lenis mueve, GSAP lee (un solo dueño del scroll) ─────────────────────────
let lenis = null;
if (!menosMovimiento.matches) {
    lenis = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 3.2) });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    // Los enlaces internos también van con Lenis, si no saltan sin animación.
    document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
        const destino = document.querySelector(a.getAttribute("href"));
        if (!destino) return;
        e.preventDefault(); lenis.scrollTo(destino, { offset: -70 });
    }));
}

// ── La escena 3D ─────────────────────────────────────────────────────────────────────────
const escenario = document.getElementById("escenario");
let escena = null;
try {
    escena = crearEscena({ lienzo: document.getElementById("lienzo"), capa: document.getElementById("marcas"), bajo });
} catch (e) { console.warn("Sin escena 3D:", e); }
if (!escena) document.documentElement.classList.add("sin-3d");

if (escena) {
    escena.setQuieto(menosMovimiento.matches);
    menosMovimiento.addEventListener("change", (e) => escena.setQuieto(e.matches));
    escena.prender();

    // La portada y las cuatro escenas llevan el `avance` de 0 a 4.
    ScrollTrigger.create({
        trigger: "#portada", start: "top top", endTrigger: "#historia", end: "bottom bottom",
        onUpdate: (s) => {
            const p = s.progress * 4;
            // Con «menos movimiento» la cámara no vuela: salta a la escena más cercana.
            escena.setAvance(menosMovimiento.matches ? Math.round(p) : p);
        },
    });

    // Al pasar la historia, el escenario se apaga y deja de dibujar (batería y GPU).
    ScrollTrigger.create({
        trigger: "#detecciones", start: "top bottom", end: "top 30%",
        onUpdate: (s) => { escenario.style.opacity = String(1 - s.progress); },
        onLeave: () => escena.apagar(), onEnterBack: () => escena.prender(),
    });
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) escena.apagar();
        else if (ScrollTrigger.positionInViewport("#detecciones", "top") > 0.3) escena.prender();
    });
}

// ── La portada entra una sola vez, orquestada; lo demás no se anima solo ──────────────────
gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
    gsap.from(".portada-texto > *", { y: 28, opacity: 0, duration: 1.1, ease: "power3.out", stagger: 0.12, delay: 0.2 });
    gsap.from(".barra > *", { opacity: 0, duration: 0.9, delay: 0.6, stagger: 0.05 });
    // Cada texto de la historia aparece cuando su escena llega al medio de la pantalla.
    document.querySelectorAll(".escena-texto").forEach((t) => {
        gsap.from(t, { opacity: 0, y: 40, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: t, start: "top 75%", toggleActions: "play none none reverse" } });
    });
});

// ── Filtros de detecciones ───────────────────────────────────────────────────────────────
const filtros = [...document.querySelectorAll(".filtro")];
const grupos = [...document.querySelectorAll(".grupo")];
filtros.forEach((f) => f.addEventListener("click", () => {
    const g = f.dataset.g;
    filtros.forEach((x) => x.setAttribute("aria-pressed", String(x === f)));
    grupos.forEach((x) => { x.hidden = g !== "todos" && x.dataset.g !== g; });
    // Al filtrar, la lista cambia de alto: ScrollTrigger tiene que volver a medir.
    ScrollTrigger.refresh();
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
