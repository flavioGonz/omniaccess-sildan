"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pista } from "@/components/ui/pista";
import { calzar } from "@/components/tracking/Calibracion";
import {
    aprenderVacio, borrarFranja, guardarFranja, leerFranja, medirFranja, tomarCuadro, type Medicion,
} from "@/app/actions/franja";

/**
 * Dibujar la franja de estacionamiento de una cámara.
 *
 * ## Por qué una franja y no una zona rectangular
 *
 * Una zona dice *dónde mirar*. La franja dice *dónde caben los autos*, que es otra cosa y
 * es la que permite contestar la pregunta que importa: no "¿esta chapa sigue ahí?" —
 * imposible de probar con lecturas, y el origen de los autos fantasma del motor anterior —
 * sino "¿este lugar está ocupado?", que se contesta comparando un polígono que no se mueve
 * nunca contra cómo se ve ese mismo polígono vacío.
 *
 * ## Las cuatro esquinas, y por qué no son un rectángulo
 *
 * Se dibuja el cordón: dos puntos sobre un lado de la franja y dos sobre el otro. Las
 * celdas se reparten entre los dos lados, así que **se achican solas hacia el fondo**,
 * igual que los autos. Un rectángulo dividido en partes iguales daría lugares del mismo
 * tamaño sobre una calle que se ve en diagonal, y los del fondo se comerían tres autos.
 *
 * Es el mismo error que ya se pagó una vez con la caja del vehículo deducida por regla de
 * tres: un rectángulo plano sobre una escena en perspectiva no ubica, ubica mal.
 *
 * ## El paso que no se puede saltear
 *
 * **Enseñarle cómo se ve vacía.** Es el único momento en que hace falta una persona, y no
 * se puede deducir: desde acá no hay manera de saber si ese auto que se ve estaba o no
 * estaba. Mientras no esté aprendida, la franja no mide y lo dice — un motor que igual
 * contesta algo cuando no sabe es exactamente lo que se está reemplazando.
 */

type Punto = { x: number; y: number };
type Esq = [Punto, Punto, Punto, Punto];

/**
 * Una franja de arranque sobre la mitad baja del cuadro, que es donde cae la calzada en una
 * cámara de calle. No es un valor mágico: es un punto de partida para mover, y mover cuatro
 * puntos es mucho menos trabajo que ponerlos de cero.
 */
const FRANJA_INICIAL: Esq = [
    { x: 0.08, y: 0.62 }, { x: 0.92, y: 0.52 },
    { x: 0.92, y: 0.78 }, { x: 0.08, y: 0.95 },
];

const LUGARES_POR_DEFECTO = 6;

const mezclar = (p: Punto, q: Punto, t: number): Punto => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });

/** La misma fórmula que el servidor. Repetida a propósito: el dibujo no puede esperar un viaje. */
function celdaDe(e: Esq, i: number, n: number): Punto[] {
    const punto = (u: number, v: number) => {
        const t = (i + u) / n;
        return mezclar(mezclar(e[0], e[1], t), mezclar(e[3], e[2], t), v);
    };
    return [punto(0, 0), punto(1, 0), punto(1, 1), punto(0, 1)];
}

