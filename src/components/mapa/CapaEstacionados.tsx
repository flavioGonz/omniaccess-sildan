"use client";

import { Marker } from "react-leaflet";
import L from "leaflet";
import {
    autoHtml, lapso, pendienteHtml,
    type AutoParado, type AutoUbicado, type CamaraPendiente,
} from "@/components/mapa/estacionados";

/**
 * Los autos parados sobre el plano, en la vista de arriba.
 *
 * Esta capa ya no pide nada ni calcula nada: recibe la lista ya ubicada y la dibuja. El
 * pedido, el socket y la cuenta de dónde va cada auto están en `useEstacionados`, que usan
 * tanto esta vista como la 3D — si no, serían dos suscripciones a los mismos avisos y dos
 * listas que tarde o temprano dicen cosas distintas.
 *
 * **El cono no se dibuja acá.** Se probó mostrarlo —primero siempre, después al señalar un
 * auto— y las dos veces sobró: en la vista normal el plano es para mirar el barrio, y un
 * triángulo celeste sobre cada calle compite con lo único que importa, que son los autos.
 * El cono aparece sólo mientras se APUNTA la cámara, que pasa en modo edición y lo dibuja
 * el mapa, no esta capa.
 */

export type { AutoParado } from "@/components/mapa/estacionados";

export type SeñalSinRumbo = {
    deviceId: string; camara: string | null; autos: AutoParado[]; x: number; y: number;
} | null;

export type SeñalAuto = {
    auto: AutoParado; metros: number; desvio: number; x: number; y: number;
} | null;

export function CapaEstacionados({ ubicados, pendientes, alTocar, alSeñalar, alGirar, alSeñalarAuto, visible = true }: {
    ubicados: AutoUbicado[];
    pendientes: CamaraPendiente[];
    alTocar?: (auto: AutoParado) => void;
    /** El puntero sobre una cámara sin rumbo. El padre dibuja la tarjeta. */
    alSeñalar?: (s: SeñalSinRumbo) => void;
    /** Llevar a girar esa cámara. */
    alGirar?: (deviceId: string) => void;
    /** El clic sobre un auto parado. El padre dibuja la ficha con su captura. */
    alSeñalarAuto?: (s: SeñalAuto) => void;
    visible?: boolean;
}) {
    if (!visible || (!ubicados.length && !pendientes.length)) return null;

    return (
        <>
            {/*
              * El aviso NO va en un tooltip de Leaflet.
              *
              * El de Leaflet es una caja negra sin estilo que se estira con el texto: con
              * tres renglones de explicación ocupaba media pantalla y tapaba justo el plano
              * que uno vino a mirar. Y sobre todo, no se puede tocar — así que lo único que
              * podía hacer era DECIR los pasos para girar la cámara en vez de ofrecerlos.
              */}
            {pendientes.map(({ cam, autos: suyos }) => (
                <Marker key={`sinrumbo-${cam.deviceId}`} position={[cam.lat, cam.lng]}
                    icon={L.divIcon({
                        className: "bg-transparent border-0",
                        html: pendienteHtml(suyos.length),
                        iconSize: [70, 26], iconAnchor: [35, -6],
                    })}
                    eventHandlers={{
                        mouseover: (e: any) => alSeñalar?.({
                            deviceId: cam.deviceId, camara: suyos[0]?.camara || null, autos: suyos,
                            x: e.originalEvent?.clientX ?? 0, y: e.originalEvent?.clientY ?? 0,
                        }),
                        mousemove: (e: any) => alSeñalar?.({
                            deviceId: cam.deviceId, camara: suyos[0]?.camara || null, autos: suyos,
                            x: e.originalEvent?.clientX ?? 0, y: e.originalEvent?.clientY ?? 0,
                        }),
                        mouseout: () => alSeñalar?.(null),
                        click: () => alGirar?.(cam.deviceId),
                    }} />
            ))}

            {ubicados.map((u) => (
                /* Al CLIC y no al pasar por encima: la ficha trae la captura, y una foto
                   que aparece y desaparece sola mientras uno recorre el plano es un
                   parpadeo, no un dato. Abrir es una decisión. */
                <Marker key={u.auto.id} position={[u.lat, u.lng]}
                    icon={L.divIcon({
                        className: "bg-transparent border-0",
                        html: autoHtml(u.auto.plate, u.auto.conocida, lapso(u.auto.desde)),
                        iconSize: [46, 46], iconAnchor: [23, 23],
                    })}
                    eventHandlers={{
                        click: (e: any) => {
                            alTocar?.(u.auto);
                            alSeñalarAuto?.({
                                auto: u.auto, metros: u.metros, desvio: u.desvio,
                                x: e.originalEvent?.clientX ?? 0, y: e.originalEvent?.clientY ?? 0,
                            });
                        },
                    }} />
            ))}
        </>
    );
}
