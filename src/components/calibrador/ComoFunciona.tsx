"use client";

import { AlertTriangle, Camera, Check, HelpCircle, Minus, RefreshCw, Wrench } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { cn } from "@/lib/utils";
import { useEstadoIntrusion } from "@/components/devices/EstadoIntrusion";

/**
 * «Así va a funcionar»: el disparo, el filtro y la foto contados en el orden en que pasan (26/11).
 *
 * Nico: «debés dejar claro cómo está configurado el disparo, si cruza una línea, si también entra
 * a una zona, qué pasa; cómo OmniAccess toma la foto, qué fotos toma OmniVision; que quede claro
 * qué va a pasar». El panel tenía cada pieza por separado (modo, carriles, ajustes) y no decía cómo
 * se encadenan, que es justo lo que confunde: la línea de DISPARO es de la cámara y sólo despierta
 * la lectura; las líneas de CRUCE, las zonas y los carriles son de OmniAccess y deciden qué lectura
 * cuenta. Se arma con lo que está en pantalla, guardado o no.
 *
 * Y cuando el disparo lo da la cámara, el worker escucha su flujo de eventos (alertStream) directo:
 * para eso la regla tiene que «avisar al centro». El servidor de alarmas es el camino del resto de
 * los avisos (intrusión). Las dos cosas se leen en vivo de la cámara (sólo lectura) y se arreglan al
 * lado (agrega, no borra otros servidores: lib/intrusion-estado). Medido en Delta el 26/11: las dos
 * estaban bien y aun así no llegaba ningún cruce — la cadena entera no garantiza que la regla dispare.
 */
export type ResumenLectura = {
    modo: "escena" | "zona" | "linea" | "omnivision";
    fps: number; confianza: number; rebote: number; recorte: boolean;
    activa: boolean;
    carriles: { nombre: string; sentido: "entra" | "sale" | "ambos" }[];
    lineas: { nombre: string; sentido: "ab" | "ba" | "ambos" }[];
    zonas: { nombre: string }[];
    /** La línea de disparo de la cámara y su sentido. */
    lineaCamara: "any" | "left-right" | "right-left" | null;
    /** Si la cámara es de acceso Entrada/Salida (los carriles marcan el sentido de la lectura). */
    marcaSentido: boolean;
};

/** Las constantes del worker (tracking-worker.js): la ráfaga mira 0,8 s antes y 1,2 s después. */
const ANTES_S = 0.8, DESPUES_S = 1.2, CUADROS_MAX = 8;

const lista = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;

