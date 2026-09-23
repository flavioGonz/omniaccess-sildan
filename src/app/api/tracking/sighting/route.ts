import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { franjaDe, nombrarOcupante } from "@/lib/ocupaciones";
import { lugarDelPunto } from "@/lib/franja";
import { funcionActiva } from "@/app/actions/funciones";
import {
    confirmarEstadia, cerrarEstadia, estadiasAbiertas,
    estadoDeEstadia, ESTADOS_DE_ESTADIA, VISTO,
} from "@/lib/estadias";
import { mismaChapa, pareceMatricula } from "@/lib/matriculas";
import {
    leerCaja, areaTipica, pareceChapa, area as areaDe, type Caja,
} from "@/lib/recuadros";

export const dynamic = "force-dynamic";

// Dos avistamientos de la misma matrícula separados por menos que esto son el mismo paso
// por el barrio. Más que esto, el auto se fue y volvió: es otro trayecto.
const VENTANA_TRAYECTO_MIN = Number(process.env.TRACKING_PASS_WINDOW_MIN || 10);

// Cuánto se puede haber corrido el recuadro de la chapa entre dos lecturas para seguir
// considerando que el vehículo no se movió. Es fracción del cuadro: 3% de 1600 px son
// unos 48 px, más que suficiente para absorber el temblor del detector y bastante menos
// que lo que se desplaza un auto andando, aunque vaya despacio.
const TOLERANCIA_QUIETO = Number(process.env.TRACKING_PARKED_TOLERANCE || 0.03);

/**
 * Cuánto se mira para atrás buscando el antecedente de esta lectura.
 *
 * Eran veinte minutos, y eso partía en pedazos al mismo auto. Un vehículo quieto solo se
 * relee cuando OTRO dispara una ráfaga; de madrugada en Calle 22 eso pasa cada veinte o
 * veinticinco minutos, así que la lectura siguiente del mismo auto caía fuera de la
 * ventana, no encontraba antecedente, y abría una estadía nueva. En el historial se veía
 * al mismo Peugeot como cuatro estacionamientos encadenados.
 *
 * La ventana tiene que ser más larga que el intervalo con que se relee un auto quieto, no
 * más corta. Noventa minutos cubre con holgura una calle tranquila y sigue siendo corto
 * frente a lo que tarda un auto en irse y volver.
 */
const CORTE_ESTADIA_MIN = Number(process.env.TRACKING_PARKED_GAP_MIN || 90);

/**
 * Cuánto mide una chapa en el cuadro de ESA cámara.
 *
 * No hay número fijo posible: una chapa ocupa lo que la distancia y el lente digan, y eso
 * cambia de cámara en cámara y de instalación en instalación. Así que la referencia se
 * saca de la propia cámara — la mediana del área de sus últimas lecturas — y lo único
 * configurable es cuánto se tolera desviarse.
 *
 * Se guarda en memoria unos minutos porque cambia muy despacio: mientras nadie mueva la
 * cámara, la chapa de un auto en la misma calle mide lo mismo hoy que mañana. Sin el
 * caché sería una consulta extra por cada lectura.
 *
 * La mediana y no el promedio: un recuadro enorme que se coló ya aceptado corre el
 * promedio lo suficiente como para dejar entrar al siguiente, y al siguiente.
 */
const REFERENCIA_MS = Number(process.env.TRACKING_BOX_CACHE_MS || 5 * 60 * 1000);
const referencias = new Map<string, { area: number | null; hasta: number }>();

