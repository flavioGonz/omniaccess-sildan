import { variantesMasLeidas } from "@/lib/chapas-parecidas";
import { NextRequest, NextResponse } from "next/server";
import { exigirFuncion } from "@/lib/funcion-servidor";
import { prisma } from "@/lib/prisma";
import { normalizarMatricula, ULTIMA_VIGENTE_MS } from "@/lib/min-interior";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy con humano-en-el-medio para la consulta pública de "Matrículas Requeridas"
 * del Ministerio del Interior (Uruguay).
 *
 * El servidor SOLO transporta el formulario: trae la sesión + el csrf + la IMAGEN del
 * captcha, y reenvía la consulta con el código que ESCRIBIÓ UNA PERSONA. No se resuelve
 * el captcha automáticamente: nunca se lee, deduce ni usa la respuesta del desafío por
 * software (ni por OCR, ni por el audio, ni por el valor que el sitio expone). El único
 * paso que valida "no soy un robot" lo hace el guardia tipeando el código.
 */

const BASE = "https://matriculas-requeridas.minterior.gub.uy";
/** En cuántos días de lecturas se buscan chapas parecidas a la consultada. */
const PARECIDAS_DIAS = 7;
const HOST = new URL(BASE).host;
const INDEX = BASE + "/index.php";
const RELOAD = BASE + "/Captcha/RecargarCaptcha.php";
const SUBMIT = BASE + "/controller/matriculaController.php";
const UA = "Mozilla/5.0 (OmniAccess LPR; consulta asistida por operador)";
/** Lo que se espera al sitio en cada paso. Sin tope, un sitio colgado dejaba el diálogo en «Consultando…» para siempre. */
const ESPERA_MS = 15_000;
/** Saltos dentro del mismo sitio que se siguen (index.php → / y parecidos). Fuera del sitio, nunca. */
const SALTOS_MAX = 3;

type Sess = { cookie: string; csrf: string; created: number };
const store: Map<string, Sess> = (globalThis as any).__miStore ?? new Map<string, Sess>();
(globalThis as any).__miStore = store;
// Cuánto vale la imagen antes de pedir otra. Es el tiempo que la sesión PHP del sitio
// aguanta sin uso en la práctica; se devuelve al cliente (`venceEnMs`) para que el diálogo
// muestre la cuenta regresiva y renueve la imagen solo, en vez de fallar al enviar.
const TTL = 5 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.created > TTL) store.delete(k);
}
function rid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function phpsessid(setCookies: string[]): string {
  for (const c of setCookies) {
    const m = /PHPSESSID=([^;]+)/.exec(c || "");
    if (m) return "PHPSESSID=" + m[1];
  }
  return "";
}
function getSetCookies(res: Response): string[] {
  const anyH = res.headers as any;
  if (typeof anyH.getSetCookie === "function") return anyH.getSetCookie();
  const one = res.headers.get("set-cookie");
  return one ? [one] : [];
}

/**
 * Un pedido al sitio con tope de tiempo y redirecciones a mano: se siguen sólo las que quedan en
 * el mismo sitio (y juntando la cookie de sesión que el salto ponga), porque el 22/10 la caída fue
 * justamente un 302 a la portada de gub.uy, y seguirlo traía una página sin formulario. Si el salto
 * sale del sitio se devuelve tal cual, para que quien llama diga a dónde.
 */
async function traer(url: string, init: RequestInit & { cookie?: string } = {}): Promise<{ r: Response; url: string; cookie: string; fuera?: string }> {
  let actual = url, cookie = init.cookie || "", metodo = init.method || "GET", cuerpo = init.body;
  for (let salto = 0; ; salto++) {
    const headers: Record<string, string> = { "User-Agent": UA, ...(init.headers as Record<string, string> || {}) };
    if (cookie) headers.Cookie = cookie;
    const r = await fetch(actual, { ...init, method: metodo, body: cuerpo, headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(ESPERA_MS) });
    cookie = phpsessid(getSetCookies(r)) || cookie;
    if (r.status < 300 || r.status >= 400) return { r, url: actual, cookie };
    const destino = new URL(r.headers.get("location") || "/", actual);
    if (destino.host !== HOST) return { r, url: actual, cookie, fuera: destino.href };
    if (salto >= SALTOS_MAX) return { r, url: actual, cookie, fuera: destino.href };
    // 301/302/303 pasan a GET, como hace un navegador; 307/308 conservan el método.
    if (r.status !== 307 && r.status !== 308) { metodo = "GET"; cuerpo = undefined; }
    actual = destino.href;
  }
}