export function ComoFunciona({ r, deviceId, activo }: { r: ResumenLectura; deviceId: string; activo: boolean }) {
    const deCamara = r.modo === "linea" || r.modo === "zona";
    const hayGeo = r.activa && (r.carriles.length + r.lineas.length + r.zonas.length) > 0;

    const disparo = r.modo === "omnivision"
        ? "OmniVision ya analiza esta cámara buscando vehículos. Cuando abre la pista de un auto, moto o camión, se pide la lectura. Sombras, ramas y autos estacionados no la despiertan."
        : r.modo === "linea"
            ? `La cámara vigila su línea de disparo${r.lineaCamara === "left-right" ? " (sólo de izquierda a derecha)" : r.lineaCamara === "right-left" ? " (sólo de derecha a izquierda)" : ""}. Cuando un vehículo la cruza, la cámara lo avisa por su flujo de eventos —OmniAccess lo escucha directo— y en ese instante se pide la lectura.`
            : r.modo === "zona"
                ? "La cámara vigila su zona —el Recorte azul; sin recorte, todo el cuadro—. Mientras haya un vehículo adentro lo va avisando por su flujo de eventos, y con cada aviso se pide una lectura: un auto quieto vuelve a disparar (el rebote lo frena)."
                : "OmniAccess compara los cuadros del video y, cuando la imagen cambia más que la sensibilidad, pide la lectura. Anda con cualquier cámara, pero sombras y ramas también disparan: conviene un buen recorte.";

    const rafaga = `OmniAccess toma del video (no de la cámara) los cuadros de ${ANTES_S.toString().replace(".", ",")} s antes a ${DESPUES_S.toString().replace(".", ",")} s después del disparo, hasta ${CUADROS_MAX} a ${r.fps} por segundo${r.recorte ? ", recortados al recuadro azul" : ""}, y se los pasa de a uno al lector de matrículas en la GPU. La chapa se vota entre los cuadros: una vista en varios vale más que una vista en uno.`;

    const filtro: string[] = [];
    if (!hayGeo) filtro.push(r.activa ? "No hay nada dibujado: cuenta cualquier chapa del cuadro." : "Lo dibujado está apagado: cuenta cualquier chapa del cuadro.");
    else {
        if (r.carriles.length) filtro.push(`Primero los carriles (${lista(r.carriles.map((c) => c.nombre))}). Una chapa dentro de un carril en el sentido de su flecha cuenta por ese carril${r.marcaSentido ? " y marca la entrada o la salida" : ""}. Si va de contramano, se sigue mirando lo demás; si nada más la toma, se descarta.`);
        if (r.lineas.length) filtro.push(`${r.carriles.length ? "Después" : "Primero"} las líneas de cruce (${lista(r.lineas.map((l) => l.nombre))}). Cuenta la chapa que pasa cerca de la línea en su sentido.${r.carriles.length ? " Una línea dibujada dentro de un carril casi nunca decide: el carril la toma antes." : ""}`);
        if (r.zonas.length) filtro.push(`${r.carriles.length || r.lineas.length ? "Al final" : "Primero"} las zonas (${lista(r.zonas.map((z) => z.nombre))}). Cuenta la chapa que está adentro, vaya para donde vaya.`);
        filtro.push("Una chapa que cumple dos cosas (en una zona y cruzando una línea) cuenta una sola vez, por la primera que la toma. Si ninguna la toma, queda «fuera de lo dibujado» y no se registra.");
    }

    const foto = `La foto que queda es el cuadro de la ráfaga donde mejor se leyó la chapa, con su recuadro y el recorrido. Debajo de ${Math.round(r.confianza * 100)} % no se registra.${r.rebote ? ` La misma chapa en el mismo carril, zona o línea dentro de ${r.rebote} s es el mismo auto: no se repite.` : ""}`;

    return (
        <div className="space-y-3">
            <ol className="space-y-2.5">
                <Paso n={1} titulo="Qué despierta la lectura" texto={disparo} />
                <Paso n={2} titulo="Qué fotos se miran" texto={rafaga} />
                <Paso n={3} titulo="Qué lectura cuenta" texto={filtro} />
                <Paso n={4} titulo="Qué queda guardado" texto={foto} />
            </ol>
            {r.modo !== "omnivision" && (
                <p className="rounded-[10px] bg-foreground/[0.04] px-3 py-2 text-[11px] leading-snug text-foreground/55">
                    <b className="text-foreground/75">La línea de disparo no es una línea de cruce.</b> La blanca es de la cámara y sólo avisa que pasó algo. Las rosas, las zonas y los carriles son de OmniAccess y deciden qué lectura cuenta.
                </p>
            )}
            {deCamara && <p className="text-[11px] leading-snug text-foreground/55">Si la cámara se queda muda mucho tiempo con el video vivo (del orden de una hora), OmniAccess pasa solo a «por cambio de imagen» para no quedar ciego. Que lo haga es señal de que la regla de la cámara no está avisando.</p>}
            {deCamara && <AvisoDeLaCamara deviceId={deviceId} activo={activo} modo={r.modo as "linea" | "zona"} />}
        </div>
    );
}

