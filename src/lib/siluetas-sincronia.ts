/**
 * Las siluetas del vivo, a la hora del video (13/11, Nico, con una captura: dos siluetas de persona
 * caminando por una calle donde el video no mostraba a nadie — «¿cómo mejoramos estos delays y
 * siluetas fantasmas? … que no vayan a destiempo»).
 *
 * Por qué iban a destiempo. Son dos caminos distintos desde la misma cámara:
 *  · El análisis: un ffmpeg lee el canal sin búfer y cada cuadro va a omni-vision. Llega al
 *    navegador unas décimas de segundo después de que pasó.
 *  · El video: el navegador lo reproduce con un colchón. Arranca con cerca de un segundo, y cada
 *    tirón de la red lo atrasa un poco más; el vivo no lo recuperaba nunca (ver relojDeAtraso).
 * Las siluetas se dibujaban apenas llegaban: adelantadas al video por todo ese colchón. Con 3 o 4
 * segundos, la silueta de alguien que camina va varios metros delante de él (o sola, si la persona
 * todavía no entró al cuadro del video).
 *
 * Qué se hace. Cada análisis trae la hora del servidor en que se tomó su cuadro. Acá se guardan
 * unos segundos de análisis y se muestra, en cada momento, el que corresponde a lo que el video
 * está mostrando: el de hace tanto como atrasa el video (relojDeAtraso). Si para ese instante no hay análisis (se cortó, o el canal de
 * análisis se quedó atrás) no se dibuja nada: una silueta vieja sobre una calle vacía es peor que
 * ninguna.
 *
 * Los relojes del servidor y del navegador no coinciden: el desfase se estima con cada mensaje
 * (hora de llegada menos hora de envío) y se toma el menor de los últimos, que es el que menos
 * demora de red tuvo.
 *
 * Sin pantalla ni red: lo usan el vivo de la ficha y las pruebas. No cuesta nada al servidor: es
 * mostrar más tarde lo mismo que ya llegaba.
 */

/** Cuánto se guarda: más que el mayor atraso que se le tolera al video. */
export const COLA_MS = 12_000;
/**
 * Cuánto antes de su hora se muestra cada análisis. Dos cosas lo piden: el sello de hora se pone
 * cuando el cuadro ya pasó por ffmpeg (una décima después de que el video lo recibió), y la silueta
 * no salta a su lugar nuevo sino que se desliza hasta él (CapaAnalisis, 150 ms).
 */
export const ADELANTO_MS = 180;
/** Sin un análisis a menos de esto del instante que muestra el video, no se dibuja nada. */
export const HUECO_MS = 700;
/** Cuántos mensajes se miran para estimar el desfase entre los relojes. */
const MUESTRAS_DESFASE = 40;

export type Elegido<T> = { dato: T; /** Cuánto más viejo es el análisis que el instante del video (ms; negativo = más nuevo). */ distancia: number };

export function colaDeSiluetas<T>() {
    let cola: { t: number; dato: T }[] = [];
    const desfases: number[] = [];
    let desfase: number | null = null;
    return {
        /**
         * Llegó un análisis. `t`: hora del servidor en que se tomó el cuadro; `ms`: lo que tardó en
         * salir desde entonces (análisis incluido); `ahora`: hora de este navegador al recibirlo.
         */
        llegar(t: number, ms: number, dato: T, ahora: number) {
            desfases.push(ahora - (t + ms));
            if (desfases.length > MUESTRAS_DESFASE) desfases.shift();
            desfase = Math.min(...desfases);
            cola.push({ t, dato });
            const viejo = t - COLA_MS;
            if (cola[0].t < viejo) cola = cola.filter((x) => x.t >= viejo);
        },
        /**
         * Qué análisis corresponde a lo que el video muestra ahora. `atrasoMs`: el colchón del video
         * (lo recibido y todavía no mostrado); null si no se sabe (todavía no hay video: se ve la
         * foto): se muestra lo último, como antes. Infinity = el video está detenido (cargando,
         * reconectando o esperando datos): no se dibuja nada sobre un cuadro quieto.
         */
        elegir(ahora: number, atrasoMs: number | null): Elegido<T> | null {
            if (!cola.length || desfase == null || atrasoMs === Infinity) return null;
            // El instante que muestra el video, en la hora del servidor.
            const objetivo = ahora - desfase - Math.max(0, Math.min(COLA_MS - 1000, atrasoMs ?? 0)) + ADELANTO_MS;
            // El último análisis que no es posterior a ese instante (la cola está en orden de llegada).
            let i = cola.length - 1;
            while (i >= 0 && cola[i].t > objetivo) i--;
            // El video va por delante de todo lo analizado (raro: el análisis se atrasó): vale el más viejo, si está cerca.
            const x = i >= 0 ? cola[i] : cola[0];
            const distancia = objetivo - x.t;
            return Math.abs(distancia) <= HUECO_MS ? { dato: x.dato, distancia } : null;
        },
        vaciar() { cola = []; },
        get largo() { return cola.length; },
        get desfase() { return desfase; },
    };
}

