import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import sharp from "sharp";
import os from "os";
import { ARCHIVO_MARCA_AGUA, MARCA_AGUA_ANCHO, MARCA_AGUA_MARGEN, marcaEnEsquina } from "@/lib/clips";
import { ZONA } from "@/lib/fechas";

/**
 * El clip «editado» con la marca de OmniAccess: lo que sale a mano desde Exportar clip, desde
 * «Grabar» en el vivo, por WhatsApp o Telegram (20/10, Nico: «siempre con nuestro branding de
 * OmniAccess para intros y marcas de agua»).
 *
 * Cómo es desde el 14/11 (Nico: «el clip exportado debe tener el nuevo branding y logo… el logo
 * arriba a la derecha… mejorá las animaciones de entrada y salida entre escenas, rápidas pero
 * premium… la intro del inicio, negro de fondo, animada mejor»). Antes era una placa quieta sobre
 * azul oscuro que aparecía y se iba con un fundido, el logo VIEJO abajo a la derecha, y las
 * cámaras de una recorrida pegadas con corte seco.
 *
 *   APERTURA (2,6 s, negro puro)
 *     0,00  el logo llega enfocándose: una copia desenfocada y más grande se achica y se apaga
 *           mientras la nítida entra detrás (un foco que traba, no un fundido)
 *     0,50  el punto de la lente se enciende: un destello con su raya horizontal, y se va
 *     0,60  la línea del color del punto se abre desde el centro
 *     0,75  el título sube y aparece; después, la fecha y lo demás
 *     1,95  el texto se va; a los 2,15 la cámara entra desde adentro de la placa (zoom, 0,45 s)
 *   ESCENAS  el logo vigente arriba a la derecha; en una recorrida, el nombre de cada cámara
 *            entra y sale abajo a la izquierda (el pase entre cámaras lo hace quien las une:
 *            lib/clip-instante)
 *   CIERRE (1,1 s)  la imagen se va a negro y queda el logo un instante
 *
 * Todo lo dibuja ffmpeg en una sola pasada (la misma que ya recodificaba el clip): las capas son
 * PNG que arma sharp y se animan con expresiones; el texto es drawtext con Outfit (assets/fonts),
 * la letra del panel. Sin dependencias nuevas.
 *
 * El bot de Telegram (telegram-bot.js) tiene su propia intro, más simple: es JS suelto y no puede
 * importar esto. Comparte el logo y su lugar en el video.
 *
 * Lo que NO lleva intro ni logo, a propósito: la descarga (es evidencia: el cuadro tiene que ser el
 * del grabador, sin nada encima) y el clip de una alerta (sale apurado, y su logo sigue su ajuste).
 * Se gobierna con el mismo interruptor que el logo (Ajustes → Video del evento): apagado, el clip
 * sale como lo cortó el grabador.
 */

export const ARCHIVO_LOGO_BLANCO = "logo-omniaccess-white.png";
/** El color del punto de la lente en el logo: el único color de la marca, y el de todo acento acá. */
const COLOR_PUNTO = "#8A6CFF";
const GRIS_TEXTO = "0x9aa4b2";
/**
 * Dónde está el punto dentro del logo ya recortado (fracción de su ancho y de su alto). Medido en
 * logo-omniaccess-white.png: el punto en (158, 255) y el dibujo de (54, 151) a (980, 359). Si se
 * cambia el logo, el destello queda corrido: hay que medir de nuevo.
 */
const PUNTO_EN_LOGO = { x: 0.1122, y: 0.4976 };
/** La apertura, el pase a la cámara, y el cierre con su pase. */
export const INTRO_SEG = 2.6;
const PASE_INTRO_SEG = 0.45;
/**
 * El texto y la línea se van un momento antes del pase: el pase agranda la placa, y con ellos
 * todavía ahí la línea se volvía una franja de color de lado a lado (visto en la primera prueba).
 * Queda el logo, que es lo que se atraviesa.
 */
