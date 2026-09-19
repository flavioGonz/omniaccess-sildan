import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { confirmarEstadia, cerrarEstadia, estadiasAbiertas } from "@/lib/estadias";
import { mismaChapa, pareceMatricula } from "@/lib/matriculas";

export const dynamic = "force-dynamic";

// Dos avistamientos de la misma matrícula separados por menos que esto son el mismo paso
// por el barrio. Más que esto, el auto se fue y volvió: es otro trayecto.
const VENTANA_TRAYECTO_MIN = Number(process.env.TRACKING_PASS_WINDOW_MIN || 10);

// Cuánto se puede haber corrido el recuadro de la chapa entre dos lecturas para seguir
// considerando que el vehículo no se movió. Es fracción del cuadro: 3% de 1600 px son
// unos 48 px, más que suficiente para absorber el temblor del detector y bastante menos
// que lo que se desplaza un auto andando, aunque vaya despacio.
const TOLERANCIA_QUIETO = Number(process.env.TRACKING_PARKED_TOLERANCE || 0.03);

// Si la última vez que se lo vio fue hace más que esto, la estadía se da por terminada y
// la próxima lectura abre una nueva.
const CORTE_ESTADIA_MIN = Number(process.env.TRACKING_PARKED_GAP_MIN || 20);

type Caja = { x: number; y: number; w: number; h: number };

const leerCaja = (v: any): Caja | null => {
    try {
        const c = typeof v === "string" ? JSON.parse(v) : v;
        return c && [c.x, c.y, c.w, c.h].every((n: any) => Number.isFinite(Number(n))) ? c : null;
    } catch { return null; }
};

/**
 * ¿Es el mismo vehículo, en el mismo lugar del cuadro?
 *
 * Se comparan el centro y el tamaño. El centro dice si se movió; el tamaño, si se acercó
 * o se alejó — un auto que avanza hacia la cámara puede mantener el centro y crecer.
 */
function estaQuieto(a: Caja | null, b: Caja | null) {
    if (!a || !b) return false;
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const corrido = Math.hypot(ca.x - cb.x, ca.y - cb.y);
    const cambioTam = Math.abs(a.w - b.w) / Math.max(a.w, b.w, 0.001);
    return corrido <= TOLERANCIA_QUIETO && cambioTam <= 0.25;
}

/**
 * POST /api/tracking/sighting
 *
 * Recibe la lectura ya consolidada por la ráfaga. Acá se decide algo que importa: si es
 * un vehículo que PASÓ o uno que está ESTACIONADO dentro del encuadre.
 *
 * Un auto quieto se vuelve a leer con cada vehículo que cruza. Tratarlo como avistamiento
 * nuevo llenaba el historial de repeticiones y hacía que el mapa dibujara recorridos que
 * nunca ocurrieron. Ahora una estadía es UNA fila, con su intervalo, que se va extendiendo
 * mientras el auto siga ahí.
 *
 * La zona o la línea del calibrador llegan acá como `enPuerta`, y deciden QUÉ CLASE de
 * evento es, no si se guarda. Ese fue un error que costó corregir: descartar de entrada
 * al que estaba fuera de la línea dejaba el historial limpio, pero también hacía imposible
 * avisar que un auto estacionó o que se fue, porque esos autos justamente no pasan por la
 * línea. El orden correcto es:
 *
 *   quieto               → estadía, esté donde esté del cuadro
 *   en movimiento, cerca → pasada, va al recorrido
 *   en movimiento, lejos → se descarta: es tránsito fuera de lo que interesa de esa cámara
 */