export function Franja({ deviceId, hayRtsp }: { deviceId: string; hayRtsp: boolean }) {
    const [esquinas, setEsquinas] = useState<Esq>(FRANJA_INICIAL);
    const [lugares, setLugares] = useState(LUGARES_POR_DEFECTO);
    const [activa, setActiva] = useState(true);
    const [existe, setExiste] = useState(false);
    const [aprendida, setAprendida] = useState<string | null>(null);
    const [medicion, setMedicion] = useState<Medicion | null>(null);
    const [ocupado, setOcupado] = useState<"" | "guardando" | "midiendo" | "aprendiendo" | "tomando">("");
    const [aviso, setAviso] = useState<string | null>(null);

    const caja = useRef<HTMLDivElement>(null);
    const [marco, setMarco] = useState({ ancho: 0, alto: 0 });
    const [nativo, setNativo] = useState({ w: 16, h: 9 });
    const arrastrando = useRef<number | null>(null);

    useEffect(() => {
        leerFranja(deviceId).then((f) => {
            if (!f) return;
            setExiste(true);
            if (f.esquinas) setEsquinas(f.esquinas as Esq);
            setLugares(f.lugares);
            setActiva(f.activa);
            setAprendida(f.aprendida);
        }).catch(() => { });
    }, [deviceId]);

    useEffect(() => {
        const medir = () => {
            const r = caja.current?.getBoundingClientRect();
            if (r) setMarco({ ancho: r.width, alto: r.height });
        };
        medir();
        window.addEventListener("resize", medir);
        return () => window.removeEventListener("resize", medir);
    }, [medicion?.foto]);

    // El cuadro llega encajado dentro del recuadro (object-contain), así que el dibujo tiene
    // que ir sobre la imagen y no sobre la caja: sin esto la franja queda corrida hacia las
    // bandas negras, y el corrimiento sólo se nota cuando ya está mal calibrada.
    const vista = useMemo(
        () => calzar(marco.ancho, marco.alto, nativo.w, nativo.h),
        [marco.ancho, marco.alto, nativo.w, nativo.h],
    );

    useEffect(() => {
        const aFraccion = (ev: PointerEvent) => {
            const r = caja.current?.getBoundingClientRect();
            if (!r || !vista.w || !vista.h) return null;
            return {
                x: Math.min(1, Math.max(0, (ev.clientX - r.left - vista.left) / vista.w)),
                y: Math.min(1, Math.max(0, (ev.clientY - r.top - vista.top) / vista.h)),
            };
        };
        const mover = (ev: PointerEvent) => {
            const i = arrastrando.current;
            if (i == null) return;
            const p = aFraccion(ev);
            if (!p) return;
            setEsquinas((prev) => {
                const q = [...prev] as Esq;
                q[i] = p;
                return q;
            });
        };
        const soltar = () => { arrastrando.current = null; };
        window.addEventListener("pointermove", mover);
        window.addEventListener("pointerup", soltar);
        return () => {
            window.removeEventListener("pointermove", mover);
            window.removeEventListener("pointerup", soltar);
        };
    }, [vista.left, vista.top, vista.w, vista.h]);

    const celdas = useMemo(
        () => Array.from({ length: lugares }, (_, i) => celdaDe(esquinas, i, lugares)),
        [esquinas, lugares],
    );

    const enPx = (p: Punto) => (vista.left + p.x * vista.w) + "," + (vista.top + p.y * vista.h);

    async function conCarga(que: "guardando" | "midiendo" | "aprendiendo" | "tomando", fn: () => Promise<void>) {
        setOcupado(que); setAviso(null);
        try { await fn(); } finally { setOcupado(""); }
    }

    /* Se pide solo al abrir: sin la foto no se puede dibujar, y hacérsela pedir a mano era
       justamente el círculo que dejaba trabado al operador. */
    useEffect(() => {
        if (hayRtsp && !medicion) tomar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hayRtsp]);

    const tomar = () => conCarga("tomando", async () => {
        const r = await tomarCuadro(deviceId);
        setMedicion(r);
        if (!r.ok && r.error) setAviso(r.error);
    });

    const guardar = () => conCarga("guardando", async () => {
        const r = await guardarFranja(deviceId, { esquinas, lugares, activa });
        setExiste(true);
        setAprendida(r.aprendida);
        if (r.reaprender && !r.aprendida) {
            setAviso("La franja cambió de forma, así que hay que volver a enseñarle cómo se ve vacía.");
        }
    });

    const aprender = () => conCarga("aprendiendo", async () => {
        const r = await aprenderVacio(deviceId);
        setMedicion(r);
        if (r.ok) setAprendida(r.aprendida ?? null);
        else setAviso(r.error || "No se pudo.");
    });

    const medir = () => conCarga("midiendo", async () => {
        const r = await medirFranja(deviceId);
        setMedicion(r);
        if (!r.ok) setAviso(r.error || "No se pudo.");
    });

    const estados = medicion?.ok ? medicion.celdas : undefined;
    const ocupadas = estados ? estados.filter((c) => c.ocupado).length : null;

    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-[13px] font-semibold">Franja de estacionamiento</div>
                    <p className="text-[12px] text-muted-foreground max-w-prose">
                        Dibujá dónde estacionan los autos y decí cuántos entran. El sistema mide si
                        cada lugar está ocupado, en vez de deducirlo de las lecturas de matrícula —
                        que es lo que marcaba autos donde no había ninguno.
                    </p>
                </div>
                <label className="flex items-center gap-2 text-[12px] shrink-0">
                    <input
                        type="checkbox" checked={activa}
                        onChange={(e) => setActiva(e.target.checked)}
                        className="accent-[var(--accion)]"
                    />
                    Activa
                </label>
            </div>

            <div
                ref={caja}
                className="relative w-full aspect-video rounded-[10px] overflow-hidden bg-muted select-none"
            >
                {medicion?.foto ? (
                    <img
                        src={medicion.foto} alt="" draggable={false}
                        className="absolute inset-0 w-full h-full object-contain"
                        onLoad={(e) => setNativo({
                            w: e.currentTarget.naturalWidth || 16,
                            h: e.currentTarget.naturalHeight || 9,
                        })}
                    />
                ) : (
                    <div className="absolute inset-0 grid place-items-center text-[12px] text-muted-foreground px-6 text-center">
                        {!hayRtsp
                            ? "Este equipo no tiene RTSP configurado, así que no hay de dónde sacar un cuadro."
                            : ocupado === "tomando"
                                ? "Pidiéndole un cuadro a la cámara…"
                                : "No llegó el cuadro. Probá de nuevo con «Tomar cuadro»."}
                    </div>
                )}

                <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
                    {celdas.map((q, i) => {
                        const est = estados ? estados[i] : undefined;
                        return (
                            <g key={i}>
                                <polygon
                                    points={q.map(enPx).join(" ")}
                                    fill={est?.ocupado ? "color-mix(in oklab, var(--info) 42%, transparent)" : "transparent"}
                                    stroke="var(--accion-en-oscuro)"
                                    strokeWidth={1.5}
                                />
                                <text
                                    x={(q[0].x + q[2].x) / 2 * vista.w + vista.left}
                                    y={(q[0].y + q[2].y) / 2 * vista.h + vista.top}
                                    textAnchor="middle" dominantBaseline="middle"
                                    className="fill-white text-[11px] font-semibold"
                                    style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.55)", strokeWidth: 3 }}
                                >
                                    {i + 1}
                                </text>
                            </g>
                        );
                    })}
                </svg>

                {esquinas.map((p, i) => (
                    <button
                        key={i}
                        type="button"
                        onPointerDown={() => { arrastrando.current = i; }}
                        aria-label={"Esquina " + (i + 1)}
                        className="absolute size-4 -ml-2 -mt-2 rounded-full border-2 border-white cursor-grab active:cursor-grabbing"
                        style={{
                            left: vista.left + p.x * vista.w,
                            top: vista.top + p.y * vista.h,
                            background: "var(--accion-en-oscuro)",
                        }}
                    />
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Pista
                    titulo="Cuántos autos entran"
                    texto="No se puede deducir de la imagen: no hay escala. Lo sabe quien mira la calle, y es el único número que hay que poner."
                >
                    <div className="flex items-center gap-1.5 text-[12px]">
                        <span className="text-muted-foreground">Lugares</span>
                        <Button size="icon-sm" variant="outline" onClick={() => setLugares((n) => Math.max(1, n - 1))}>−</Button>
                        <span className="w-6 text-center tabular-nums font-semibold">{lugares}</span>
                        <Button size="icon-sm" variant="outline" onClick={() => setLugares((n) => Math.min(40, n + 1))}>+</Button>
                    </div>
                </Pista>

                <div className="flex-1" />

                <Button size="sm" variant="outline" disabled={!hayRtsp || !!ocupado} onClick={tomar}>
                    {ocupado === "tomando" ? "Tomando…" : "Tomar cuadro"}
                </Button>
                <Button size="sm" variant="outline" disabled={!hayRtsp || !existe || !!ocupado} onClick={medir}>
                    {ocupado === "midiendo" ? "Mirando…" : "Medir ahora"}
                </Button>
                <Pista
                    titulo="Con la calle vacía"
                    texto="Mirá la cámara y apretá esto sólo cuando no haya ningún auto en la franja. Es la referencia contra la que se compara todo lo demás."
                >
                    <Button size="sm" variant="outline" disabled={!hayRtsp || !existe || !!ocupado} onClick={aprender}>
                        {ocupado === "aprendiendo" ? "Aprendiendo…" : "Está vacía ahora"}
                    </Button>
                </Pista>
                <Button size="sm" disabled={!!ocupado} onClick={guardar}>
                    {ocupado === "guardando" ? "Guardando…" : "Guardar franja"}
                </Button>
                {existe && (
                    <Button
                        size="sm" variant="ghost" disabled={!!ocupado}
                        onClick={() => { borrarFranja(deviceId).then(() => { setExiste(false); setAprendida(null); setMedicion(null); }); }}
                    >
                        Quitar
                    </Button>
                )}
            </div>

            {/* El estado se dice siempre, incluso cuando es "no sé": una franja que no mide y
                no lo dice es indistinguible de una que mide y no encuentra a nadie. */}
            <div className="text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1">
                {aprendida ? (
                    <span className="chip-bien">Sabe cómo se ve vacía</span>
                ) : (
                    <span className="chip-aviso">Falta enseñarle cómo se ve vacía — no mide nada todavía</span>
                )}
                {ocupadas != null && (
                    <span className="text-muted-foreground tabular-nums">
                        {ocupadas} de {lugares} ocupados en la última mirada
                    </span>
                )}
            </div>

            {aviso && <p className="text-[12px] tono-aviso">{aviso}</p>}

            {estados && (
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                    {estados.map((c) => (
                        <li key={c.lugar} className="flex items-baseline gap-2">
                            <span className="tabular-nums text-muted-foreground w-4">{c.lugar + 1}</span>
                            <span className={c.ocupado ? "font-semibold" : "text-muted-foreground"}>
                                {c.ocupado ? "ocupado" : "libre"}
                            </span>
                            <span className="text-muted-foreground">— {c.motivo}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