/** El valor de un atributo de una etiqueta, venga en el orden que venga y con comillas simples o dobles. */
function atributo(etiqueta: string, nombre: string): string {
  const m = new RegExp(`\\b${nombre}\\s*=\\s*(["'])([^"']*)\\1`, "i").exec(etiqueta);
  return m ? m[2] : "";
}
function extractCsrf(html: string): string {
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    if (/\bname\s*=\s*["']csrf_token["']/i.test(m[0])) return atributo(m[0], "value");
  }
  return "";
}
/**
 * La imagen de verificación. Antes se buscaba con una sola forma exacta del HTML
 * (`id="captcha-container">` seguido de un `<img src="data:…">`); un espacio o un atributo de más
 * y el formulario «venía sin imagen». Ahora: primero el `<img>` dentro del contenedor del captcha,
 * después cualquier `<img>` cuyo id, clase o alt diga captcha. Puede venir embebida (data:) o como
 * dirección del sitio; en ese caso se baja con la misma sesión para mostrarla tal cual al guardia.
 */
function extractImgSrc(html: string): string {
  const cont = /id\s*=\s*["']captcha-container["'][^>]*>([\s\S]{0,4000}?)<\/(div|span|p|td)>/i.exec(html);
  const img = cont && /<img\b[^>]*>/i.exec(cont[1]);
  if (img) return atributo(img[0], "src");
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (/captcha/i.test(atributo(m[0], "id") + " " + atributo(m[0], "class") + " " + atributo(m[0], "alt") + " " + atributo(m[0], "src"))) return atributo(m[0], "src");
  }
  return "";
}
async function imagenComoDato(src: string, desde: string, cookie: string): Promise<string> {
  if (!src) return "";
  if (src.startsWith("data:image/")) return src;
  const url = new URL(src, desde);
  if (url.host !== HOST) return "";
  const { r } = await traer(url.href, { cookie });
  const tipo = r.headers.get("content-type") || "";
  if (!r.ok || !tipo.startsWith("image/")) return "";
  return `data:${tipo.split(";")[0]};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
}

/**
 * Pide el formulario. Cada falla dice cuál fue (redirige fuera del sitio, responde un error, viene
 * sin alguna de sus tres piezas), y deja una línea en el log para poder mirarlo desde el servidor.
 */
async function start(): Promise<{ cookie: string; csrf: string; image: string; falla?: string }> {
  const { r, url, cookie, fuera } = await traer(INDEX);
  if (fuera) {
    console.error(`[min-interior] ${INDEX} redirige (${r.status}) a ${fuera}`);
    return { cookie: "", csrf: "", image: "", falla: `El Ministerio no está atendiendo la consulta en ${HOST}: la dirección redirige a ${fuera}. Consultala en el sitio oficial.` };
  }
  if (!r.ok) {
    console.error(`[min-interior] ${url} respondió ${r.status}`);
    return { cookie: "", csrf: "", image: "", falla: `El sitio del Ministerio respondió ${r.status}. Reintentá en unos minutos o consultá en el sitio oficial.` };
  }
  const html = await r.text();
  const csrf = extractCsrf(html);
  const image = await imagenComoDato(extractImgSrc(html), url, cookie).catch(() => "");
  const falta = [!cookie && "la sesión", !csrf && "el token del formulario", !image && "la imagen de verificación"].filter(Boolean);
  if (falta.length) {
    console.error(`[min-interior] el formulario vino sin ${falta.join(", ")} (${html.length} bytes, ${url})`);
    return { cookie, csrf, image, falla: `El sitio del Ministerio contestó, pero sin ${falta.join(", ")}: puede haber cambiado su formulario. Consultala en el sitio oficial.` };
  }
  console.log(`[min-interior] formulario listo (${html.length} bytes, imagen ${image.startsWith("data:") ? Math.round(image.length / 1024) + " KB" : "?"})`);
  return { cookie, csrf, image };
}

/**
 * Quién consulta: la sesión del panel o el guardia identificado. La ruta está abierta en el
 * middleware (la consulta nació en la consola de la garita), pero sin nadie identificado quedaba
 * como un pasamanos al sitio del Ministerio para cualquiera, y ahora además devuelve consultas
 * guardadas.
 */
async function quienConsulta(): Promise<string | null> {
  const { getSession } = await import("@/app/actions/auth");
  const s: any = await getSession().catch(() => null);
  if (s) return String(s.name || s.sub || "panel").slice(0, 80);
  const { leerGuardia } = await import("@/lib/sesion-guardia");
  return await leerGuardia();
}
const sinIdentificar = () => NextResponse.json({ ok: false, error: "Entrá con tu usuario para consultar." }, { status: 401 });

export async function GET(req: NextRequest) {
  const funcionApagada = await exigirFuncion("LPR_MIN_INTERIOR"); if (funcionApagada) return funcionApagada;
  if (!(await quienConsulta())) return sinIdentificar();
  gc();
  const action = req.nextUrl.searchParams.get("action") || "start";
  try {
    if (action === "parecidas") {
      // Las chapas parecidas que el lector leyó MÁS veces que ésta, en las mismas cámaras y en la última
      // semana: si las hay, la consultada puede ser una mala lectura (ver lib/chapas-parecidas). No toca el sitio.
      const matricula = normalizarMatricula(req.nextUrl.searchParams.get("matricula"));
      if (!matricula) return NextResponse.json({ ok: true, propias: 0, parecidas: [] });
      const desde = new Date(Date.now() - PARECIDAS_DIAS * 86_400_000).toISOString().replace("T", " ").replace("Z", "");
      const conteos = await prisma.$queryRaw<{ chapa: string; lecturas: number }[]>`
        SELECT "plateDetected" AS chapa, count(*)::int AS lecturas FROM "AccessEvent"
        WHERE timestamp >= ${desde}::timestamp AND length("plateDetected") = ${matricula.length}
          AND "deviceId" IN (SELECT DISTINCT "deviceId" FROM "AccessEvent" WHERE "plateDetected" = ${matricula} AND timestamp >= ${desde}::timestamp)
        GROUP BY 1`;
      return NextResponse.json({ ok: true, dias: PARECIDAS_DIAS, ...variantesMasLeidas(matricula, conteos) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "ultima") {
      // La última respuesta guardada de una matrícula: el botón la muestra sin volver a consultar.
      // No toca el sitio del Ministerio.
      const matricula = normalizarMatricula(req.nextUrl.searchParams.get("matricula"));
      if (!matricula) return NextResponse.json({ ok: true, ultima: null });
      const u = await prisma.consultaMinInterior.findFirst({
        where: { matricula, creadoEn: { gte: new Date(Date.now() - ULTIMA_VIGENTE_MS) } },
        orderBy: { creadoEn: "desc" },
        select: { estado: true, creadoEn: true, quien: true, extracto: true },
      });
      return NextResponse.json({ ok: true, ultima: u ? { ...u, creadoEn: u.creadoEn.toISOString() } : null }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "start") {
      const { cookie, csrf, image, falla } = await start();
      if (falla || !cookie || !csrf || !image)
        return NextResponse.json(
          { ok: false, error: falla || "El sitio del Ministerio no devolvió el formulario. Reintentá en unos segundos.", sitioOficial: true },
          { status: 502 }
        );
      const sid = rid();
      store.set(sid, { cookie, csrf, created: Date.now() });
      return NextResponse.json({ ok: true, sid, image, venceEnMs: TTL });
    }
    if (action === "reload") {
      const sid = req.nextUrl.searchParams.get("sid") || "";
      const s = store.get(sid);
      if (!s) return NextResponse.json({ ok: false, error: "Sesión expirada." }, { status: 410 });
      const { r } = await traer(RELOAD, { cookie: s.cookie, headers: { "X-Requested-With": "XMLHttpRequest" } });
      const data: any = r.ok ? await r.json().catch(() => null) : null;
      const image = data?.newCaptchaImage || "";
      // La respuesta trae también "captchaPhrase" (la solución): se ignora a propósito.
      if (!image) {
        console.error(`[min-interior] la recarga de la imagen respondió ${r.status} sin imagen`);
        return NextResponse.json({ ok: false, error: "No se pudo recargar la imagen." }, { status: 502 });
      }
      s.created = Date.now();
      return NextResponse.json({ ok: true, image, venceEnMs: TTL });
    }
    return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
  } catch (e: any) {
    const tiempo = e?.name === "TimeoutError";
    console.error(`[min-interior] ${action}: ${tiempo ? `sin respuesta en ${ESPERA_MS / 1000} s` : e?.message || e}`);
    return NextResponse.json(
      { ok: false, error: tiempo ? `El sitio del Ministerio no contestó en ${ESPERA_MS / 1000} s. Reintentá o consultá en el sitio oficial.` : "Sin conexión al sitio del Ministerio: " + (e?.message || String(e)) },
      { status: 502 }
    );
  }
}

function classify(text: string): { status: "REQUERIDA" | "NO" | "CAPTCHA" | "UNKNOWN"; excerpt: string } {
  // Texto plano (la página SIEMPRE trae "Matrículas requeridas" en el título, así que
  // no se puede decidir sobre toda la página: hay que aislar la frase de resultado).
  const plain = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const low0 = plain.toLowerCase();

  // Frase de resultado: "La matrícula: ABC1234 ... ." (verificado en campo)
  const m = /la\s+matr[ií]cula\s*:?[^.]*\./i.exec(plain);
  const sentence = m ? m[0] : "";
  const low = (sentence || plain).toLowerCase();

  // Negación robusta: "no está requerida", "no se encuentra requerida",
  // "no registra requerimiento", "no figura", "sin requisitoria".
  const neg = /\bno\b[^.]{0,30}(requerid|requisitoria|registr|requerimiento|solicit)|sin\s+requisitoria|no\s+figura|no\s+posee/.test(low);
  const pos = /(requerid|requisitoria|requerimiento|solicitad|pedido\s+de\s+captura)/.test(low);

  let status: "REQUERIDA" | "NO" | "CAPTCHA" | "UNKNOWN" = "UNKNOWN";
  if (m) {
    status = neg ? "NO" : pos ? "REQUERIDA" : "UNKNOWN";
  } else if (/(captcha|verificador|c[oó]digo)[^.]{0,40}(incorrect|inv[aá]lid|err[oó]|no\s+coincide|no\s+es\s+v[aá]lid)/.test(low0)) {
    status = "CAPTCHA";
  }
  return { status, excerpt: (sentence || plain).slice(0, 700) };
}

export async function POST(req: NextRequest) {
  const funcionApagada = await exigirFuncion("LPR_MIN_INTERIOR"); if (funcionApagada) return funcionApagada;
  const quien = await quienConsulta();
  if (!quien) return sinIdentificar();
  gc();
  try {
    const body: any = await req.json().catch(() => ({}));
    const sid = String(body.sid || "");
    const matricula = normalizarMatricula(body.matricula);
    const captcha = String(body.captcha_code || "").trim();
    const s = store.get(sid);
    if (!s) return NextResponse.json({ ok: false, error: "Sesión expirada. Cerrá y volvé a abrir." }, { status: 410 });
    if (!matricula || !captcha) return NextResponse.json({ ok: false, error: "Faltan matrícula o captcha." }, { status: 400 });

    const form = new URLSearchParams({ csrf_token: s.csrf, matricula, captcha_code: captcha });
    store.delete(sid); // el captcha es de un solo uso
    const { r, fuera } = await traer(SUBMIT, {
      method: "POST",
      cookie: s.cookie,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: INDEX, Origin: BASE },
      body: form.toString(),
    });
    if (fuera || !r.ok) {
      console.error(`[min-interior] la consulta respondió ${r.status}${fuera ? ` y redirige a ${fuera}` : ""}`);
      return NextResponse.json({ ok: false, error: fuera ? `El sitio del Ministerio mandó la consulta a ${fuera}: puede haber cambiado. Consultala en el sitio oficial.` : `El sitio del Ministerio respondió ${r.status} a la consulta.` }, { status: 502 });
    }
    const text = await r.text();
    const { status, excerpt } = classify(text);
    console.log(`[min-interior] consulta: ${status} (${text.length} bytes)`);
    // Se guarda la respuesta, no el intento: un código mal tipeado no dice nada de la matrícula.
    if (status !== "CAPTCHA") {
      await prisma.consultaMinInterior.create({ data: { matricula, estado: status, extracto: excerpt.slice(0, 700) || null, quien } })
        .catch((e) => console.error(`[min-interior] no se pudo guardar la consulta: ${e?.message || e}`));
    }
    return NextResponse.json({ ok: true, status, matricula, excerpt });
  } catch (e: any) {
    const tiempo = e?.name === "TimeoutError";
    console.error(`[min-interior] consulta: ${tiempo ? `sin respuesta en ${ESPERA_MS / 1000} s` : e?.message || e}`);
    return NextResponse.json({ ok: false, error: tiempo ? `El sitio del Ministerio no contestó en ${ESPERA_MS / 1000} s.` : "Error al consultar: " + (e?.message || String(e)) }, { status: 502 });
  }
}
