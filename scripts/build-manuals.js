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

        // Imagen sola en su línea → figura numerada
        m = l.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
        if (m) {
            fig++;
            const [, alt, src] = m;
            const file = src.replace(/^img\//, "");
            const exists = fs.existsSync(path.join(MDIR, "img", file));
            out.push(exists
                ? `<figure><img src="img/${file}" alt="${esc(alt)}"><figcaption>Fig. ${ctx.num}.${fig} — ${inline(alt)}</figcaption></figure>`
                : `<figure class="falta"><div class="ph"><b>Falta la captura</b><code>${esc(file)}</code><span>${esc(alt)}</span></div></figure>`);
            i++; continue;
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
function page({ man, prod, body, toc, fecha }) {
    const tocHtml = toc.map((t) =>
        `<li class="l${t.lvl}"><a href="#${t.id}"><span class="t">${esc(t.txt)}</span><span class="dots"></span></a></li>`).join("");
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
.p-top{position:absolute;top:24mm;left:22mm;right:22mm}
.marca{display:flex;align-items:center;gap:12px}
.marca .ico{width:44px;height:44px;border-radius:12px;background:var(--c);display:flex;align-items:center;justify-content:center;
  box-shadow:0 8px 26px rgba(0,0,0,.4)}
.marca .n{font-size:19px;font-weight:800;letter-spacing:.16em}
.marca .s{font-size:9.5px;letter-spacing:.34em;color:#9aa4b2;margin-top:2px}
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
figure img{width:100%;border:1px solid var(--linea);border-radius:9px;box-shadow:0 2px 10px rgba(0,0,0,.09);display:block}
figcaption{font-size:11.5px;color:var(--suave);margin-top:6px;text-align:center}
figure.falta .ph{border:2px dashed #cbd5e1;border-radius:9px;padding:30px;text-align:center;background:#f8fafc;color:var(--suave)}
figure.falta code{display:block;margin:7px 0 3px;color:#b91c1c}
hr{border:0;border-top:1px solid var(--linea);margin:22px 0}

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
      <div class="ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
      <div><div class="n">OMNIACCESS</div><div class="s">CONTROL Y ACCESO</div></div>
    </div>
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
    const modo = process.env.MANUAL_MODO || "LPR";
    const prod = meta.producto.porModo[modo] || meta.producto.familia;
    const fecha = new Date().toLocaleDateString("es-UY", { year: "numeric", month: "long", day: "numeric" });

    // copiar imágenes
    const imgSrc = path.join(MDIR, "img");
    if (fs.existsSync(imgSrc)) for (const f of fs.readdirSync(imgSrc)) fs.copyFileSync(path.join(imgSrc, f), path.join(OUT, "img", f));

    const hechos = [];
    for (const man of meta.manuales.sort((a, b) => a.orden - b.orden)) {
        if (only && man.id !== only) continue;
        const src = path.join(MDIR, man.id + ".md");
        if (!fs.existsSync(src)) { console.log(`  – ${man.id}: sin ${man.id}.md, salteado`); continue; }
        const md = fs.readFileSync(src, "utf8");
        let num = 0;
        const { html, toc } = render(md, { num: ++num });
        const out = page({ man, prod, body: html, toc, fecha });
        const dest = path.join(OUT, man.id + ".html");
        fs.writeFileSync(dest, out);
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
