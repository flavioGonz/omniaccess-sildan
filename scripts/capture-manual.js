#!/usr/bin/env node
/**
 * OmniAccess · capturador de imágenes para los manuales.
 *
 * Recorre las pantallas declaradas en docs/manual/shots.json, las fotografía a 2×
 * (nítidas al imprimir) y las guarda en docs/manual/img/ con el nombre exacto que
 * espera el Markdown. Reemplaza el trabajo manual de ir pantalla por pantalla.
 *
 *   node scripts/capture-manual.js                 # todas las que falten
 *   node scripts/capture-manual.js --all           # rehace todas
 *   node scripts/capture-manual.js --only op-03    # solo las que empiecen con eso
 *   node scripts/capture-manual.js --list          # qué haría, sin hacerlo
 *
 * Cada entrada de shots.json:
 *   { "file": "op-03-monitor.png", "desc": "...", "url": "/admin/monitor-lpr",
 *     "wait": 2500,                  ms extra tras cargar (video, sockets)
 *     "click": ["texto o selector"], clicks previos (abrir un modal, una pestaña)
 *     "clip": "#selector",           recorta a ese elemento en vez de la página
 *     "viewport": [1600, 900],       tamaño de ventana
 *     "hide": [".selector"],         oculta elementos (datos sensibles)
 *     "full": true,                  página completa con scroll
 *     "marks": [{ "sel": "…", "label": "…" }] }
 *
 * Las "marks" son las anotaciones del manual: se declara QUÉ elemento señalar
 * (selector CSS o texto visible) y el capturador calcula su posición exacta en la
 * imagen, que queda guardada en docs/manual/marks.json. El compilador dibuja un
 * recuadro numerado sobre ese elemento — nunca encima del contenido y sin coordenadas
 * puestas a ojo.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { SignJWT } = require("jose");

const ROOT = path.resolve(__dirname, "..");
const MDIR = path.join(ROOT, "docs", "manual");
const IMGDIR = path.join(MDIR, "img");
const BASE = process.env.MANUAL_BASE_URL || "http://127.0.0.1:10001";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const only = (() => { const i = args.indexOf("--only"); return i >= 0 ? args[i + 1] : null; })();

function envValue(key) {
    const line = fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").find((l) => l.startsWith(key + "="));
    return line ? line.slice(key.length + 1).replace(/^"|"$/g, "").trim() : "";
}

async function sessionCookie() {
    const secret = envValue("JWT_SECRET");
    if (!secret) throw new Error("No encuentro JWT_SECRET en .env");
    const token = await new SignJWT({ id: "manual-bot", role: "ADMIN", username: "admin" })
        .setProtectedHeader({ alg: "HS256" }).setExpirationTime("2h")
        .sign(new TextEncoder().encode(secret));
    const u = new URL(BASE);
    return { name: "session", value: token, domain: u.hostname, path: "/", httpOnly: true, sameSite: "Lax" };
}

/** Deja la imagen lista para imprimir: ancho máximo 2400 px (≈200 dpi en una página A4
 *  con márgenes) y PNG recomprimido. Una captura de 5 MB hace inservible al PDF. */
async function optimize(buf, dest) {
    try {
        const sharp = require("sharp");
        const img = sharp(buf);
        const { width } = await img.metadata();
        const pipe = width > 2400 ? img.resize({ width: 2400, withoutEnlargement: true }) : img;
        await pipe.png({ compressionLevel: 9, effort: 8 }).toFile(dest);
    } catch {
        fs.writeFileSync(dest, buf);   // sin sharp: guardamos tal cual
    }
}

/** CSS que se inyecta en todas las capturas: apaga animaciones y cursores parpadeantes
 *  para que la foto salga siempre igual, y suaviza el render de texto. */
const STEADY_CSS = `
  *, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important;
                           transition-duration: 0s !important; caret-color: transparent !important; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  html { -webkit-font-smoothing: antialiased; }
`;

