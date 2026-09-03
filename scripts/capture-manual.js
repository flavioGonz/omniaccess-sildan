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
 *     "full": true }                 página completa con scroll
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
                const loc = c.startsWith(".") || c.startsWith("#") || c.startsWith("[")
                    ? page.locator(c).first()
                    : page.getByText(c, { exact: false }).first();
                await loc.click({ timeout: 8000 }).catch(() => console.log(`   (no pude clickear "${c}")`));
                await page.waitForTimeout(s.clickWait ?? 1400);
            }
            for (const h of s.hide || []) {
                await page.evaluate((sel) => document.querySelectorAll(sel).forEach((e) => (e.style.visibility = "hidden")), h).catch(() => { });
            }
            await page.waitForTimeout(400);

            const raw = s.clip
                ? await page.locator(s.clip).first().screenshot({ scale: "device" })
                : await page.screenshot({ fullPage: !!s.full, scale: "device" });
            await optimize(raw, dest);
            const kb = Math.round(fs.statSync(dest).size / 1024);
            console.log(`  ✓ ${s.file.padEnd(34)} ${kb} KB`);
            ok++;
        } catch (e) {
            console.log(`  ✗ ${s.file.padEnd(34)} ${String(e.message).slice(0, 90)}`);
            fail++;
        }
    }
    await browser.close();
    console.log(`\n${ok} captura(s) generada(s)${fail ? `, ${fail} con error` : ""}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
