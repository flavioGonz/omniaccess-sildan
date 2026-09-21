"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calzar } from "@/components/tracking/Calibracion";
import { useFranja } from "./useFranja";
import { FranjaLienzo } from "./FranjaLienzo";
import { FranjaPanel } from "./FranjaPanel";

/**
 * La franja en la ficha del equipo: el cuadro y los controles, uno debajo del otro.
 *
 * Es una composición y nada más. El estado vive en `useFranja`, el dibujo en
 * `FranjaLienzo` y los controles en `FranjaPanel`, porque los mismos tres pedazos se usan
 * en el calibrador con otra disposición — ahí el dibujo va sobre la escena grande y los
 * controles en la barra lateral. Tener una sola copia de cada cosa es lo que evita que la
 * franja se comporte distinto según desde dónde se la haya dibujado.
 */
export function Franja({ deviceId, hayRtsp }: { deviceId: string; hayRtsp: boolean }) {
    const franja = useFranja(deviceId, hayRtsp);
    const { medicion, ocupado, tomar } = franja;

    const caja = useRef<HTMLDivElement>(null);
    const [marco, setMarco] = useState({ ancho: 0, alto: 0 });
    const [nativo, setNativo] = useState({ w: 16, h: 9 });

    useEffect(() => {
        const medir = () => {
            const r = caja.current?.getBoundingClientRect();
            if (r) setMarco({ ancho: r.width, alto: r.height });
        };
        medir();
        window.addEventListener("resize", medir);
        return () => window.removeEventListener("resize", medir);
    }, [medicion?.foto]);

    /* Se pide solo al abrir: sin la foto no se puede dibujar, y hacérsela pedir a mano era
       el círculo que dejaba trabado al operador — el lienzo decía "tomá un cuadro" y no
       existía el botón que lo tomaba. */
    useEffect(() => {
        if (hayRtsp && !medicion) tomar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hayRtsp]);

    const encuadre = useMemo(
        () => calzar(marco.ancho, marco.alto, nativo.w, nativo.h),
        [marco.ancho, marco.alto, nativo.w, nativo.h],
    );

    return (
        <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground max-w-prose">
                Dibujá dónde estacionan los autos y decí cuántos entran. El sistema mide si cada
                lugar está ocupado, en vez de deducirlo de las lecturas de matrícula — que es lo
                que marcaba autos donde no había ninguno.
            </p>

            <div ref={caja} className="relative w-full aspect-video rounded-[10px] overflow-hidden bg-muted select-none">
                {medicion?.foto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={medicion.foto} alt="" draggable={false}
                        className="absolute inset-0 w-full h-full object-contain"
                        onLoad={(e) => setNativo({
                            w: e.currentTarget.naturalWidth || 16,
                            h: e.currentTarget.naturalHeight || 9,
                        })} />
                ) : (
                    <div className="absolute inset-0 grid place-items-center text-[12px] text-muted-foreground px-6 text-center">
                        {!hayRtsp
                            ? "Este equipo no tiene RTSP configurado, así que no hay de dónde sacar un cuadro."
                            : ocupado === "tomando"
                                ? "Pidiéndole un cuadro a la cámara…"
                                : "No llegó el cuadro. Probá de nuevo con «Tomar cuadro»."}
                    </div>
                )}
                <FranjaLienzo franja={franja} encuadre={encuadre} />
            </div>

            <FranjaPanel franja={franja} />
        </div>
    );
}