/** Localiza un elemento por selector CSS o por texto visible. */
function buscar(page, sel, nth = 0) {
    const esCss = /^[.#\[]|^(?:div|span|button|a|table|section|header|aside|nav|img|video|input)\b/.test(sel);
    const loc = esCss ? page.locator(sel) : page.getByText(sel, { exact: false });
    return loc.nth(nth);
}

/**
 * Convierte las marcaciones declaradas en el shot (selector + etiqueta) en
 * recuadros en % sobre la imagen capturada. Así las anotaciones del manual caen
 * SIEMPRE sobre el elemento real: no se ponen coordenadas a mano.
 */
/** Ayudantes disponibles dentro de las expresiones "js:" de las marcaciones:
 *    __t("Adentro")     → el elemento hoja cuyo texto es exactamente ese
 *    __c(".clase", 2)   → el enésimo elemento que matchea el selector       */
const HELPERS = `
  window.__t = (t) => [...document.querySelectorAll('*')]
      .find(e => e.children.length === 0 && (e.textContent||'').trim() === t) || null;
  window.__c = (sel, n) => document.querySelectorAll(sel)[n || 0] || null;
`;

async function resolverMarcas(page, s) {
    if (!s.marks || !s.marks.length) return null;
    await page.evaluate(HELPERS).catch(() => { });

    // Sistema de referencia según cómo se saca la foto (recorte / página completa / ventana)
    let ref = null;
    if (s.clip) {
        ref = await page.evaluate((sel) => {
            const e = document.querySelector(sel); if (!e) return null;
            const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };
        }, s.clip);
    }
    if (!ref) {
        ref = s.full
            ? await page.evaluate(() => ({ x: -window.scrollX, y: -window.scrollY, w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }))
            : await page.evaluate(() => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }));
    }

    const salida = [];
    for (const mk of s.marks) {
        if (!mk.sel) continue;
        const pad = mk.pad ?? 4;
        const subir = mk.up ?? 0;                    // sube N padres antes de medir (marcar el bloque, no la etiqueta)
        let r = null;
        if (mk.sel.startsWith("js:")) {
            // expresión JS que devuelve el elemento a señalar
            r = await page.evaluate(([expr, up]) => {
                let n = eval(expr); if (!n) return null;
                for (let k = 0; k < up && n.parentElement; k++) n = n.parentElement;
                const b = n.getBoundingClientRect();
                return { x: b.left, y: b.top, width: b.width, height: b.height };
            }, [mk.sel.slice(3), subir]).catch(() => null);
        } else {
            r = await buscar(page, mk.sel, mk.nth ?? 0).evaluate((el, up) => {
                let n = el; for (let k = 0; k < up && n.parentElement; k++) n = n.parentElement;
                const b = n.getBoundingClientRect();
                return { x: b.left, y: b.top, width: b.width, height: b.height };
            }, subir).catch(() => null);
        }
        if (!r || !r.width) { console.log(`     · marca sin elemento: "${mk.sel}"`); continue; }
        const pct = (v, t) => Math.round((v / t) * 1000) / 10;
        const x = pct(r.x - ref.x - pad, ref.w), y = pct(r.y - ref.y - pad, ref.h);
        const w = pct(r.width + pad * 2, ref.w), h = pct(r.height + pad * 2, ref.h);
        if (x < -5 || y < -5 || x > 100 || y > 100) { console.log(`     · marca fuera de cuadro: "${mk.sel}"`); continue; }
        salida.push({
            x: Math.max(0, x), y: Math.max(0, y),
            w: Math.min(w, 100 - Math.max(0, x)), h: Math.min(h, 100 - Math.max(0, y)),
            label: mk.label || "",
            ...(mk.pos ? { pos: mk.pos } : {}),      // "arriba" | "abajo": de qué lado va la etiqueta
            ...(mk.lado ? { lado: mk.lado } : {}),   // "izq" | "der"
        });
    }
    return salida.length ? salida : null;
}