export async function POST(req: NextRequest) {
    const token = req.headers.get("x-tracking-token") || "";
    let esperado = process.env.TRACKING_TOKEN || "";
    if (!esperado) {
        const s = await prisma.setting.findUnique({ where: { key: "TRACKING_TOKEN" } });
        esperado = s?.value || "";
    }
    if (!esperado || token !== esperado) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    let body: any = {};
    try { body = await req.json(); } catch { }

    const patente = String(body.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

    /**
     * Antes acá alcanzaba con cuatro caracteres, y por esa puerta entraron `1111` y
     * `CWA111` como si fueran vehículos: abrían estadía y aparecían en el panel de
     * estacionados junto a los autos de verdad. El lector devuelve texto aunque no haya
     * chapa — un cartel, el número de una casa — y ese texto no se parece a una matrícula
     * en lo más básico: tener letras y números a la vez.
     */
    if (!pareceMatricula(patente)) {
        return NextResponse.json({ ok: true, ignorado: "no parece matrícula", plate: patente }, { status: 202 });
    }

    const confianza = body.confidence != null ? Number(body.confidence) : null;
    const minimo = Number(process.env.TRACKING_MIN_CONFIDENCE || 0.6);
    if (confianza != null && confianza < minimo) {
        return NextResponse.json({ ok: true, ignorado: "confianza baja", confianza }, { status: 202 });
    }

    const cuando = body.timestamp ? new Date(body.timestamp) : new Date();
    const lecturas = body.reads != null ? Number(body.reads) : null;
    const caja = leerCaja(body.bbox);

    // ── ¿Sigue ahí el mismo auto quieto?
    const desdeEstadia = new Date(cuando.getTime() - CORTE_ESTADIA_MIN * 60 * 1000);

    // Se traen las lecturas recientes de ESA cámara y el antecedente se elige por
    // parecido, no por matrícula exacta.
    //
    // Buscar por texto exacto partía en dos al mismo vehículo cuando el OCR cambiaba un
    // carácter entre dos ráfagas: el mismo auto quedó como DAF1168 y, dos segundos
    // después, como OAF1168. La agrupación de la pasarela no alcanza para esto porque
    // trabaja dentro de una ráfaga, y acá son dos.
    const recientes = await prisma.plateSighting.findMany({
        where: {
            deviceId: body.deviceId || null,
            source: "TRACK",
            timestamp: { gte: desdeEstadia, lte: cuando },
        },
        orderBy: { timestamp: "desc" },
        take: 60,
    });
    const porChapa = recientes.find((f) => mismaChapa(f.plate, patente)) || null;

    /**
     * Si la matrícula no engancha con nada, el recuadro todavía puede.
     *
     * Dos lecturas en el mismo lugar del cuadro son el mismo vehículo, diga lo que diga
     * el OCR. Pasó con un auto real: la misma chapa quedó como ABM5064 y como ADH5004,
     * con el recuadro idéntico (x=0.3287, w=0.0306) — tres caracteres de diferencia, así
     * que compararlas por texto no las junta nunca, y aflojar esa comparación a tres
     * diferencias empezaría a juntar autos distintos de verdad.
     *
     * El recuadro es una identidad más fuerte que la matrícula, pero se usa SOLO para
     * estadías, nunca para pasadas. Si se usara también para las pasadas, un auto que
     * cruza justo por donde hay otro estacionado se fusionaría con él, que es
     * exactamente el problema que se acaba de resolver en la pasarela.
     */
    const porLugar = (!porChapa && caja && body.enPuerta === false)
        ? recientes.find((f) => f.estado === "ESTACIONADO" && estaQuieto(caja, leerCaja(f.bbox))) || null
        : null;

    const previo = porChapa || porLugar;

    // Si el enganche fue por el recuadro, por definición está en el mismo lugar.
    const quieto = !!porLugar || !!(previo && caja && estaQuieto(caja, leerCaja(previo.bbox)));
    const fueraDePuerta = body.enPuerta === false;

    /**
     * Una estadía: el mismo vehículo, visto otra vez en la misma cámara sin haber pasado
     * por donde interesa.
     *
     * Las dos ramas que llevan acá son distintas en un punto que importa. Si está QUIETO,
     * la permanencia se acumula desde la primera vez que se lo vio ahí. Si se movió pero
     * sigue fuera de la zona o de la línea — un auto circulando por un rincón del cuadro
     * que esa cámara no vigila — la permanencia se reinicia, y por eso nunca llega a
     * confirmarse como estacionamiento: se queda dando vueltas hasta que vence y se
     * cierra en silencio, sin avisar que se retiró de ningún lado.
     *
     * De un modo u otro queda UNA fila por vehículo y cámara, que es lo que evita que el
     * historial se llene con el mismo auto veinte veces.
     */
    if (previo && (quieto || fueraDePuerta)) {
        const mejorFoto = confianza != null && (previo.confidence ?? 0) < confianza;
        const actualizado = await prisma.plateSighting.update({
            where: { id: previo.id },
            data: {
                estado: "ESTACIONADO",
                // Si esta lectura es mejor, manda su ortografía: la fila se queda con la
                // versión más segura de la matrícula y no con la primera que entró.
                ...(mejorFoto ? { plate: patente } : {}),
                estDesde: quieto ? (previo.estDesde ?? previo.timestamp) : cuando,
                estHasta: cuando,
                timestamp: cuando,
                confidence: mejorFoto ? confianza : previo.confidence,
                reads: mejorFoto ? (lecturas ?? previo.reads) : previo.reads,
                snapshotUrl: mejorFoto ? (body.snapshotUrl || previo.snapshotUrl) : previo.snapshotUrl,
                ...(caja ? { bbox: JSON.stringify(caja) } : {}),
                // Si se movió, lo de antes dejó de valer: vuelve a estar por confirmarse.
                ...(quieto ? {} : { estAvisado: false }),
            },
        });
        const recienAvisado = quieto ? await confirmarEstadia(actualizado as any) : false;
        return NextResponse.json({
            ok: true, estado: "ESTACIONADO", id: actualizado.id, nuevo: recienAvisado,
            quieto, desde: actualizado.estDesde, hasta: actualizado.estHasta,
        });
    }

    /**
     * Primera lectura de un vehículo fuera de la zona o de la línea.
     *
     * Acá había un error de orden que dejaba la función inservible: se descartaba de
     * entrada, así que nunca quedaba un antecedente contra el cual comparar la lectura
     * siguiente, y por lo tanto ninguna estadía podía abrirse nunca. El vehículo
     * estacionado no desaparecía del historial porque se hubiera resuelto, sino porque
     * ya no se guardaba nada de él — incluido el dato de que estaba ahí.
     *
     * Se abre una estadía tentativa. No es una pasada: no entra al recorrido del mapa ni
     * cuenta para la efectividad, y si resulta ser un auto que iba circulando por donde
     * esa cámara no mira, vence sin avisar nada.
     */
    if (fueraDePuerta) {
        const abierta = await prisma.plateSighting.create({
            data: {
                plate: patente,
                deviceId: body.deviceId || null,
                cameraName: body.cameraName || null,
                lat: body.lat ?? null,
                lng: body.lng ?? null,
                timestamp: cuando,
                source: "TRACK",
                eventType: body.eventType || "INTERNAL",
                confidence: confianza,
                reads: lecturas,
                snapshotUrl: body.snapshotUrl || null,
                bbox: caja ? JSON.stringify(caja) : null,
                estado: "ESTACIONADO",
                estDesde: cuando,
                estHasta: cuando,
            },
        });
        return NextResponse.json({
            ok: true, estado: "ESTACIONADO", id: abierta.id, nuevo: false, quieto: false,
            puerta: body.puerta || null,
        });
    }

    // ── Pasó por donde interesa, y se movió: si tenía una estadía abierta acá, arrancó.
    //
    // Este es el único caso en que el "se retiró" sale de una lectura y no del barrido:
    // el auto arrancó delante de la cámara y cruzó la línea. Se cierra en el acto en vez
    // de esperar a que venza.
    for (const abiertaPrev of await estadiasAbiertas(patente, body.deviceId || null)) {
        await cerrarEstadia(abiertaPrev as any).catch(() => { });
    }

    // Antirrebote. La pasarela ya consolida cada paso en una sola lectura; esto cubre dos
    // ráfagas encadenadas y las instalaciones viejas que mandan un aviso por cuadro.
    const ventanaSeg = Number(process.env.TRACKING_DEDUPE_SECONDS || 45);
    if (previo && previo.estado !== "ESTACIONADO"
        && cuando.getTime() - new Date(previo.timestamp).getTime() <= ventanaSeg * 1000) {
        const mejora = confianza != null && (previo.confidence ?? 0) < confianza;
        if (mejora) {
            await prisma.plateSighting.update({
                where: { id: previo.id },
                data: {
                    plate: patente,
                    confidence: confianza,
                    reads: lecturas ?? previo.reads,
                    snapshotUrl: body.snapshotUrl || previo.snapshotUrl,
                    ...(caja ? { bbox: JSON.stringify(caja) } : {}),
                },
            }).catch(() => { });
        }
        return NextResponse.json({
            ok: true,
            ignorado: "repetido",
            estado: "PASO",
            id: previo.id,
            plate: mejora ? patente : previo.plate,
            corregida: previo.plate !== patente,
        }, { status: 202 });
    }

    let { lat, lng } = body;
    if ((lat == null || lng == null) && body.deviceId) {
        const row = await prisma.setting.findUnique({ where: { key: "BARRIO_MAP" } });
        try {
            const cam = (JSON.parse(row?.value || "{}").cameras || []).find((c: any) => c.deviceId === body.deviceId);
            if (cam) { lat = cam.lat; lng = cam.lng; }
        } catch { }
    }

    // ── Trayecto: se engancha al último paso abierto de esa matrícula, o se abre uno.
    const desde = new Date(cuando.getTime() - VENTANA_TRAYECTO_MIN * 60 * 1000);
    let pass = await prisma.vehiclePass.findFirst({
        where: { plate: patente, endedAt: { gte: desde } },
        orderBy: { endedAt: "desc" },
    });
    if (pass) {
        if (cuando > pass.endedAt) {
            await prisma.vehiclePass.update({ where: { id: pass.id }, data: { endedAt: cuando } });
        }
    } else {
        pass = await prisma.vehiclePass.create({ data: { plate: patente, startedAt: cuando, endedAt: cuando } });
    }

    const creado = await prisma.plateSighting.create({
        data: {
            plate: patente,
            deviceId: body.deviceId || null,
            cameraName: body.cameraName || null,
            lat: lat ?? null,
            lng: lng ?? null,
            timestamp: cuando,
            source: "TRACK",
            eventType: body.eventType || "INTERNAL",
            decision: null,
            confidence: confianza,
            reads: lecturas,
            snapshotUrl: body.snapshotUrl || null,
            bbox: caja ? JSON.stringify(caja) : null,
            estado: "PASO",
            passId: pass.id,
        },
    });

    return NextResponse.json({ ok: true, estado: "PASO", id: creado.id, passId: pass.id });
}
