import { NextRequest, NextResponse } from "next/server";

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
const INDEX = BASE + "/index.php";
const RELOAD = BASE + "/Captcha/RecargarCaptcha.php";
const SUBMIT = BASE + "/controller/matriculaController.php";
const UA = "Mozilla/5.0 (OmniAccess LPR; consulta asistida por operador)";

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
function extractCsrf(html: string): string {
  const m = /name="csrf_token"\s+value="([a-f0-9]+)"/i.exec(html);
  return m ? m[1] : "";
}
function extractImg(html: string): string {
  const m = /id="captcha-container">\s*<img\s+src="(data:image\/[^"]+)"/i.exec(html);
  return m ? m[1] : "";
}

async function start() {
  const r = await fetch(INDEX, { headers: { "User-Agent": UA }, cache: "no-store" });
  const html = await r.text();
  const cookie = phpsessid(getSetCookies(r));
  return { cookie, csrf: extractCsrf(html), image: extractImg(html) };
}

export async function GET(req: NextRequest) {
  gc();
  const action = req.nextUrl.searchParams.get("action") || "start";
  try {
    if (action === "start") {
      const { cookie, csrf, image } = await start();
      if (!cookie || !csrf || !image)
        return NextResponse.json(
          { ok: false, error: "El sitio del Ministerio no devolvió el formulario. Reintentá en unos segundos." },
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
      const r = await fetch(RELOAD, {
        headers: { Cookie: s.cookie, "X-Requested-With": "XMLHttpRequest", "User-Agent": UA },
        cache: "no-store",
      });
      const data: any = await r.json().catch(() => null);
      const image = data?.newCaptchaImage || "";
      // La respuesta trae también "captchaPhrase" (la solución): se ignora a propósito.
      if (!image) return NextResponse.json({ ok: false, error: "No se pudo recargar el captcha." }, { status: 502 });
      s.created = Date.now();
      return NextResponse.json({ ok: true, image, venceEnMs: TTL });
    }
    return NextResponse.json({ ok: false, error: "acción inválida" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Sin conexión al sitio del Ministerio: " + (e?.message || String(e)) },
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
  gc();
  try {
    const body: any = await req.json().catch(() => ({}));
    const sid = String(body.sid || "");
    const matricula = String(body.matricula || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const captcha = String(body.captcha_code || "").trim();
    const s = store.get(sid);
    if (!s) return NextResponse.json({ ok: false, error: "Sesión expirada. Cerrá y volvé a abrir." }, { status: 410 });
    if (!matricula || !captcha) return NextResponse.json({ ok: false, error: "Faltan matrícula o captcha." }, { status: 400 });

    const form = new URLSearchParams({ csrf_token: s.csrf, matricula, captcha_code: captcha });
    const r = await fetch(SUBMIT, {
      method: "POST",
      headers: {
        Cookie: s.cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
        Referer: INDEX,
        Origin: BASE,
      },
      body: form.toString(),
      redirect: "follow",
      cache: "no-store",
    });
    const text = await r.text();
    store.delete(sid); // el captcha es de un solo uso
    const { status, excerpt } = classify(text);
    return NextResponse.json({ ok: true, status, matricula, excerpt });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Error al consultar: " + (e?.message || String(e)) }, { status: 502 });
  }
}
