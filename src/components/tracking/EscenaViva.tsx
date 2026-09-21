"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { montarVivo } from "@/lib/vivo";

/**
 * La escena: el video en vivo de la cámara, encajado sin bandas negras.
 *
 * ## Por qué video y no fotos
 *
 * El calibrador sacaba una foto cada 900 ms y **se la mandaba al lector** para poder
 * mostrarla. O sea que mirar la calle costaba una inferencia por segundo, en la misma GPU
 * que tiene que leer las matrículas de verdad — y el lector ya se cayó tres veces por
 * exceso de trabajo concurrente.
 *
 * El flujo de go2rtc ya existe y lo usan el mapa y el monitor. Mirar pasa a costar lo que
 * cuesta decodificar un video, que es CPU y no GPU, y **la GPU sólo se toca cuando alguien
 * pide leer**. Es el cambio que más rinde de todo el rediseño, y no se ve.
 *
 * ## Sin bandas negras
 *
 * `object-contain` deja franjas negras arriba y abajo, y encima obliga a calcular dónde
 * quedó la imagen adentro de la caja para poder dibujar encima. Acá el elemento de video
 * **es** la imagen: se le da el tamaño exacto que corresponde a su relación de aspecto
 * dentro del espacio disponible. No hay banda porque no hay nada alrededor del video que
 * sea video, y el overlay va sobre la misma caja sin conversiones.
 *
 * ## Rendimiento
 *
 * La medida se recalcula sólo cuando cambia el contenedor o llegan los metadatos del
 * flujo, nunca en cada cuadro. Y el video es `muted` + `playsInline`, que es lo que deja
 * que reproduzca solo sin pedir permiso.
 */

export type Caja = { ancho: number; alto: number };

export function EscenaViva({
    deviceId, children, alMedir, className,
}: {
    deviceId: string;
    /** El overlay. Recibe una caja del tamaño exacto del video. */
    children?: React.ReactNode;
    alMedir?: (c: Caja) => void;
    className?: string;
}) {
    const hueco = useRef<HTMLDivElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const [caja, setCaja] = useState<Caja>({ ancho: 0, alto: 0 });
    const [relacion, setRelacion] = useState(16 / 9);
    const [estado, setEstado] = useState<"cargando" | "vivo" | "sin señal">("cargando");

    useEffect(() => {
        const v = video.current;
        if (!v) return;
        setEstado("cargando");
        const alDatos = () => {
            if (v.videoWidth && v.videoHeight) setRelacion(v.videoWidth / v.videoHeight);
            setEstado("vivo");
        };
        const alError = () => setEstado("sin señal");
        v.addEventListener("loadedmetadata", alDatos);
        v.addEventListener("error", alError);
        const cortar = montarVivo(v, deviceId);
        return () => {
            v.removeEventListener("loadedmetadata", alDatos);
            v.removeEventListener("error", alError);
            cortar();
        };
    }, [deviceId]);

    const medir = useCallback(() => {
        const el = hueco.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        if (!width || !height) return;
        // Contain, pero calculado acá para dárselo al elemento: así el video ocupa
        // exactamente su caja y no queda nada negro alrededor suyo.
        const porAncho = width / relacion <= height;
        const c = porAncho
            ? { ancho: width, alto: width / relacion }
            : { ancho: height * relacion, alto: height };
        setCaja(c);
        alMedir?.(c);
    }, [relacion, alMedir]);

    useEffect(() => {
        medir();
        const el = hueco.current;
        if (!el) return;
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => ro.disconnect();
    }, [medir]);

    return (
        <div ref={hueco} className={"relative w-full h-full grid place-items-center " + (className || "")}>
            <div className="relative" style={{ width: caja.ancho || "100%", height: caja.alto || "100%" }}>
                <video
                    ref={video}
                    muted playsInline autoPlay
                    className="absolute inset-0 w-full h-full rounded-[10px] bg-muted"
                />
                {children}

                {estado !== "vivo" && (
                    <div className="absolute inset-0 grid place-items-center rounded-[10px] bg-muted/70 backdrop-blur-sm">
                        <span className="text-[13px] text-muted-foreground">
                            {estado === "cargando" ? "Conectando con la cámara…" : "No llega video de esta cámara."}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
