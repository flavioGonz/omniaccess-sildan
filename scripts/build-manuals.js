#!/usr/bin/env node
/**
 * OmniAccess · compilador de manuales.
 *
 * Markdown  →  HTML autocontenido (portada diseñada, índice navegable, estilos A4)
 *           →  PDF vía Chromium headless.
 *
 *   node scripts/build-manuals.js                 # compila todos a HTML
 *   node scripts/build-manuals.js --pdf           # además genera los PDF
 *   node scripts/build-manuals.js --only operador --pdf
 *
 * Salida: public/manuales/<id>.html  y  public/manuales/<id>.pdf
 * Las imágenes se copian a public/manuales/img/.
 *
 * Convenciones del Markdown que este compilador entiende:
 *   # Título            → capítulo (entra al índice, arranca en página nueva)
 *   ## Subtítulo        → sección (entra al índice)
 *   » Menú → Ruta       → barra "Cómo llegar" bajo el título
 *   > texto             → aviso destacado
 *   > ⏱ texto           → aviso de tiempo de respuesta
 *   ![alt](img/x.png)   → figura numerada con epígrafe
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MDIR = path.join(ROOT, "docs", "manual");
const OUT = path.join(ROOT, "public", "manuales");
const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf("--only"); return i >= 0 ? args[i + 1] : null; })();

const meta = JSON.parse(fs.readFileSync(path.join(MDIR, "00-meta.json"), "utf8"));

/* Marcaciones calculadas por el capturador: { "archivo.png": [{x,y,w,h,label}] }.
   Se usan cuando el Markdown no trae líneas @ propias. */
const MARKS = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(MDIR, "marks.json"), "utf8")); } catch { return {}; }
})();

/* Isotipo OmniAccess — anillo de cobertura con el paso abierto. */
const LOGO = (px) => `<svg width="${px}" height="${px}" viewBox="0 0 64 64" aria-label="OmniAccess">
  <defs><linearGradient id="oaG${px}" x1="6" y1="58" x2="58" y2="6" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#0ea5e9"/><stop offset=".55" stop-color="#3b82f6"/><stop offset="1" stop-color="#22d3ee"/>
  </linearGradient></defs>
  <path d="M51.7 16.6 A25 25 0 1 0 51.7 47.4" fill="none" stroke="url(#oaG${px})" stroke-width="5.4" stroke-linecap="round"/>
  <path d="M41 21.3 A14 14 0 1 0 41 42.7" fill="none" stroke="url(#oaG${px})" stroke-width="4.4" stroke-linecap="round" opacity=".78"/>
  <path d="M41.5 24 L49.8 32 L41.5 40" fill="none" stroke="url(#oaG${px})" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M53.4 27.2 L58.2 32 L53.4 36.8" fill="none" stroke="url(#oaG${px})" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/>
</svg>`;

