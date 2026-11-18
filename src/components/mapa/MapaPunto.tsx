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

            {/*
             * El pin, clavado en el centro y sin capturar el dedo: el mapa pasa por debajo.
             *
             * `z-[1000]` no es por las dudas: los paneles de Leaflet van de 200 a 700 y sus
             * controles a 800, así que un pin sin z-index queda DEBAJO de las baldosas y se ve a
             * pedazos —un cuadradito azul corrido, que es exactamente lo que se veía—. Y va
             * dibujado en SVG en vez de con tres divs: la punta tiene que caer en el píxel que se
             * está eligiendo, y eso con cajas apiladas es aproximado.
             */}
            <div className="pointer-events-none absolute inset-0 z-[1000] grid place-items-center">
                <svg width="34" height="46" viewBox="0 0 34 46" fill="none" aria-hidden
                    /* La punta, abajo del todo, cae justo en el centro del mapa. */
                    style={{ transform: "translateY(-19px)", filter: "drop-shadow(0 3px 6px rgba(0,0,0,.55))" }}>
                    <path d="M17 45.5C17 45.5 32 26.8 32 17 32 8.7 25.3 2 17 2S2 8.7 2 17c0 9.8 15 28.5 15 28.5z"
                        fill="var(--accion)" stroke="#ffffff" strokeWidth="2.5" strokeLinejoin="round" />
                    <circle cx="17" cy="17" r="5.4" fill="#ffffff" />
                </svg>
            </div>

            {!soloVer && (
                <p className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-center text-[12px] font-semibold text-white">
                    Movelo hasta tu casa
                </p>
            )}
        </div>
    );
}