const SALIDA_TEXTO_SEG = 0.2;
const CIERRE_SEG = 1.1;
const PASE_CIERRE_SEG = 0.4;
/** Cuánto queda el nombre de una cámara en una recorrida, y cuánto tarda en entrar y en irse. */
const ROTULO_ESCENA_SEG = 2.6, ROTULO_PASO_SEG = 0.3;
const FPS = 25;
/** Lo más alto que sale: se mira en un teléfono, y 1080 pesaría el doble sin verse mejor. */
const ALTURA_MAX = 720;
/** Tope de la pasada de edición. 60 s de 720p en veryfast tardan ~10 s en el CT; si se pasa, va sin editar. */
const EDICION_TOPE_MS = 60_000;
const DIR_FUENTES = path.join(/* turbopackIgnore: true */ process.cwd(), "assets", "fonts");
/** Outfit, la letra del panel (assets/fonts, OFL). Si falta el archivo, la del sistema: sale, menos linda. */
const fuente = (peso: 400 | 600 | 800) => {
    const f = path.join(DIR_FUENTES, `Outfit-${peso}.ttf`);
    return fs.existsSync(f) ? f : "/usr/share/fonts/truetype/dejavu/DejaVuSans" + (peso >= 600 ? "-Bold" : "") + ".ttf";
};

const publico = (f: string) => path.join(/* turbopackIgnore: true */ process.cwd(), "public", f);
const hay = (f: string) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const par = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function correr(cmd: string, args: string[], ms: number): Promise<string> {
    return new Promise((ok, mal) => execFile(cmd, args, { timeout: ms, maxBuffer: 4 * 1024 * 1024 }, (e, so, se) => (e ? mal(new Error(String(se || e.message).slice(-300))) : ok(String(so)))));
}

/** «lunes 20 de octubre · 13:05:12», en la hora del barrio. */
export function cuandoLargo(d: Date): string {
    const dia = d.toLocaleDateString("es-UY", { timeZone: ZONA, weekday: "long", day: "numeric", month: "long" });
    const h = d.toLocaleTimeString("es-UY", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    return `${dia} · ${h}`;
}

export type ClipEditado = { ok: true; ancho: number; alto: number; segundos: number } | { ok: false; motivo: string };

/** Ancho, alto y duración de un MP4 (ffprobe). */
export async function medidasDe(archivo: string): Promise<{ ancho: number; alto: number; segundos: number }> {
    const s = (await correr("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", archivo], 15_000));
    const j = JSON.parse(s || "{}");
    return { ancho: Number(j?.streams?.[0]?.width) || 0, alto: Number(j?.streams?.[0]?.height) || 0, segundos: Number(j?.format?.duration) || 0 };
}

/** Avance de 0 a 1 entre `desde` y `desde + dura` (para las expresiones de ffmpeg; las comas van escapadas). */
const avance = (desde: number, dura: number) => `min(1\\,max(0\\,(t-${desde})/${dura}))`;
/** Lo mismo, frenando al llegar (cúbica): lo que entra rápido y se asienta, sin rebote. */
const frenando = (desde: number, dura: number) => `(1-pow(1-${avance(desde, dura)}\\,3))`;