/* ─────────────── Markdown mínimo (sin dependencias) ─────────────── */
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function inline(t) {
    return esc(t)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function render(md, ctx) {
    const lines = md.split("\n");
    const out = [];
    const toc = [];
    let i = 0, fig = 0, inCode = false, codeBuf = [];

    const flushCode = () => { out.push(`<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`); codeBuf = []; };

    while (i < lines.length) {
        const l = lines[i];

        if (l.startsWith("```")) {
            if (inCode) { flushCode(); inCode = false; } else inCode = true;
            i++; continue;
        }
        if (inCode) { codeBuf.push(l); i++; continue; }

        // Encabezados
        let m = l.match(/^(#{1,4})\s+(.*)$/);
        if (m) {
            const lvl = m[1].length, txt = m[2].trim(), id = slug(txt);
            if (lvl <= 2) toc.push({ lvl, txt, id });
            const cls = lvl === 1 ? ' class="cap"' : "";
            out.push(`<h${lvl} id="${id}"${cls}>${inline(txt)}</h${lvl}>`);
            i++; continue;
        }

        // Ruta de menú:  » Menú → Sistema → Alertas
        if (l.startsWith("» ")) {
            out.push(`<div class="ruta"><span class="ruta-l">Cómo llegar</span>${inline(l.slice(2).trim())}</div>`);
            i++; continue;
        }

        // Imagen sola en su línea → figura numerada.
        // Marcaciones (opcionales) en las líneas siguientes:
        //   @x,y,w,h  texto   → recuadro sobre el elemento (todo en % de la imagen)
        //   @x,y      texto   → chapita suelta en ese punto
        // Si no hay ninguna, se usan las que calculó el capturador en marks.json.
        m = l.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
        if (m) {
            fig++;
            const [, alt, src] = m;
            const file = src.replace(/^img\//, "");
            const exists = fs.existsSync(path.join(MDIR, "img", file));
            i++;
            let marcas = [];
            while (i < lines.length && /^\s*@\s*[\d.]+\s*,/.test(lines[i])) {
                const mm = lines[i].match(/^\s*@\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+)\s*,\s*([\d.]+))?\s+(.*)$/);
                if (mm) marcas.push({ x: +mm[1], y: +mm[2], w: mm[3] ? +mm[3] : null, h: mm[4] ? +mm[4] : null, txt: mm[5].trim() });
                i++;
            }
            if (!marcas.length && MARKS[file]) marcas = MARKS[file].map((k) => ({ ...k, txt: k.label || k.txt || "" }));
            if (!exists) {
                out.push(`<figure class="falta"><div class="ph"><b>Falta la captura</b><code>${esc(file)}</code><span>${esc(alt)}</span></div></figure>`);
                continue;
            }
            const puntos = marcas.map((k, n) => k.w != null
                ? `<span class="caja" style="left:${k.x}%;top:${k.y}%;width:${k.w}%;height:${k.h}%"><span class="mk">${n + 1}</span></span>`
                : `<span class="mk punto" style="left:${k.x}%;top:${k.y}%">${n + 1}</span>`).join("");
            const leyenda = marcas.length && marcas.some((k) => k.txt)
                ? `<ol class="leyenda">${marcas.map((k) => `<li>${inline(k.txt)}</li>`).join("")}</ol>` : "";
            out.push(`<figure><div class="lienzo"><img src="img/${file}" alt="${esc(alt)}">${puntos}</div>` +
                `<figcaption>Fig. ${ctx.num}.${fig} — ${inline(alt)}</figcaption>${leyenda}</figure>`);
            continue;
        }

        // Cita / aviso
        if (l.startsWith("> ")) {
            const buf = [];
            while (i < lines.length && lines[i].startsWith(">")) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
            const txt = buf.join(" ").trim();
            const tipo = /^⏱/.test(txt) ? "tiempo" : /^⚠|^Cuidado|^Ojo/i.test(txt) ? "alerta" : "nota";
            out.push(`<blockquote class="${tipo}">${inline(txt.replace(/^[⏱⚠]\s*/, ""))}</blockquote>`);
            continue;
        }

        // Tabla
        if (l.includes("|") && (lines[i + 1] || "").match(/^\s*\|?[\s:|-]+\|/)) {
            const head = l.split("|").filter((x) => x.trim() !== "");
            i += 2;
            const rows = [];
            while (i < lines.length && lines[i].includes("|")) { rows.push(lines[i].split("|").filter((x, k, a) => !(k === 0 && !x.trim()) && !(k === a.length - 1 && !x.trim()))); i++; }
            out.push(`<table><thead><tr>${head.map((h) => `<th>${inline(h.trim())}</th>`).join("")}</tr></thead><tbody>` +
                rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c.trim())}</td>`).join("")}</tr>`).join("") + "</tbody></table>");
            continue;
        }

        // Listas (las líneas indentadas que siguen a un ítem lo continúan)
        if (/^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)) {
            const ord = /^\s*\d+\./.test(l);
            const items = [];
            while (i < lines.length) {
                const cur = lines[i];
                if (/^\s*[-*]\s+/.test(cur) || /^\s*\d+\.\s+/.test(cur)) {
                    items.push(cur.replace(/^\s*(?:[-*]|\d+\.)\s+/, "")); i++;
                } else if (items.length && /^\s{2,}\S/.test(cur)) {
                    items[items.length - 1] += " " + cur.trim(); i++;   // continuación del ítem
                } else break;
            }
            out.push(`<${ord ? "ol" : "ul"}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${ord ? "ol" : "ul"}>`);
            continue;
        }

        if (l.trim() === "---") { out.push("<hr>"); i++; continue; }
        if (l.trim() === "") { i++; continue; }

        // Párrafo
        const buf = [];
        while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4}\s|»\s|>\s|```|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) && !lines[i].includes("|")) {
            buf.push(lines[i]); i++;
        }
        if (buf.length) out.push(`<p>${inline(buf.join(" "))}</p>`);
        else i++;
    }
    if (inCode) flushCode();
    return { html: out.join("\n"), toc };
}

/* ─────────────── Plantilla ─────────────── */
function page({ man, prod, body, toc, fecha, pags }) {
    const tocHtml = toc.map((t) =>
        `<li class="l${t.lvl}"><a href="#${t.id}"><span class="t">${esc(t.txt)}</span><span class="dots"></span>` +
        `<span class="pg">${pags && pags[t.id] ? pags[t.id] : ""}</span></a></li>`).join("");
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${prod} · ${man.titulo}</title>
<style>
:root{--c:${man.color};--tinta:#111827;--suave:#6b7280;--linea:#e5e7eb;--fondo:#fff;--code:#f3f4f6}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#525659;font:15px/1.65 "Segoe UI",system-ui,-apple-system,sans-serif;color:var(--tinta)}
.hoja{background:var(--fondo);width:210mm;min-height:297mm;margin:14px auto;padding:22mm 20mm 20mm;box-shadow:0 4px 24px rgba(0,0,0,.35)}

/* ── PORTADA ── (posicionamiento absoluto: se imprime igual siempre) */
.portada{position:relative;width:210mm;height:296.9mm;padding:0;overflow:hidden;color:#fff;
  background:linear-gradient(150deg,#0b1220 0%,#111a2e 45%,var(--c) 190%)}
.portada .malla{position:absolute;inset:0;opacity:.5;
  background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);
  background-size:26px 26px}
.portada .halo{position:absolute;width:640px;height:640px;right:-220px;top:-180px;border-radius:50%;
  background:radial-gradient(circle,var(--c) 0%,transparent 62%);opacity:.30}
.portada .halo2{position:absolute;width:420px;height:420px;left:-160px;bottom:-140px;border-radius:50%;
  background:radial-gradient(circle,var(--c) 0%,transparent 65%);opacity:.18}
.p-top{position:absolute;top:24mm;left:22mm;right:22mm;display:flex;align-items:center;justify-content:space-between}
.marca{display:flex;align-items:center;gap:13px}
.marca svg{filter:drop-shadow(0 6px 18px rgba(14,165,233,.45))}
.marca .n{font-size:21px;font-weight:800;letter-spacing:.15em;line-height:1}
.marca .n .thin{font-weight:300}
.marca .s{font-size:9px;letter-spacing:.32em;color:#8fa0b6;margin-top:6px}
.linea-prod{font-size:9.5px;font-weight:800;letter-spacing:.22em;color:#cbd5e1;
  border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:6px 13px;white-space:nowrap}
.p-mid{position:absolute;left:22mm;right:22mm;bottom:62mm}
.kicker{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.26em;color:var(--c);
  border:1px solid var(--c);border-radius:999px;padding:5px 13px;margin-bottom:20px}
.p-mid h1{font-size:53px;line-height:1.03;margin:0 0 8px;font-weight:800;letter-spacing:-.02em}
.p-mid h2{font-size:21px;margin:0 0 22px;font-weight:500;color:#c7d2de}
.p-mid .para{max-width:118mm;color:#9aa4b2;font-size:13.5px;line-height:1.6;border-left:3px solid var(--c);padding-left:14px}
.p-bot{position:absolute;left:22mm;right:22mm;bottom:24mm;display:flex;justify-content:space-between;align-items:flex-end;
  padding-top:14px;border-top:1px solid rgba(255,255,255,.12)}
.p-bot .campo{font-size:11px;color:#8b95a5}
.p-bot .campo b{display:block;color:#e5e7eb;font-size:13.5px;font-weight:600;margin-top:3px}
.p-bot .der{text-align:right}

/* ── ÍNDICE ── */
.indice h2{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}
.indice .sub{color:var(--suave);font-size:12.5px;margin-bottom:22px}
.indice ol{list-style:none;padding:0;margin:0;counter-reset:cap}
.indice li{margin:0}
.indice li a{display:flex;align-items:baseline;gap:8px;text-decoration:none;color:var(--tinta);padding:5px 0}
.indice .dots{flex:1;border-bottom:1px dotted #cbd5e1;transform:translateY(-3px)}
.indice .pg{font-variant-numeric:tabular-nums;color:var(--suave);font-size:12.5px;min-width:20px;text-align:right}
.indice .l1 .pg{color:var(--tinta);font-weight:700}
.indice .l1{counter-increment:cap;font-weight:700;margin-top:13px;border-top:1px solid var(--linea);padding-top:8px}
.indice .l1 .t::before{content:counter(cap) ". ";color:var(--c)}
.indice .l2{padding-left:18px;font-size:13.5px;color:#374151}

/* ── CUERPO ── */
h1.cap{font-size:30px;margin:0 0 16px;padding-bottom:11px;border-bottom:3px solid var(--c);letter-spacing:-.015em;
  page-break-before:always;break-before:page}
.hoja > h1.cap:first-child{page-break-before:auto;break-before:auto}
h2{font-size:20.5px;margin:30px 0 10px;color:#0f172a}
h3{font-size:16px;margin:22px 0 7px;color:#1f2937}
h4{font-size:14px;margin:16px 0 5px;color:#374151}
p{margin:0 0 11px}
ul,ol{margin:0 0 12px;padding-left:22px}
li{margin:4px 0}
code{background:var(--code);padding:1.5px 5px;border-radius:4px;font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#0f172a}
pre{background:#0f172a;color:#e2e8f0;padding:13px 15px;border-radius:9px;overflow:auto;margin:0 0 13px}
pre code{background:none;color:inherit;font-size:12px}
table{width:100%;border-collapse:collapse;margin:0 0 15px;font-size:13.5px}
th{background:#f8fafc;text-align:left;padding:8px 10px;border-bottom:2px solid var(--c);font-weight:700}
td{padding:7px 10px;border-bottom:1px solid var(--linea);vertical-align:top}
tr:nth-child(even) td{background:#fcfcfd}
.ruta{display:flex;align-items:center;gap:10px;background:#f8fafc;border-left:3px solid var(--c);
  padding:8px 13px;border-radius:0 7px 7px 0;font-size:13px;margin:0 0 15px}
.ruta-l{font-size:9px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--c);white-space:nowrap}
blockquote{margin:0 0 14px;padding:11px 15px;border-radius:8px;font-size:13.5px;border-left:4px solid}
blockquote.nota{background:#f8fafc;border-color:#94a3b8}
blockquote.alerta{background:#fffbeb;border-color:#f59e0b}
blockquote.tiempo{background:#f0fdf4;border-color:#10b981}
blockquote.tiempo::before{content:"⏱ Tiempo de respuesta — ";font-weight:700;color:#047857}
blockquote.alerta::before{content:"⚠ ";font-weight:700}
figure{margin:16px 0 18px;page-break-inside:avoid;break-inside:avoid}
.lienzo{position:relative;line-height:0}
figure img{width:100%;border:1px solid var(--linea);border-radius:9px;box-shadow:0 2px 10px rgba(0,0,0,.09);display:block}
figcaption{font-size:11.5px;color:var(--suave);margin-top:6px;text-align:center}
figure.falta .ph{border:2px dashed #cbd5e1;border-radius:9px;padding:30px;text-align:center;background:#f8fafc;color:var(--suave)}
figure.falta code{display:block;margin:7px 0 3px;color:#b91c1c}
/* ── marcaciones sobre la captura ──
   .caja  = recuadro sobre el elemento real (no lo tapa)
   .mk    = chapita numerada, pegada al borde del recuadro          */
.caja{position:absolute;border:2.4px solid var(--c);border-radius:7px;z-index:2;
  box-shadow:0 0 0 2px rgba(255,255,255,.9),0 2px 9px rgba(0,0,0,.28)}
.mk{position:absolute;min-width:21px;height:21px;border-radius:11px;padding:0 6px;
  background:var(--c);color:#fff;font:800 12px/21px "Segoe UI",sans-serif;text-align:center;
  box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.4);z-index:3;white-space:nowrap}
.caja>.mk{left:-9px;top:-11px}
.punto{position:absolute;transform:translate(-50%,-50%);z-index:3}
.leyenda{list-style:none;counter-reset:mk;padding:0;margin:9px 0 0;font-size:12.5px;
  display:grid;grid-template-columns:1fr 1fr;gap:3px 18px}
.leyenda li{counter-increment:mk;position:relative;padding-left:26px;margin:0;line-height:1.45}
.leyenda li::before{content:counter(mk);position:absolute;left:0;top:1px;width:18px;height:18px;border-radius:50%;
  background:var(--c);color:#fff;font:800 10.5px/18px "Segoe UI",sans-serif;text-align:center}
hr{border:0;border-top:1px solid var(--linea);margin:22px 0}

/* ── Cortes de página: que no se parta lo que se lee junto ── */
h1,h2,h3,h4{break-after:avoid;page-break-after:avoid}
h2,h3,h4{break-inside:avoid;page-break-inside:avoid}
p,li{orphans:3;widows:3}
table,blockquote,.ruta,pre{break-inside:avoid;page-break-inside:avoid}
ul,ol{break-inside:auto}
/* un título nunca queda solo al pie: arrastra lo que sigue */
h2+p,h2+ul,h2+ol,h2+table,h2+figure,h2+blockquote,h2+.ruta,
h3+p,h3+ul,h3+ol,h3+table,h3+figure,h3+blockquote{break-before:avoid;page-break-before:avoid}

/* pie de página impreso */
@page{size:A4;margin:16mm 15mm 17mm}
@media print{
  html,body{margin:0;padding:0;background:#fff}
  .hoja{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
  .portada{width:210mm;height:296.9mm;page-break-after:always;border-radius:0}
  .indice{page-break-after:always}
  .noprint{display:none}
}
/* La portada se imprime a sangre completa: se genera en un pase aparte, con
   márgenes de página en cero (ver build). */
body.solo-portada .hoja:not(.portada){display:none}
body.sin-portada .portada{display:none}
.noprint{position:fixed;right:16px;bottom:16px;z-index:9}
.noprint button{background:var(--c);color:#fff;border:0;border-radius:9px;padding:11px 17px;font-weight:700;cursor:pointer;
  box-shadow:0 5px 18px rgba(0,0,0,.3)}
</style></head><body>

<section class="hoja portada">
  <div class="malla"></div><div class="halo"></div><div class="halo2"></div>
  <div class="p-top">
    <div class="marca">
      ${LOGO(46)}
      <div><div class="n"><span class="thin">OMNI</span>ACCESS</div><div class="s">CONTROL Y ACCESO</div></div>
    </div>
    <div class="linea-prod">${esc(prod.toUpperCase())}</div>
  </div>
  <div class="p-mid">
    <span class="kicker">${esc(man.subtitulo.toUpperCase())}</span>
    <h1>${esc(man.titulo)}</h1>
    <h2>${esc(prod)}</h2>
    <p class="para">${esc(man.para)}</p>
  </div>
  <div class="p-bot">
    <div class="campo">Versión<b>${esc(meta.producto.version)}</b></div>
    <div class="campo">Emitido<b>${fecha}</b></div>
    <div class="campo der">${esc(meta.producto.empresa)}<b>${esc(meta.producto.web)}</b></div>
  </div>
</section>

<section class="hoja indice">
  <h2>Contenido</h2>
  <div class="sub">${esc(prod)} · ${esc(man.titulo)}</div>
  <ol>${tocHtml}</ol>
</section>

<section class="hoja">
${body}
</section>

<div class="noprint"><button onclick="window.print()">Descargar PDF</button></div>
</body></html>`;
}

