"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Un punto en el mapa: elegirlo en el teléfono, o mirarlo.
 *
 * No reusa `components/LocationPicker` a propósito: ese pone un marcador de Leaflet que hay que
 * tocar o arrastrar, y las imágenes del marcador las trae de unpkg.com. Las dos cosas están mal
 * acá — el dedo tapa justo el punto que está marcando, y una página pública del barrio no debería
 * depender de un CDN ajeno para dibujar un pin.
 *
 * Entonces el pin **no se mueve: se mueve el mapa debajo**, con el pin clavado en el centro. Es el
 * gesto que la gente ya conoce de pedir un auto o una comida, se hace con el pulgar sin tapar
 * nada, y el punto sale de `map.getCenter()` al terminar de arrastrar.
 *
 * Satélite y no calles: alguien reconoce el techo de su casa antes que el nombre de una calle
 * interna que capaz no está dibujada.
 */

/** El barrio entra entero a este zoom; al marcar se acerca a ver los techos. */
const ZOOM_LEJOS = 16;
const ZOOM_CERCA = 19;

function AlMover({ alSoltar }: { alSoltar: (lat: number, lng: number) => void }) {
    useMapEvents({
        moveend(e) { const c = e.target.getCenter(); alSoltar(c.lat, c.lng); },
    });
    return null;
}

/** Centrar el mapa cuando el punto cambió desde afuera (el botón de «usar mi ubicación»). */
function Seguir({ punto }: { punto: [number, number] | null }) {
    const map = useMap();
    const ultimo = useRef<string>("");
    useEffect(() => {
        if (!punto) return;
        const clave = punto.join(",");
        if (clave === ultimo.current) return;
        ultimo.current = clave;
        map.setView(punto, Math.max(map.getZoom(), ZOOM_CERCA), { animate: true });
    }, [punto, map]);
    return null;
}

export default function MapaPunto({ punto, centro, alElegir, soloVer, alto = 280 }: {
    punto: [number, number] | null;
    /** Dónde abrir cuando todavía no hay punto: el centro del mapa del barrio. */
    centro: [number, number];
    alElegir?: (lat: number, lng: number) => void;
    /** Mirar y nada más: es lo que necesita la bandeja del censo para ver dónde marcó cada uno. */
    soloVer?: boolean;
    alto?: number;
}) {
    // Sin guardia de montaje: esta pieza entra por `dynamic(..., { ssr: false })`, así que acá
    // ya hay ventana. La guardia que se usa habitualmente con Leaflet sobra y además dispara un
    // render en cascada.
    return (
        <div className="relative w-full overflow-hidden rounded-[10px] border border-border" style={{ height: alto }}>
            <MapContainer center={punto || centro} zoom={punto ? ZOOM_CERCA : ZOOM_LEJOS} className="h-full w-full"
                zoomControl={false} attributionControl={false} scrollWheelZoom={false}
                dragging={!soloVer} doubleClickZoom={!soloVer} touchZoom={!soloVer} keyboard={!soloVer}>
                <TileLayer attribution="&copy; Esri" maxNativeZoom={19} maxZoom={21}
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                {alElegir && !soloVer && <AlMover alSoltar={alElegir} />}
                <Seguir punto={punto} />
            </MapContainer>

            {/* El pin, clavado en el centro y sin capturar el dedo: el mapa pasa por debajo. */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="-mt-5 flex flex-col items-center">
                    <div className="h-8 w-8 rounded-full border-[3px] border-white bg-[var(--accion)] shadow-[0_4px_14px_rgba(0,0,0,.5)]" />
                    <div className="h-4 w-[3px] bg-white/90" />
                    <div className="h-1.5 w-1.5 rounded-full bg-white/90" />
                </div>
            </div>

            {!soloVer && (
                <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-center text-[12px] font-semibold text-white">
                    Movelo hasta tu casa
                </p>
            )}
        </div>
    );
}