async function main() {
    const shotsFile = path.join(MDIR, "shots.json");
    if (!fs.existsSync(shotsFile)) { console.error("Falta docs/manual/shots.json"); process.exit(2); }
    const shots = JSON.parse(fs.readFileSync(shotsFile, "utf8")).shots;
    fs.mkdirSync(IMGDIR, { recursive: true });

    let pending = shots.filter((s) => {
        if (only && !s.file.startsWith(only)) return false;
        if (has("--all")) return true;
        return !fs.existsSync(path.join(IMGDIR, s.file));
    });

    if (has("--list")) {
        console.log(`${pending.length} captura(s) a tomar:`);
        pending.forEach((s) => console.log(`  ${s.file.padEnd(34)} ${s.url}  ${s.desc || ""}`));
        return;
    }
    if (!pending.length) { console.log("Nada para capturar: todas las imágenes ya existen (usá --all para rehacerlas)."); return; }

    const browser = await chromium.launch();
    const ctx = await browser.newContext({
        viewport: { width: 1600, height: 900 },
        deviceScaleFactor: 2,          // 2× → nítidas en el PDF impreso
        colorScheme: "dark",
        locale: "es-UY",
        timezoneId: "America/Montevideo",
    });
    await ctx.addCookies([await sessionCookie()]);
    const page = await ctx.newPage();
    page.on("pageerror", () => { });

    // Marcaciones ya calculadas de capturas anteriores (se van actualizando)
    const marksFile = path.join(MDIR, "marks.json");
    let marks = {};
    try { marks = JSON.parse(fs.readFileSync(marksFile, "utf8")); } catch { }

    let ok = 0, fail = 0;
    for (const s of pending) {
        const dest = path.join(IMGDIR, s.file);
        try {
            if (s.viewport) await page.setViewportSize({ width: s.viewport[0], height: s.viewport[1] });
            else await page.setViewportSize({ width: 1600, height: 900 });

            await page.goto(BASE + s.url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => { });
            // sesiones que viven en localStorage (la consola del guardia, p.ej.)
            if (s.storage) {
                await page.evaluate((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, s.storage);
                await page.reload({ waitUntil: "networkidle", timeout: 45000 }).catch(() => { });
            }
            await page.addStyleTag({ content: STEADY_CSS });
            await page.waitForTimeout(s.wait ?? 1800);

            for (const c of s.click || []) {
                await buscar(page, c).click({ timeout: 8000 }).catch(() => console.log(`   (no pude clickear "${c}")`));
                await page.waitForTimeout(s.clickWait ?? 1400);
            }
            // "press": mantener presionado un control durante la foto (el botón de pánico
            // se activa manteniéndolo, así que hay que fotografiarlo a mitad de camino).
            let soltar = null;
            if (s.press) {
                const caja = await buscar(page, s.press).boundingBox().catch(() => null);
                if (caja) {
                    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
                    await page.mouse.down();
                    soltar = async () => { await page.mouse.up().catch(() => { }); };
                    await page.waitForTimeout(s.pressWait ?? 1200);
                } else console.log(`   (no encontré para mantener presionado "${s.press}")`);
            }

            for (const h of s.hide || []) {
                await page.evaluate((sel) => document.querySelectorAll(sel).forEach((e) => (e.style.visibility = "hidden")), h).catch(() => { });
            }
            await page.waitForTimeout(400);

            const marcas = await resolverMarcas(page, s);
            if (marcas) marks[s.file] = marcas; else delete marks[s.file];

            const raw = s.clip
                ? await page.locator(s.clip).first().screenshot({ scale: "device" })
                : await page.screenshot({ fullPage: !!s.full, scale: "device" });
            if (soltar) await soltar();
            await optimize(raw, dest);
            const kb = Math.round(fs.statSync(dest).size / 1024);
            console.log(`  ✓ ${s.file.padEnd(34)} ${kb} KB${marcas ? `  ·  ${marcas.length} marcación(es)` : ""}`);
            ok++;
        } catch (e) {
            console.log(`  ✗ ${s.file.padEnd(34)} ${String(e.message).slice(0, 90)}`);
            fail++;
        }
    }
    await browser.close();
    fs.writeFileSync(marksFile, JSON.stringify(marks, null, 2));
    console.log(`\n${ok} captura(s) generada(s)${fail ? `, ${fail} con error` : ""}. Marcaciones en docs/manual/marks.json.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