/** Las capas de la apertura, como PNG en `dir`. Devuelve sus rutas y medidas, o null si falta el logo. */
async function capasDeApertura(dir: string, ancho: number, alto: number) {
    const archivo = publico(ARCHIVO_LOGO_BLANCO);
    if (!hay(archivo)) return null;
    // El PNG tiene aire alrededor: se recorta antes de escalar, si no el logo queda chico y corrido.
    const logoW = par(ancho * 0.40);
    const logo = await sharp(archivo).trim().resize({ width: logoW }).png().toBuffer();
    const logoH = (await sharp(logo).metadata()).height || 0;
    const aire = par(ancho * 0.05);
    const borroso = await sharp(logo).extend({ top: aire, bottom: aire, left: aire, right: aire, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(Math.max(4, ancho * 0.011)).png().toBuffer();
    // El halo: una luz del color del punto, muy tenue, detrás del logo. El negro sigue siendo negro.
    const haloL = par(alto * 1.5);
    const halo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${haloL}" height="${haloL}"><defs><radialGradient id="g"><stop offset="0" stop-color="${COLOR_PUNTO}" stop-opacity=".15"/><stop offset=".5" stop-color="${COLOR_PUNTO}" stop-opacity=".035"/><stop offset="1" stop-color="${COLOR_PUNTO}" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
    // El destello del punto: un núcleo claro y una raya horizontal fina, como el de una lente.
    const dW = par(alto * 1.1), dH = par(alto * 0.36);
    const destello = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${dW}" height="${dH}"><defs>` +
        `<radialGradient id="n"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".18" stop-color="${COLOR_PUNTO}" stop-opacity=".75"/><stop offset=".55" stop-color="${COLOR_PUNTO}" stop-opacity=".14"/><stop offset="1" stop-color="${COLOR_PUNTO}" stop-opacity="0"/></radialGradient>` +
        `<radialGradient id="r"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".3" stop-color="${COLOR_PUNTO}" stop-opacity=".5"/><stop offset="1" stop-color="${COLOR_PUNTO}" stop-opacity="0"/></radialGradient></defs>` +
        `<ellipse cx="${dW / 2}" cy="${dH / 2}" rx="${dH / 2}" ry="${dH / 2}" fill="url(#n)"/><ellipse cx="${dW / 2}" cy="${dH / 2}" rx="${dW / 2}" ry="${Math.max(1.5, dH * 0.022)}" fill="url(#r)"/></svg>`);
    // El del cierre: el mismo logo, más chico.
    const cierreW = par(ancho * 0.26);
    const f = (n: string) => path.join(dir, n);
    await Promise.all([
        fs.promises.writeFile(f("logo.png"), logo), fs.promises.writeFile(f("borroso.png"), borroso),
        sharp(halo).png().toFile(f("halo.png")), sharp(destello).png().toFile(f("destello.png")),
        sharp(logo).resize({ width: cierreW }).png().toFile(f("cierre.png")),
    ]);
    return { logo: f("logo.png"), borroso: f("borroso.png"), halo: f("halo.png"), destello: f("destello.png"), cierre: f("cierre.png"), logoW, logoH };
}

/**
 * Un texto listo para drawtext: en un renglón, y sólo con letras que la fuente tiene. Outfit va
 * recortada al alfabeto latino; una flecha o un emoji en el nombre de una cámara salían como un
 * cuadradito (visto en la prueba con «Ext. → Cairoli»).
 */
export function paraDibujar(t: string): string {
    return String(t || "").replace(/[→⇒➜➔]/g, "->").replace(/[←⇐]/g, "<-").replace(/[^\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018-\u201D\u2026]/g, " ").replace(/\s+/g, " ").trim();
}

/** El nombre de una cámara en una recorrida: entra, se queda y se va. `desde` en segundos del video (sin la apertura). */
export type EscenaDeClip = { desde: number; nombre: string };

/**
 * Le pone la apertura, el logo (si `conMarca`), los nombres de las escenas y el cierre al clip
 * `archivo`, EN EL LUGAR: el nombre y la URL del clip no cambian. Si algo falla, el archivo queda
 * como estaba y se dice por qué — el envío sigue con el clip sin editar, que es mejor que no
 * mandar nada.
 *
 * Recodifica todo el clip (H.264, faststart): la apertura no se puede pegar por copia sin que los
 * parámetros del códec coincidan exactos, y el corte del grabador sale en ultrafast (sin CABAC),
 * así que un concat por copia daría un MP4 que algunos teléfonos no reproducen.
 */
export async function editarClip(archivo: string, p: { titulo: string; lineas: string[]; conMarca: boolean; escenas?: EscenaDeClip[] }): Promise<ClipEditado> {
    const marca = publico(ARCHIVO_MARCA_AGUA);
    if (p.conMarca && !hay(marca)) return { ok: false, motivo: `falta el logo (public/${ARCHIVO_MARCA_AGUA})` };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omni-edicion-"));
    const salida = `${archivo}.editado.mp4`;
    try {
        const m = await medidasDe(archivo);
        if (!m.ancho || !m.alto || !(m.segundos > 0.5)) return { ok: false, motivo: "no se pudo leer el clip" };
        // 704×576 (D1) es el substream anamórfico de una cámara 16:9: se lleva a 16:9 para que no
        // se vea aplastado. Lo demás conserva su forma.
        const r = m.ancho / m.alto;
        const alto = par(Math.min(ALTURA_MAX, m.alto));
        const ancho = r > 1.15 && r < 1.45 ? par(alto * 16 / 9) : par(alto * r);
        const px = (n: number) => Math.max(1, Math.round((n * alto) / 720));
        const capas = await capasDeApertura(tmp, ancho, alto);
        const texto = (nombre: string, t: string) => { const f = path.join(tmp, nombre); fs.writeFileSync(f, paraDibujar(t)); return f; };

        // ── Entradas ──
        const ent: string[] = ["-f", "lavfi", "-i", `color=c=black:s=${ancho}x${alto}:r=${FPS}:d=${INTRO_SEG}`];
        let n = 1;
        const imagen = (f: string, seg: number) => { ent.push("-loop", "1", "-framerate", String(FPS), "-t", String(seg), "-i", f); return n++; };
        const iHalo = capas ? imagen(capas.halo, INTRO_SEG) : -1, iBorroso = capas ? imagen(capas.borroso, INTRO_SEG) : -1;
        const iLogo = capas ? imagen(capas.logo, INTRO_SEG) : -1, iDestello = capas ? imagen(capas.destello, INTRO_SEG) : -1;
        const iClip = n++; ent.push("-i", archivo);
        const iMarca = p.conMarca ? n++ : -1; if (p.conMarca) ent.push("-i", marca);
        const iNegro = n++; ent.push("-f", "lavfi", "-i", `color=c=black:s=${ancho}x${alto}:r=${FPS}:d=${CIERRE_SEG}`);
        const iCierre = capas ? imagen(capas.cierre, CIERRE_SEG) : -1;

        // ── La apertura ──
        const f: string[] = [];
        const lineas = p.lineas.filter(Boolean).slice(0, 2);
        const yLogo = Math.round(alto * (lineas.length ? 0.40 : 0.43));
        const logoH = capas?.logoH || px(70), logoW = capas?.logoW || 0;
        const sobre = (capa: string, x: string, y: string, sale: string, de: string) => f.push(`[${de}][${capa}]overlay=x='${x}':y='${y}':eval=frame:shortest=1[${sale}]`);
        f.push(`[0:v]format=rgba[a0]`);
        let ult = "a0";
        if (capas) {
            f.push(`[${iHalo}:v]format=rgba,fade=t=in:st=0:d=0.9:alpha=1[halo]`);
            sobre("halo", "(W-w)/2", `${yLogo}-h/2`, "a1", ult);
            // El foco que traba: la copia desenfocada llega grande y se apaga; la nítida entra detrás, casi en su tamaño.
            f.push(`[${iBorroso}:v]format=rgba,scale=w='iw*(1.24-0.24*${frenando(0, 0.5)})':h=-1:eval=frame,fade=t=in:st=0:d=0.12:alpha=1,fade=t=out:st=0.16:d=0.34:alpha=1[bo]`);
            sobre("bo", "(W-w)/2", `${yLogo}-h/2`, "a2", "a1");
            f.push(`[${iLogo}:v]format=rgba,scale=w='iw*(1.07-0.07*${frenando(0, 0.6)})':h=-1:eval=frame,fade=t=in:st=0.12:d=0.36:alpha=1[lg]`);
            sobre("lg", "(W-w)/2", `${yLogo}-h/2`, "a3", "a2");
            // El punto de la lente se enciende y se va.
            const dx = Math.round((ancho - logoW) / 2 + logoW * PUNTO_EN_LOGO.x), dy = Math.round(yLogo - logoH / 2 + logoH * PUNTO_EN_LOGO.y);
            f.push(`[${iDestello}:v]format=rgba,scale=w='iw*(0.45+0.75*${frenando(0.5, 0.75)})':h=-1:eval=frame,fade=t=in:st=0.5:d=0.1:alpha=1,fade=t=out:st=0.66:d=0.62:alpha=1[de]`);
            sobre("de", `${dx}-w/2`, `${dy}-h/2`, "a4", "a3");
            ult = "a4";
        } else {
            f.push(`[${ult}]drawtext=fontfile=${fuente(800)}:text='OmniAccess':expansion=none:fontsize=${px(76)}:fontcolor=white:x=(w-text_w)/2:y=${yLogo}-text_h/2:alpha='${avance(0.12, 0.4)}'[a4]`);
            ult = "a4";
        }
        const seVa = +(INTRO_SEG - PASE_INTRO_SEG - SALIDA_TEXTO_SEG).toFixed(2);
        const yLinea = yLogo + Math.round(logoH / 2) + px(34), anchoLinea = par(ancho * 0.11);
        f.push(`color=c=${COLOR_PUNTO.replace("#", "0x")}:s=${anchoLinea}x${par(px(3))}:r=${FPS}:d=${INTRO_SEG},format=rgba,scale=w='max(2\\,${anchoLinea}*${frenando(0.6, 0.45)})':h=${par(px(3))}:eval=frame,fade=t=out:st=${seVa}:d=${SALIDA_TEXTO_SEG}:alpha=1[ln]`);
        sobre("ln", "(W-w)/2", String(yLinea), "a5", ult);
        ult = "a5";
        const tamTitulo = px(40), tamLinea = px(24);
        const yTitulo = yLinea + px(30);
        const entra = (y: number, t0: number) => `x=(w-text_w)/2:y='${y}+${px(14)}*(1-${frenando(t0, 0.45)})':alpha='${avance(t0, 0.36)}*(1-${avance(seVa, SALIDA_TEXTO_SEG)})'`;
        f.push(`[${ult}]drawtext=fontfile=${fuente(600)}:textfile=${texto("titulo.txt", p.titulo)}:expansion=none:fontsize=${tamTitulo}:fontcolor=white:${entra(yTitulo, 0.75)}[t0]`);
        ult = "t0";
        lineas.forEach((l, k) => {
            f.push(`[${ult}]drawtext=fontfile=${fuente(400)}:textfile=${texto(`linea${k}.txt`, l)}:expansion=none:fontsize=${tamLinea}:fontcolor=${GRIS_TEXTO}:${entra(yTitulo + Math.round(tamTitulo * 1.45) + k * Math.round(tamLinea * 1.5), 0.9 + k * 0.1)}[t${k + 1}]`);
            ult = `t${k + 1}`;
        });
        f.push(`[${ult}]fps=${FPS},format=yuv420p,settb=AVTB[apertura]`);

        // ── Las escenas: la cámara, el logo arriba a la derecha y, en una recorrida, el nombre de cada una ──
        const margen = Math.round(ancho * MARCA_AGUA_MARGEN);
        f.push(`[${iClip}:v]setpts=PTS-STARTPTS,scale=${ancho}:${alto},setsar=1,fps=${FPS},format=yuv420p[c0]`);
        ult = "c0";
        if (p.conMarca) {
            f.push(`[${iMarca}:v]scale=${par(ancho * MARCA_AGUA_ANCHO)}:-1[marca]`, `[${ult}][marca]overlay=${marcaEnEsquina(margen)},format=yuv420p[c1]`);
            ult = "c1";
        }
        const escenas = (p.escenas || []).filter((e) => e.desde < m.segundos - 0.6).slice(0, 12);
        escenas.forEach((e, k) => {
            if (!paraDibujar(e.nombre)) return;
            // Se va antes de que entre el de la cámara siguiente: dos nombres a la vez, uno encima del otro, no se leen.
            const tope = (escenas[k + 1]?.desde ?? m.segundos) - ROTULO_PASO_SEG - 0.05;
            const a = +(e.desde + 0.18).toFixed(2), b = +(a + ROTULO_PASO_SEG).toFixed(2), c = +Math.max(b, Math.min(a + ROTULO_ESCENA_SEG, tope)).toFixed(2), d = +(c + ROTULO_PASO_SEG).toFixed(2);
            const alfa = `if(lt(t\\,${a})\\,0\\,if(lt(t\\,${b})\\,(t-${a})/${ROTULO_PASO_SEG}\\,if(lt(t\\,${c})\\,1\\,if(lt(t\\,${d})\\,(${d}-t)/${ROTULO_PASO_SEG}\\,0))))`;
            f.push(`[${ult}]drawtext=fontfile=${fuente(600)}:textfile=${texto(`escena${k}.txt`, e.nombre.slice(0, 60))}:expansion=none:fontsize=${px(26)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${px(12)}` +
                `:x='${margen + px(12)}-${px(18)}*(1-${frenando(a, 0.4)})':y=h-text_h-${margen + px(14)}:alpha='${alfa}'[e${k}]`);
            ult = `e${k}`;
        });
        f.push(`[${ult}]settb=AVTB[escenas]`);
        // La cámara entra desde adentro de la placa.
        const largo1 = INTRO_SEG + m.segundos - PASE_INTRO_SEG;
        f.push(`[apertura][escenas]xfade=transition=zoomin:duration=${PASE_INTRO_SEG}:offset=${(INTRO_SEG - PASE_INTRO_SEG).toFixed(3)}[x1]`);

        // ── El cierre: a negro, y el logo un instante ──
        if (capas) {
            f.push(`[${iNegro}:v]format=rgba[n0]`, `[${iCierre}:v]format=rgba,fade=t=in:st=${(PASE_CIERRE_SEG * 0.6).toFixed(2)}:d=0.3:alpha=1[lc]`);
            f.push(`[n0][lc]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,fade=t=out:st=${(CIERRE_SEG - 0.28).toFixed(2)}:d=0.28,fps=${FPS},format=yuv420p,settb=AVTB[cierre]`);
        } else f.push(`[${iNegro}:v]fps=${FPS},format=yuv420p,settb=AVTB[cierre]`);
        f.push(`[x1][cierre]xfade=transition=fadeblack:duration=${PASE_CIERRE_SEG}:offset=${(largo1 - PASE_CIERRE_SEG).toFixed(3)},format=yuv420p[salida]`);
        const esperado = largo1 + CIERRE_SEG - PASE_CIERRE_SEG;

        await correr("ffmpeg", ["-y", "-loglevel", "error", ...ent, "-filter_complex", f.join(";"), "-map", "[salida]", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-movflags", "+faststart", salida], EDICION_TOPE_MS);
        // Se compara la duración, no el peso: el corte del grabador sale en ultrafast y pesa el
        // doble que el editado, así que «más chico» no dice nada. Más corto, sí: es un corte a medias.
        const e = hay(salida) ? await medidasDe(salida) : null;
        if (!e || e.segundos < esperado - Math.max(1, m.segundos * 0.1)) return { ok: false, motivo: "la edición salió incompleta" };
        fs.renameSync(salida, archivo);
        return { ok: true, ancho, alto, segundos: e.segundos };
    } catch (e) {
        return { ok: false, motivo: String((e as Error)?.message || e).slice(0, 300) };
    } finally {
        try { fs.unlinkSync(salida); } catch { }
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
    }
}

/**
 * El pase de una cámara a la otra en una recorrida (14/11, Nico: «mejorá las animaciones de entrada
 * y salida entre escenas, rápidas pero premium»). Antes era un corte seco: se pegaban los tramos y
 * la imagen saltaba de una cámara a otra sin aviso. Ahora la que se va se barre de costado, como un
 * paneo rápido, y la que llega entra por el mismo barrido. Corto: es un pase, no un efecto.
 */
const PASE_ESCENA_SEG = 0.35;
/** Con un tramo más corto que esto no hay de dónde sacar el pase: esa unión va con corte. */
const PASE_TRAMO_MINIMO_SEG = 1.2;

/**
 * Une los tramos de una recorrida en `destino`, con el pase entre cámaras. Devuelve dónde empieza
 * cada cámara en el clip unido (para escribirle el nombre), o null si no se pudo.
 */
export async function unirEscenas(partes: string[], nombres: string[], destino: string, alto: number): Promise<EscenaDeClip[] | null> {
    const ancho = par((alto * 16) / 9);
    const dur = await Promise.all(partes.map((x) => medidasDe(x).then((m) => m.segundos).catch(() => 0)));
    // Todo al mismo tamaño y cadencia: los tramos vienen de cámaras distintas.
    const igualar = partes.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS,scale=${ancho}:${alto}:force_original_aspect_ratio=decrease,pad=${ancho}:${alto}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p,settb=AVTB[v${i}]`).join(";");
    // Con pase si todos los tramos dan para eso; si alguno es muy corto (o no se pudo medir), corte.
    const conPase = dur.every((d) => d >= PASE_TRAMO_MINIMO_SEG);
    let filtro: string, escenas: EscenaDeClip[];
    if (conPase) {
        const pasos: string[] = []; let largo = dur[0], ult = "v0";
        const inicio = [0];
        for (let i = 1; i < partes.length; i++) {
            const offset = largo - PASE_ESCENA_SEG;
            pasos.push(`[${ult}][v${i}]xfade=transition=hblur:duration=${PASE_ESCENA_SEG}:offset=${offset.toFixed(3)}[x${i}]`);
            // La cámara nueva ya se ve a mitad del pase.
            inicio.push(offset + PASE_ESCENA_SEG / 2);
            largo += dur[i] - PASE_ESCENA_SEG; ult = `x${i}`;
        }
        filtro = `${igualar};${pasos.join(";")};[${ult}]format=yuv420p[v]`;
        escenas = inicio.map((desde, i) => ({ desde, nombre: nombres[i] || "" }));
    } else {
        filtro = `${igualar};${partes.map((_, i) => `[v${i}]`).join("")}concat=n=${partes.length}:v=1:a=0[v]`;
        let acum = 0; escenas = dur.map((d, i) => { const e = { desde: acum, nombre: nombres[i] || "" }; acum += d; return e; });
    }
    try {
        await correr("ffmpeg", ["-y", "-loglevel", "error", ...partes.flatMap((x) => ["-i", x]), "-filter_complex", filtro, "-map", "[v]", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", destino], 90_000);
    } catch (e) { console.warn(`[clip] no se pudieron unir los tramos: ${String((e as Error)?.message || e).slice(0, 200)}`); return null; }
    return hay(destino) ? escenas : null;
}
