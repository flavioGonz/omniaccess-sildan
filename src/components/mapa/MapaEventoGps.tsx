"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { entornoEventoGps, type PuntoGps } from "@/app/actions/gps";

/**
 * Dónde pasó un evento de un rastreador, y por dónde venía: la «captura» de una alarma de GPS.
 *
 * En Gestión de alarmas cada caso abre con su foto, porque la foto es lo que deja decidir si es
 * real. Un rastreador no tiene cámara. Lo que deja decidir acá es el lugar y el movimiento: un
 * «le cortaron la alimentación» en el taller donde lo están arreglando no es lo mismo que en una
 * ruta a las tres de la mañana, y «dejó de reportar» después de entrar a un estacionamiento no es
 * lo mismo que en movimiento a 60 km/h.
 *
 * Se dibuja el punto del evento y el tramo de diez minutos antes y diez después (lo de antes
 * lleno, lo de después más tenue: a dónde siguió también dice algo). Sin marcadores de imagen:
 * los de Leaflet se bajan de un CDN ajeno.
 */

function Encuadrar({ puntos, centro }: { puntos: [number, number][]; centro: [number, number] }) {
    const mapa = useMap();
    useEffect(() => {
        if (puntos.length > 1) mapa.fitBounds(L.latLngBounds([...puntos, centro]), { padding: [28, 28], maxZoom: 18 });
        else mapa.setView(centro, 17);
    }, [puntos, centro, mapa]);
    return null;
}

export default function MapaEventoGps({ imei, cuando, lat, lon, tono = "#ef4444", alto = 260 }: {
    imei: string; cuando: string; lat: number; lon: number;
    /** El color del punto: el tono del evento. */
    tono?: string;
    alto?: number;
}) {
    /* El tramo se guarda con de quién es: al cambiar de evento el anterior deja de valer solo, sin
       tener que vaciarlo a mano (y sin dibujar un instante el recorrido de otra alarma). */
    const clave = `${imei}|${cuando}`;
    const [traido, setTraido] = useState<{ clave: string; puntos: PuntoGps[] } | null>(null);
    useEffect(() => {
        let vivo = true;
        entornoEventoGps(imei, cuando, 10).then((puntos) => { if (vivo) setTraido({ clave: `${imei}|${cuando}`, puntos }); }).catch(() => { /* queda el punto, que es lo que importa */ });
        return () => { vivo = false; };
    }, [imei, cuando]);
    const entorno = useMemo(() => (traido && traido.clave === clave ? traido.puntos : []), [traido, clave]);
    const centro = useMemo<[number, number]>(() => [lat, lon], [lat, lon]);
    const antes = useMemo(() => entorno.filter((p) => p.cuando <= cuando).map((p) => [p.lat, p.lon] as [number, number]), [entorno, cuando]);
    const despues = useMemo(() => entorno.filter((p) => p.cuando >= cuando).map((p) => [p.lat, p.lon] as [number, number]), [entorno, cuando]);
    const todos = useMemo(() => [...antes, ...despues], [antes, despues]);

    return (
        <div className="relative w-full overflow-hidden bg-black" style={{ height: alto }}>
            <MapContainer key={clave} center={centro} zoom={17} className="h-full w-full" zoomControl={false} attributionControl={false} scrollWheelZoom={false}>
                <TileLayer attribution="&copy; Esri" maxNativeZoom={19} maxZoom={21} url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                <Encuadrar puntos={todos} centro={centro} />
                {despues.length > 1 && <Polyline positions={despues} pathOptions={{ color: "#fff", weight: 3, opacity: 0.55, dashArray: "2 7", lineCap: "round" }} />}
                {antes.length > 1 && (
                    <>
                        <Polyline positions={antes} pathOptions={{ color: "#0a0e14", weight: 7, opacity: 0.55, lineCap: "round", lineJoin: "round" }} />
                        <Polyline positions={antes} pathOptions={{ color: "#fbbf24", weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }} />
                    </>
                )}
                <CircleMarker center={centro} radius={15} pathOptions={{ color: tono, weight: 2, fillColor: tono, fillOpacity: 0.22 }} />
                <CircleMarker center={centro} radius={6} pathOptions={{ color: "#fff", weight: 3, fillColor: tono, fillOpacity: 1 }} />
            </MapContainer>
            {entorno.length > 1 && (
                <div className="pointer-events-none absolute left-2 bottom-2 z-[500] flex items-center gap-3 rounded-[6px] bg-black/65 px-2 py-1 text-[10.5px] font-semibold text-white">
                    <span className="inline-flex items-center gap-1.5"><span className="h-[3px] w-4 rounded bg-amber-400" /> por dónde venía</span>
                    {despues.length > 1 && <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dotted border-white/80" /> a dónde siguió</span>}
                </div>
            )}
        </div>
    );
}