/**
 * Cuánto atrasa el video respecto del presente.
 *
 * Lo natural era preguntárselo al <video>: lo que recibió y todavía no mostró (`buffered` menos
 * `currentTime`). No sirve (medido el 13/11 en Chromium con un canal de prueba que dibuja la hora):
 * con el video 1,1 s atrás decía 2,3; con 0,1 s atrás, 2,2. Por eso el «saltar al presente si
 * atrasa más de 6 s» que tenía el vivo no se disparaba nunca, y lo que el video perdía en cada
 * tirón de la red no se recuperaba.
 *
 * Lo que sí dice la verdad es cada cuadro que se PRESENTA (requestVideoFrameCallback): su hora
 * dentro del video y la hora de pared en que se mostró. El video en vivo empieza en cero con su
 * primer cuadro, así que un cuadro de la hora `v` «tocaba» mostrarse a `primerDato + v`, donde
 * `primerDato` es cuándo llegó ese primer cuadro al navegador: lo que se pasó de ahí es el atraso.
 * Vale mientras la cámara mande a ritmo real, y se corrige sola si su reloj anda apenas más rápido
 * que el de la PC (el atraso nunca es negativo).
 *
 * `primerDato` no lo dice el <video> (medido: avisa que tiene datos recién cuando empieza a
 * mostrar, que es justo el atraso que se quiere medir). Lo mide `primerDatoDeVideo`, más abajo,
 * leyendo el arranque del mismo canal por su cuenta. Sin él no hay atraso total: sólo lo que sobra.
 *
 * Dos números salen de acá:
 *  · `atrasoMs`: el atraso total. Es con lo que se sincronizan las siluetas.
 *  · `sobraMs`: cuánto de ese atraso está de más, contra el atraso con que el video arrancó. Es lo
 *    ÚNICO que se recupera acelerando. El de arranque no se toca: una parte es el colchón que el
 *    navegador junta antes de empezar, y gastarlo es dejar al video sin datos — un navegador sin
 *    datos se detiene a juntar de nuevo (medido: acelerar hasta agotarlo dio una parada de más de
 *    un segundo cada diez, y el atraso volvía a donde estaba); la otra parte es del camino (la
 *    cámara, la VPN, el servidor) y no se recupera reproduciendo más rápido.
 *    Lo que sí sobra es lo que deja un tirón de la red: el video se queda sin datos, se detiene, y
 *    cuando llegan todos juntos sigue desde donde estaba, ahora más atrás. Eso se recupera, porque
 *    está todo guardado. Si en cambio el video se quedó sin datos MIENTRAS se lo aceleraba, es que
 *    se le gastó el colchón: el nivel al que retoma pasa a ser el de arranque.
 */
/** Sin un cuadro nuevo en este tiempo, el video está detenido. */
export const VIDEO_DETENIDO_MS = 600;
/** Con menos que esto de sobra, una parada mientras se acelera es por haber gastado el colchón. */
const CASI_NADA_MS = 300;
/** Cuántos cuadros se miran, al arrancar o retomar, para fijar el colchón de arranque (el menor atraso entre ellos). */
const CUADROS_DE_ARRANQUE = 12;

export function relojDeAtraso() {
    let base: number | null = null, primerDato: number | null = null, atraso: number | null = null, cuadroAl = 0;
    let arranque: number | null = null, vistos = 0, ritmo = 1;
    return {
        /** A qué ritmo se está reproduciendo (lo avisa quien lo cambia). */
        ritmo(r: number) { ritmo = r; },
        /** A qué hora de pared llegó el primer cuadro del video (ver primerDatoDeVideo). */
        abrio(ahoraMs: number) {
            if (primerDato != null) return;
            primerDato = ahoraMs;
            // Ya había cuadros medidos contra una base provisoria: todo se corre lo mismo, y lo que sobra no cambia.
            if (base != null) { const d = base - ahoraMs; if (d > 0) { if (atraso != null) atraso += d; if (arranque != null) arranque += d; base = ahoraMs; } }
        },
        /** Se presentó un cuadro. `presentadoMs`: hora de pared (performance.now); `videoS`: su hora dentro del video. */
        cuadro(presentadoMs: number, videoS: number) {
            const resta = presentadoMs - videoS * 1000;
            // Sin saber cuándo llegó el primer dato, la base es este primer cuadro: sirve para `sobraMs`, no para el total.
            if (base == null) base = primerDato ?? resta;
            // Un cuadro mostrado «antes de tiempo» no existe: es que la base estaba corrida (o el reloj de la
            // cámara adelanta). Se corre la base, y con ella el nivel de arranque: lo que sobra no cambia.
            if (resta < base) { if (arranque != null) arranque += base - resta; base = resta; }
            // Se quedó sin datos mientras se lo aceleraba Y ya casi no sobraba nada: se le gastó el colchón. El
            // nivel al que retoma es el nuevo arranque. (Si todavía sobraba, la parada fue de la red: se sigue persiguiendo.)
            if (cuadroAl && presentadoMs - cuadroAl > VIDEO_DETENIDO_MS && ritmo > 1 && arranque != null && atraso != null && atraso - arranque < CASI_NADA_MS) { arranque = null; vistos = 0; }
            atraso = resta - base;
            if (vistos < CUADROS_DE_ARRANQUE) { vistos++; arranque = arranque == null ? atraso : Math.min(arranque, atraso); }
            cuadroAl = presentadoMs;
        },
        /** El atraso total en ms. null = no se sabe (sin cuadros todavía, o sin la hora del primer dato); Infinity = el video está detenido. */
        atrasoMs(ahoraMs: number): number | null {
            if (atraso == null) return null;
            if (ahoraMs - cuadroAl > VIDEO_DETENIDO_MS) return Infinity;
            return primerDato == null ? null : atraso;
        },
        /** Lo que atrasa de más contra su colchón de arranque, en ms. null = no se sabe todavía (o está detenido). */
        sobraMs(ahoraMs: number): number | null {
            if (atraso == null || arranque == null || vistos < CUADROS_DE_ARRANQUE || ahoraMs - cuadroAl > VIDEO_DETENIDO_MS) return null;
            return Math.max(0, Math.round(atraso - arranque));
        },
        /** Se aceleró un buen rato y no bajó: ese atraso no era recuperable (cambió el camino). Pasa a ser el de arranque. */
        aceptar() { if (atraso != null) { arranque = atraso; vistos = CUADROS_DE_ARRANQUE; } },
        /** Conexión nueva: lo anterior no vale. */
        reiniciar() { base = null; primerDato = null; atraso = null; cuadroAl = 0; arranque = null; vistos = 0; ritmo = 1; },
    };
}