/* ─────────────── Main ─────────────── */
async function main() {
    fs.mkdirSync(path.join(OUT, "img"), { recursive: true });
    const fecha = new Date().toLocaleDateString("es-UY", { year: "numeric", month: "long", day: "numeric" });
    // Cada manual declara su modo en 00-meta.json; los transversales no llevan modo.
    const nombreProd = (man) => (man.modo && meta.producto.porModo[man.modo]) || meta.producto.familia;

    // copiar imágenes
    const imgSrc = path.join(MDIR, "img");
    if (fs.existsSync(imgSrc)) for (const f of fs.readdirSync(imgSrc)) fs.copyFileSync(path.join(imgSrc, f), path.join(OUT, "img", f));

    const hechos = [];
    for (const man of meta.manuales.sort((a, b) => a.orden - b.orden)) {
        if (only && man.id !== only) continue;
        const src = path.join(MDIR, man.id + ".md");
        if (!fs.existsSync(src)) { console.log(`  – ${man.id}: sin ${man.id}.md, salteado`); continue; }
        const md = fs.readFileSync(src, "utf8");
        const prod = nombreProd(man);
        let num = 0;
        const { html, toc } = render(md, { num: ++num });
        // los números de página del índice se completan en el 2º pase (ver pdf)
        const out = page({ man, prod, body: html, toc, fecha, pags: null });
        const dest = path.join(OUT, man.id + ".html");
        fs.writeFileSync(dest, out);
        man._render = { html, toc, md, prod };
        const faltan = (md.match(/!\[[^\]]*\]\(img\/([^)]+)\)/g) || [])
            .map((x) => x.match(/\(img\/([^)]+)\)/)[1])
            .filter((f) => !fs.existsSync(path.join(imgSrc, f)));
        console.log(`  ✓ ${man.id.padEnd(14)} ${toc.length} entradas de índice${faltan.length ? `, faltan ${faltan.length} captura(s)` : ""}`);
        hechos.push({ man, dest });
    }

    if (args.includes("--pdf")) {
        const { chromium } = require("playwright");
        const { PDFDocument } = require("pdf-lib");
        const b = await chromium.launch();
        const p = await (await b.newContext({ colorScheme: "light" })).newPage();
        for (const { man, dest } of hechos) {
            const prod = man._render.prod;
            await p.goto("file://" + dest, { waitUntil: "networkidle" });

            // ── PASE 1: medir en qué página cae cada título, para numerar el índice ──
            // Se imprime el cuerpo sin índice y se mide la posición de cada ancla contra
            // la altura útil de la hoja, respetando los saltos forzados de capítulo.
            await p.evaluate(() => { document.body.className = "sin-portada medir"; });
            await p.emulateMedia({ media: "print" });
            const pags = await p.evaluate(() => {
                const MM = 96 / 25.4;                       // px por mm a 96 dpi
                const util = (297 - 16 - 17) * MM;          // alto imprimible
                const ids = [...document.querySelectorAll("h1.cap,h2[id]")];
                const idx = document.querySelector(".indice");
                const idxAlto = idx ? idx.getBoundingClientRect().height : 0;
                const idxPags = Math.max(1, Math.ceil(idxAlto / util));
                const base = 1 + idxPags;                   // portada + páginas del índice
                const out = {}; let pagCap = base; let capTop = 0; let primero = true;
                for (const el of ids) {
                    const top = el.getBoundingClientRect().top + window.scrollY;
                    if (el.tagName === "H1") {              // cada capítulo abre página
                        if (!primero) pagCap = pagCap + Math.max(1, Math.ceil((top - capTop) / util));
                        primero = false; capTop = top;
                        out[el.id] = pagCap;
                    } else {
                        out[el.id] = pagCap + Math.floor((top - capTop) / util);
                    }
                }
                return out;
            });
            await p.emulateMedia({ media: null });   // null = vuelve al default (print al generar el PDF)

            // se regenera el HTML con el índice numerado y se recarga
            fs.writeFileSync(dest, page({ man, prod, body: man._render.html, toc: man._render.toc, fecha, pags }));
            await p.goto("file://" + dest, { waitUntil: "networkidle" });

            // 1) portada a sangre: hay que anular el @page del CSS, que le gana al margin de Playwright
            await p.evaluate(() => {
                document.body.className = "solo-portada";
                const s = document.createElement("style");
                s.id = "sangre"; s.textContent = "@page{size:A4;margin:0}";
                document.head.appendChild(s);
            });
            const portada = await p.pdf({ format: "A4", printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });

            // 2) cuerpo: con márgenes, numeración y pie
            await p.evaluate(() => {
                document.body.className = "sin-portada";
                document.getElementById("sangre")?.remove();
            });
            const cuerpo = await p.pdf({
                format: "A4", printBackground: true,
                margin: { top: "16mm", bottom: "17mm", left: "15mm", right: "15mm" },
                displayHeaderFooter: true,
                headerTemplate: `<div></div>`,
                footerTemplate: `<div style="width:100%;font-size:8px;color:#94a3b8;padding:0 15mm;display:flex;justify-content:space-between;font-family:Segoe UI,sans-serif">
                   <span>${prod} · ${man.titulo}</span><span class="pageNumber"></span></div>`,
            });

            const doc = await PDFDocument.create();
            for (const src of [portada, cuerpo]) {
                const s = await PDFDocument.load(src);
                const pgs = await doc.copyPages(s, s.getPageIndices());
                pgs.forEach((x) => doc.addPage(x));
            }
            doc.setTitle(`${prod} · ${man.titulo}`);
            doc.setAuthor(meta.producto.empresa);
            doc.setSubject(man.para);
            doc.setCreator("OmniAccess");
            const pdf = path.join(OUT, man.id + ".pdf");
            fs.writeFileSync(pdf, await doc.save());
            console.log(`  ⤓ ${path.basename(pdf)}  ${Math.round(fs.statSync(pdf).size / 1024)} KB`);
        }
        await b.close();
    }
    console.log(`\nSalida: public/manuales/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