async function referenciaDeCamara(deviceId: string | null): Promise<number | null> {
    const clave = deviceId || "(sin camara)";
    const guardada = referencias.get(clave);
    if (guardada && guardada.hasta > Date.now()) return guardada.area;

    const filas = await prisma.plateSighting.findMany({
        where: { deviceId, source: "TRACK", bbox: { not: null } },
        orderBy: { timestamp: "desc" },
        take: 120,
        select: { bbox: true },
    });
    const cajas = filas.map((f) => leerCaja(f.bbox)).filter((c): c is Caja => !!c);
    const area = areaTipica(cajas);
    referencias.set(clave, { area, hasta: Date.now() + REFERENCIA_MS });
    return area;
}

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

    /**
     * ¿Ese recuadro puede ser una matrícula?
     *
     * `pareceMatricula` ya filtró por la forma del TEXTO, y no alcanza: el barrio recibe
     * chapas de cualquier país, así que exigir un molde tiraría lecturas reales, y el
     * ruido que queda tiene forma de chapa. `PRGI790L` la tiene. Lo que no tiene es
     * tamaño de chapa: entró con el recuadro cuatro veces más ancho que cualquiera y
     * saliéndose por el borde izquierdo.
     *
     * Y no se puede filtrar por confianza, que es lo primero que uno probaría: medido
     * sobre el historial de un día, `1QQ3UP1` vino con 0.962 —la más alta de todas— y
     * `SQT3730`, un auto real leído en diez cuadros, con 0.550. El OCR está más seguro de
     * la basura que de las chapas de verdad.
     *
     * Así que se mira la geometría, que no depende del país ni del OCR.
     */
    if (caja) {
        const referencia = await referenciaDeCamara(body.deviceId || null);
        const veredicto = pareceChapa(caja, referencia);
        if (!veredicto.ok) {
            return NextResponse.json({
                ok: true,
                ignorado: veredicto.motivo,
                plate: patente,
                caja,
                // Va el area de referencia para que, si el filtro se come algo que no
                // debia, se pueda ver contra que se lo comparo en vez de adivinar.
                areaLeida: Number(areaDe(caja).toFixed(6)),
                areaTipica: referencia != null ? Number(referencia.toFixed(6)) : null,
            }, { status: 202 });
        }
    }

    /* Las estadías se pueden apagar. Cuando lo están, esta ruta hace lo que hacía antes de
       que existieran: registra pasadas y nada más. Ver src/lib/funciones.ts. */
    const estadias = await funcionActiva("LPR_ESTADIAS");

    // ── ¿Sigue ahí el mismo auto quieto?
    const desdeEstadia = new Date(cuando.getTime() - CORTE_ESTADIA_MIN * 60 * 1000);

    // Se traen las lecturas recientes de ESA cámara y el antecedente se elige por
    // parecido, no por matrícula exacta.
    //
    // Buscar por texto exacto partía en dos al mismo vehículo cuando el OCR cambiaba un
    // carácter entre dos ráfagas: el mismo auto quedó como DAF1168 y, dos segundos
    // después, como OAF1168. La agrupación de la pasarela no alcanza para esto porque
    // trabaja dentro de una ráfaga, y acá son dos.
    /**
     * Una estadía CERRADA no engancha con nada. Ya terminó.
     *
     * Esto faltaba, y hacía desaparecer autos del plano para siempre.
     *
     * El barrendero cierra una estadía cuando la cámara miró dos veces sin ver al auto.
     * Si el auto en realidad seguía ahí —de noche una chapa se lee mucho peor, y dos
     * lecturas fallidas seguidas no son raras— la fila queda cerrada igual. Y cuando el
     * auto se volvía a leer, esta búsqueda lo enganchaba con esa fila cerrada y la
     * actualizaba: estHasta avanzaba, reads subía, la hora se veía fresca... y estCerrada
     * seguía en true. El plano pide las estadías abiertas, así que ese auto no volvía a
     * aparecer nunca más, por más que la cámara lo siguiera viendo cada pocos minutos.
     *
     * Eso es exactamente lo que pasó con el auto de la Calle 21: figuraba ESTACIONADO, con
     * seis lecturas y la última recién, y el mapa mostraba un solo auto — el de la otra
     * cámara.
     *
     * Ahora una fila cerrada es historia y no se toca. Si el auto se vuelve a ver, empieza
     * una estadía nueva, que es lo honesto: el sistema lo dio por ido y lo volvió a
     * encontrar, y eso es lo que muestra. Las filas de PASO no se cierran nunca, así que
     * este filtro no cambia en nada cómo se agrupan las pasadas.
     */
    const recientes = await prisma.plateSighting.findMany({
        where: {
            deviceId: body.deviceId || null,
            source: "TRACK",
            estCerrada: false,
            timestamp: { gte: desdeEstadia, lte: cuando },
        },
        orderBy: { timestamp: "desc" },
        take: 150,
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
        ? recientes.find((f) => ESTADOS_DE_ESTADIA.includes(f.estado) && estaQuieto(caja, leerCaja(f.bbox))) || null
        : null;

    const previo = porChapa || porLugar;

    /*
     * La franja manda donde está dibujada.
     *
     * En una cámara con franja la estadía es del LUGAR y no de la chapa: la abre y la cierra
     * el barrido midiendo ocupación, y acá la lectura sólo hace una cosa — ponerle NOMBRE al
     * ocupante. Es la diferencia que arregla el caso de Calle 21, donde el mismo auto entró
     * al historial como SDM1707, SDH1707 y 5DH177 y salieron tres estadías: ahora son tres
     * lecturas del ocupante del mismo lugar, y se queda la de más confianza.
     *
     * Por eso la lectura se guarda sin `estDesde`/`estHasta`: es un avistamiento del
     * historial, no una estadía abierta. Dejarle fechas la convertiría en una estadía que
     * el barrido ya no mira —esas cámaras están excluidas— y que por lo tanto no cerraría
     * nunca.
     */
    /*
     * El motor de ocupación se puede apagar, y apagarlo tiene que apagar TAMBIÉN esta rama.
     *
     * La franja dibujada no es la que manda: la que manda es la función. Si quedara
     * mirando sólo el dibujo, apagar el motor dejaría las cámaras con franja entrando
     * igual por acá — que es la rama que NO abre estadía, porque da por sentado que la
     * ocupación la lleva el barrido. Con el barrido apagado eso significa que esas
     * cámaras no registrarían ninguna permanencia en ningún lado.
     *
     * Apagado, `franja` queda en null y la lectura sigue de largo hasta el criterio por
     * matrícula, que es el mismo camino que recorren las cámaras sin franja.
     */
    const franja = (body.deviceId && await funcionActiva("LPR_OCUPACION"))
        ? await franjaDe(body.deviceId)
        : null;
    if (franja && caja) {
        // El centro del recuadro de la chapa, que es el punto del que se sabe dónde cayó.
        const centro = { x: caja.x + caja.w / 2, y: caja.y + caja.h / 2 };
        const lugar = lugarDelPunto(franja.esquinas, franja.lugares, centro);
        const guardada = await prisma.plateSighting.create({
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
                bbox: JSON.stringify(caja),
                estado: lugar != null ? VISTO : "PASO",
            },
        });
        if (lugar != null) {
            await nombrarOcupante(body.deviceId!, lugar, patente, confianza ?? 0, guardada.id).catch(() => null);
        }
        return NextResponse.json({
            ok: true, estado: lugar != null ? "OCUPA" : "PASO", id: guardada.id,
            lugar: lugar != null ? lugar + 1 : null, franja: true,
        });
    }

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
    if (estadias && previo && (quieto || fueraDePuerta)) {
        const mejorFoto = confianza != null && (previo.confidence ?? 0) < confianza;
        /**
         * Una estadía consolidada renueva su foto en cada relectura.
         *
         * La regla de "la mejor foto" es la correcta mientras la estadía se está formando:
         * ahí lo que importa es quedarse con la lectura donde la chapa se ve mejor. Pero
         * una vez confirmada deja de servir y empieza a mentir. Un auto entró a las seis y
         * media de la tarde con 0,90 de confianza; a las diez de la noche seguía ahí y
         * ninguna relectura superó ese 0,90, así que la ficha mostraba la foto de las
         * 18:28 — pleno día, con sol— abajo del renglón "Hace 3m". La hora era cierta y
         * la foto también; juntas decían algo falso, que es la peor clase de error porque
         * no hay nada roto que se pueda encontrar.
         *
         * Y para quien mira el plano a las diez de la noche, la foto de las seis y media no
         * es sólo confusa: es inútil. Lo que quiere saber es si el auto sigue estando, y
         * eso sólo lo contesta la última imagen.
         *
         * No se pierde nada: la matrícula y su confianza quedan escritas en la fila y no
         * las toca una lectura peor. Lo único que cambia es cuál de todas las imágenes se
         * guarda, y pasa a ser la que corresponde a la hora que se muestra.
         */
        const fotoVencida = quieto && previo.estAvisado;
        const desdeCuando = quieto ? (previo.estDesde ?? previo.timestamp) : cuando;
        const actualizado = await prisma.plateSighting.update({
            where: { id: previo.id },
            data: {
                // El estado sale de cuanto lleva ahi, no de que se lo haya vuelto a ver.
                // Mientras no llegue al minimo es VISTO: se lo vio, nada mas.
                estado: estadoDeEstadia(desdeCuando, cuando),
                // Si esta lectura es mejor, manda su ortografía: la fila se queda con la
                // versión más segura de la matrícula y no con la primera que entró.
                ...(mejorFoto ? { plate: patente } : {}),
                estDesde: desdeCuando,
                estHasta: cuando,
                timestamp: cuando,
                confidence: mejorFoto ? confianza : previo.confidence,
                reads: mejorFoto ? (lecturas ?? previo.reads) : previo.reads,
                snapshotUrl: (mejorFoto || fotoVencida) ? (body.snapshotUrl || previo.snapshotUrl) : previo.snapshotUrl,
                ...(caja ? { bbox: JSON.stringify(caja) } : {}),
                // Si se movió, lo de antes dejó de valer: vuelve a estar por confirmarse.
                ...(quieto ? {} : { estAvisado: false }),
            },
        });
        const recienAvisado = quieto ? await confirmarEstadia(actualizado as any) : false;
        return NextResponse.json({
            ok: true, estado: actualizado.estado, id: actualizado.id, nuevo: recienAvisado,
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
        /*
         * Con las estadías apagadas esta lectura no se guarda, y eso es lo correcto: el
         * vehículo NO pasó por donde a esta cámara le interesa — anotarlo como pasada sería
         * inventar un cruce que no ocurrió — y de su permanencia no se quiere saber nada.
         */
        if (!estadias) {
            return NextResponse.json({ ok: true, estado: "IGNORADA", motivo: "las estadías están apagadas" });
        }
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
                // Una sola lectura no prueba ninguna permanencia: nace en VISTO y sube a
                // ESTACIONADO recien cuando una segunda lectura la sostenga en el tiempo.
                estado: VISTO,
                estDesde: cuando,
                estHasta: cuando,
            },
        });
        return NextResponse.json({
            ok: true, estado: VISTO, id: abierta.id, nuevo: false, quieto: false,
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
    if (previo && !ESTADOS_DE_ESTADIA.includes(previo.estado)
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
