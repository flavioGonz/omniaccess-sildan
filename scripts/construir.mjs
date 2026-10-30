/**
 * Arma el sitio en dist/:
 *  - index.html + estilos.css + sitio.js: para subir a cualquier hosting.
 *  - omniaccess-un-archivo.html: todo en un archivo, se abre con doble clic (sin servidor).
 *  - artifact.html: el contenido sin <html>/<head>, para publicarlo en claude.ai.
 *
 * El texto sale de src/contenido.js y los íconos de lucide-static: el HTML ya viene escrito,
 * sin esperar a JavaScript. `--mirar` recompila al guardar y sirve dist/ en http://localhost:8080.
 */
import { build, context } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => join(raiz, "src", f);
const dist = (f) => join(raiz, "dist", f);
mkdirSync(join(raiz, "dist"), { recursive: true });

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const icono = (n) => {
    const f = join(raiz, "node_modules", "lucide-static", "icons", `${n}.svg`);
    if (!existsSync(f)) throw new Error(`No existe el ícono «${n}» en lucide-static`);
    return readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/, "").replace(/\s(width|height)="24"/g, "")
        .replace("<svg", '<svg aria-hidden="true" focusable="false"').replace(/\n\s*/g, " ").trim();
};

async function armar() {
    // Se importa de nuevo en cada vuelta para que --mirar tome los cambios de texto.
    const C = await import(`${src("contenido.js")}?v=${Date.now()}`);
    const esIA = (o) => /OmniVision/.test(o);

    const escenas = C.ESCENAS.map((e) => `
    <div class="escena" data-momento="${e.momento}">
      <div class="escena-texto">
        <div class="escena-hora">${esc(e.hora)}</div>
        <h2>${esc(e.titulo)}</h2>
        <p>${esc(e.texto)}</p>
      </div>
    </div>`).join("");

    const cuenta = (g) => C.DETECCIONES.filter((d) => d.g === g).length;
    const filtros = [`<button class="filtro" type="button" data-g="todos" aria-pressed="true">Todas <small>${C.DETECCIONES.length}</small></button>`,
        ...C.GRUPOS.map((g) => `<button class="filtro" type="button" data-g="${g.id}" aria-pressed="false">${esc(g.nombre)} <small>${cuenta(g.id)}</small></button>`)].join("");

    const grupos = C.GRUPOS.map((g) => `
      <section class="grupo" data-g="${g.id}" aria-labelledby="g-${g.id}">
        <div class="grupo-titulo"><h3 id="g-${g.id}">${esc(g.nombre)}</h3><p>${esc(g.bajada)}</p></div>
        <ul class="items">${C.DETECCIONES.filter((d) => d.g === g.id).map((d) => `
          <li class="item">
            <span class="item-icono">${icono(d.i)}</span>
            <div><h4>${esc(d.n)}</h4><span class="origen${esIA(d.o) ? " ia" : ""}">${esc(d.o)}</span><p>${esc(d.d)}</p></div>
          </li>`).join("")}
        </ul>
      </section>`).join("");

    const modulos = C.MODULOS.map((m) => `<li>${icono(m.i)}<div><h3>${esc(m.n)}</h3><p>${esc(m.d)}</p></div></li>`).join("");
    const descargas = C.DESCARGAS.map((d) => `<li><a href="descargas/${esc(d.a)}" download><span>${esc(d.n)}</span>${icono("download")}</a></li>`).join("");

    // Contacto: sólo los botones que tienen dato. No se inventan teléfonos ni correos.
    const K = C.CONTACTO, botones = [];
    if (K.whatsapp) botones.push(`<a class="boton" href="https://wa.me/${esc(K.whatsapp.replace(/\D/g, ""))}">${icono("message-circle")} Escribinos por WhatsApp</a>`);
    if (K.email) botones.push(`<a class="boton${botones.length ? " boton-claro" : ""}" href="mailto:${esc(K.email)}?subject=${encodeURIComponent("Demo de OmniAccess")}">${icono("mail")} ${esc(K.email)}</a>`);
    if (K.telefono) botones.push(`<a class="boton boton-claro" href="tel:${esc(K.telefono.replace(/\s/g, ""))}">${icono("phone")} ${esc(K.telefono)}</a>`);
    if (K.web) botones.push(`<a class="boton boton-claro" href="${esc(K.web)}">${icono("globe")} ${esc(K.web.replace(/^https?:\/\//, ""))}</a>`);
    const contacto = botones.length ? botones.join("") : `<p class="sin-datos">Pedile la demo a tu contacto de ${esc(K.empresa)}.</p>`;

    let html = readFileSync(src("index.html"), "utf8")
        .replace("<!--ESCENAS-->", escenas).replace("<!--CANTIDAD-->", String(C.DETECCIONES.length))
        .replace("<!--FILTROS-->", filtros).replace("<!--GRUPOS-->", grupos).replace("<!--MODULOS-->", modulos)
        .replace("<!--DESCARGAS-->", descargas).replace("<!--CONTACTO-->", contacto)
        .replace(/<!--ICONO:([a-z0-9-]+)-->/g, (_, n) => icono(n));

    const r = await build({ entryPoints: [src("sitio.js")], bundle: true, minify: true, format: "iife", target: "es2020", write: false, legalComments: "eof" });
    const js = r.outputFiles[0].text;
    const css = readFileSync(src("estilos.css"), "utf8");

    writeFileSync(dist("estilos.css"), css);
    writeFileSync(dist("sitio.js"), js);
    writeFileSync(dist("index.html"), html.replace("<!--ESTILOS-->", '<link rel="stylesheet" href="estilos.css">').replace("<!--SCRIPT-->", '<script src="sitio.js" defer></script>'));

    const enLinea = js.replace(/<\/script/gi, "<\\/script");
    const unArchivo = html.replace("<!--ESTILOS-->", `<style>\n${css}\n</style>`).replace("<!--SCRIPT-->", `<script>\n${enLinea}\n</script>`);
    writeFileSync(dist("omniaccess-un-archivo.html"), unArchivo);

    // Para claude.ai: sin doctype/html/head/body (la plataforma pone el esqueleto).
    const titulo = (html.match(/<title>[\s\S]*?<\/title>/) || [""])[0];
    const fuentes = (html.match(/<link href="https:\/\/fonts.googleapis.com[^>]*>/) || [""])[0];
    const cuerpo = unArchivo.slice(unArchivo.indexOf("<body>") + 6, unArchivo.lastIndexOf("</body>"));
    writeFileSync(dist("artifact.html"), `${titulo}\n${fuentes}\n<style>\n${css}\n</style>\n${cuerpo}`);

    // Las descargas (PDF) no van en git: se copian si están en ./descargas.
    if (existsSync(join(raiz, "descargas"))) cpSync(join(raiz, "descargas"), dist("descargas"), { recursive: true });
    console.log(`listo: ${C.DETECCIONES.length} detecciones, sitio.js ${(js.length / 1024).toFixed(0)} KB`);
}

await armar();
if (process.argv.includes("--mirar")) {
    const { watch } = await import("node:fs");
    watch(join(raiz, "src"), { recursive: true }, () => armar().catch((e) => console.error(e.message)));
    const ctx = await context({ entryPoints: [] });
    await ctx.serve({ servedir: join(raiz, "dist"), port: 8080 });
    console.log("mirando src/ · http://localhost:8080");
}