/**
 * El video, al día: el ritmo de reproducción que toca según cuánto atrasa DE MÁS (`sobraMs`).
 *
 * Por qué acelerar: antes el vivo no recuperaba nunca lo que perdía en cada tirón de la red. Un
 * 12 % más rápido no se nota y recupera un segundo cada ocho; con varios segundos de más se va a
 * una vez y media (se nota, pero dura poco); y con más de `RECONECTAR_DESDE_S` no vale la pena
 * perseguirlo: se abre el video de nuevo, que arranca en el presente (el último cuadro queda a la
 * vista mientras tanto).
 */
export const NORMAL_HASTA_S = 0.15;
export const ACELERAR_DESDE_S = 0.5;
export const APURAR_DESDE_S = 3;
export const RECONECTAR_DESDE_S = 8;
export const RITMO_AL_DIA = 1.12;
export const RITMO_APURADO = 1.5;

/**
 * Cuándo llega el primer cuadro de un canal en vivo: se lee el mismo canal por separado (go2rtc le
 * manda a cada pedido desde el próximo cuadro completo, así que dos pedidos hechos juntos reciben
 * el mismo) y se mira cuándo aparece la primera caja `moof` del MP4, que es el primer cuadro. Ahí
 * se corta: son unos KB. Devuelve la hora de `ahora()` en ese momento, o null si no se pudo.
 */
export async function primerDatoDeVideo(url: string, signal: AbortSignal, ahora: () => number = () => performance.now()): Promise<number | null> {
    const corte = new AbortController();
    const cortar = () => corte.abort();
    signal.addEventListener("abort", cortar);
    try {
        const r = await fetch(url, { signal: corte.signal, cache: "no-store" });
        if (!r.ok || !r.body) return null;
        const lector = r.body.getReader();
        // Las cajas del MP4 van una tras otra: 4 bytes de tamaño y 4 de nombre. Se saltan hasta dar con `moof`.
        let falta = 0, cabeza: number[] = [];
        for (;;) {
            const { done, value } = await lector.read();
            if (done || !value) return null;
            let i = 0;
            while (i < value.length) {
                if (falta > 0) { const n = Math.min(falta, value.length - i); falta -= n; i += n; continue; }
                cabeza.push(value[i++]);
                if (cabeza.length < 8) continue;
                const tam = ((cabeza[0] << 24) | (cabeza[1] << 16) | (cabeza[2] << 8) | cabeza[3]) >>> 0;
                const nombre = String.fromCharCode(cabeza[4], cabeza[5], cabeza[6], cabeza[7]);
                if (nombre === "moof") return ahora();
                // Un tamaño que no puede ser (0 o 1 = «hasta el final» o de 64 bits): no es lo que se esperaba.
                if (tam < 8) return null;
                falta = tam - 8; cabeza = [];
            }
        }
    } catch { return null; } finally { signal.removeEventListener("abort", cortar); cortar(); }
}

/** El ritmo que toca, dado lo que atrasa de más y el ritmo que lleva. null = abrir de nuevo. */
export function ritmoParaAtraso(sobraS: number, ritmoActual: number): number | null {
    if (sobraS > RECONECTAR_DESDE_S) return null;
    if (sobraS > APURAR_DESDE_S) return RITMO_APURADO;
    if (sobraS > ACELERAR_DESDE_S) return RITMO_AL_DIA;
    if (sobraS < NORMAL_HASTA_S) return 1;
    // En el medio se sigue acelerado si se venía acelerando: sin esto, el ritmo cambiaría en cada medición alrededor del borde.
    return ritmoActual > 1 ? RITMO_AL_DIA : 1;
}