function Paso({ n, titulo, texto }: { n: number; titulo: string; texto: string | string[] }) {
    return (
        <li className="flex gap-2.5">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accion)_18%,transparent)] text-[10.5px] font-bold tabular-nums text-[var(--accion)]">{n}</span>
            <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-foreground">{titulo}</span>
                {Array.isArray(texto)
                    ? texto.map((t, i) => <span key={i} className="mt-1 block text-[11.5px] leading-snug text-foreground/60 first:mt-0">{t}</span>)
                    : <span className="block text-[11.5px] leading-snug text-foreground/60">{texto}</span>}
            </span>
        </li>
    );
}

const ICONO = { ok: { I: Check, tono: "chip-bien" }, falta: { I: AlertTriangle, tono: "chip-mal" }, "no-aplica": { I: Minus, tono: "chip-quieto" }, "sin-dato": { I: HelpCircle, tono: "chip-aviso" } } as const;

/**
 * Que el aviso de la cámara llegue. Se mira sólo cuando el disparo es de la cámara: sin regla, o con
 * una regla que no avisa al centro, la cámara detecta y no se entera nadie, y el lector no lee nunca.
 */
function AvisoDeLaCamara({ deviceId, activo, modo }: { deviceId: string; activo: boolean; modo: "linea" | "zona" }) {
    const ctl = useEstadoIntrusion(activo ? deviceId : null);
    const { estado, cargando, arreglando, recargar, arreglar } = ctl;
    const pasos = (estado?.pasos || []).filter((p) => p.clave === "servidor" || p.clave === "centro" || p.clave === "reglas");
    const arreglables = pasos.filter((p) => p.estado === "falta" && (p.arreglo === "servidor" || p.arreglo === "centro"));
    const regla = modo === "linea" ? estado?.lineas?.length : estado?.zonas?.length;
    return (
        <div className="rounded-[10px] border border-foreground/10 p-3">
            <div className="mb-2 flex items-center gap-2">
                <Camera size={14} className="text-foreground/50" />
                <span className="text-[12px] font-semibold text-foreground">¿Llegan los avisos de la cámara?</span>
                <button type="button" onClick={recargar} disabled={cargando} title="Volver a leer la cámara" className="ml-auto grid h-6 w-6 place-items-center rounded-full text-foreground/50 hover:bg-foreground/[0.07] hover:text-foreground">
                    {cargando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                </button>
            </div>
            {!estado ? <p className="text-[11px] text-foreground/45">{cargando ? "Leyendo la cámara…" : "Sin leer todavía."}</p>
                : !estado.ok && estado.error ? <p className="text-[11px] text-foreground/55">{estado.error}</p>
                    : (
                        <ul className="space-y-1.5">
                            {pasos.map((p) => {
                                const { I, tono } = ICONO[p.estado];
                                return (
                                    <li key={p.clave} className="flex items-start gap-2">
                                        <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full", tono)}><I size={10} /></span>
                                        <span className="min-w-0 text-[11.5px] leading-snug"><b className="font-semibold text-foreground/85">{p.titulo}.</b> <span className="text-foreground/55">{p.detalle}</span></span>
                                    </li>
                                );
                            })}
                            {estado.ok && !regla && <li className="text-[11px] leading-snug text-foreground/55">La cámara no tiene {modo === "linea" ? "línea" : "zona"} dibujada: dibujala con «Disparo» y guardá.</li>}
                        </ul>
                    )}
            {arreglables.length > 0 && (
                <button type="button" onClick={() => arreglar()} disabled={arreglando}
                    className="mt-2.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] bg-[var(--accion)] text-[12px] font-semibold text-white disabled:opacity-60">
                    {arreglando ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />} Arreglar en la cámara
                </button>
            )}
            <p className="mt-2 text-[10.5px] leading-snug text-foreground/40">Para disparar la lectura OmniAccess escucha la cámara directo: lo imprescindible es que la regla avise al centro. El servidor de alarmas lleva los demás avisos (intrusión) y se deja configurado igual. Arreglar agrega lo que falte; no borra otros servidores.</p>
        </div>
    );
}
