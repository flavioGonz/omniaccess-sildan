"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, Tooltip as LTooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, MapPin, Pentagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBarrioMap, type BarrioMapData } from "@/app/actions/barriomap";

/**
 * El mapa del barrio, chico y de sólo lectura, para elegir un lote.
 *
 * No es `BarrioMap` recortado. Ese pesa mil trescientas líneas porque además dibuja,
 * edita, muestra el vivo de las cámaras y la posición de los guardias — todo eso adentro de
 * un cajón sería cargar medio sistema para contestar una pregunta de un clic: *¿cuál de
 * estas casas es ésta?*.
 *
 * Lo que sí comparte es la FUENTE: los mismos lotes del mismo ajuste. No hay una segunda
 * copia del dibujo, que es como terminan divergiendo dos mapas que deberían ser uno.
 *
 * Los lotes ya tomados por otra unidad se muestran igual, apagados y con su nombre. Es a
 * propósito: esconderlos dejaría huecos sin explicación en el plano, y el caso de "estaba
 * asignada al lote equivocado" es justamente el que hay que poder arreglar desde acá.
 */

const CENTRO_POR_DEFECTO: [number, number] = [-34.9011, -56.1645];

/** Leaflet mide mal si el contenedor todavía no existía al montarse. */
function Acomodar({ cuando }: { cuando: unknown }) {
    const map = useMap();
    useEffect(() => {
        const t = setTimeout(() => map.invalidateSize(), 120);
        return () => clearTimeout(t);
    }, [map, cuando]);
    return null;
}

/** Encuadra el lote elegido, o todo el barrio si no hay ninguno. */
function Encuadrar({ puntos }: { puntos: [number, number][][] }) {
    const map = useMap();
    useEffect(() => {
        const todos = puntos.flat();
        if (!todos.length) return;
        try {
            map.fitBounds(todos as any, { padding: [28, 28], maxZoom: 19, animate: false });
        } catch { /* un solo punto o coordenadas rotas: se deja el encuadre que había */ }
    }, [map, JSON.stringify(puntos)]);
    return null;
}

export type LoteDelMapa = {
    id: string;
    label: string;
    unitId?: string | null;
    parkingSlotId?: string | null;
    points: [number, number][];
};

export function MapaLotes({ unidadId, loteElegido, alElegir, nombreDeUnidad, alto = 300 }: {
    /** La unidad que se está editando: su lote se dibuja destacado. */
    unidadId?: string | null;
    /** El lote elegido en este momento, que puede no ser el guardado todavía. */
    loteElegido?: string | null;
    alElegir: (lote: LoteDelMapa | null) => void;
    /** Para poder decir «ya es Torre A» sobre un lote tomado. */
    nombreDeUnidad?: (unitId: string) => string | undefined;
    alto?: number;
}) {
    const [mapa, setMapa] = useState<BarrioMapData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let vivo = true;
        getBarrioMap()
            .then((d) => { if (vivo) { setMapa(d); setError(null); } })
            .catch((e: any) => { if (vivo) setError(e?.message || "No se pudo traer el mapa del barrio."); });
        return () => { vivo = false; };
    }, []);

    const lotes = useMemo<LoteDelMapa[]>(() => (mapa?.lots || []) as LoteDelMapa[], [mapa]);
    const elegido = lotes.find((l) => l.id === loteElegido);

    /* Se encuadra el lote elegido; si no hay, todo lo dibujado; si no hay nada, el barrio. */
    const aEncuadrar = elegido ? [elegido.points] : lotes.map((l) => l.points);

    if (error) {
        return (
            <div style={{ height: alto }}
                className="rounded-lg border border-border bg-muted/40 flex flex-col items-center justify-center gap-1 text-center px-6">
                <MapPin size={20} className="text-muted-foreground/50" />
                <p className="text-[12.5px] font-semibold">No se pudo traer el mapa</p>
                <p className="text-[11.5px] text-muted-foreground">{error}</p>
            </div>
        );
    }

    if (!mapa) {
        return (
            <div style={{ height: alto }}
                className="rounded-lg border border-border bg-muted/40 flex items-center justify-center">
                <Loader2 size={18} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!lotes.length) {
        return (
            <div style={{ height: alto }}
                className="rounded-lg border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-1.5 text-center px-8">
                <Pentagon size={20} className="text-muted-foreground/45" />
                <p className="text-[12.5px] font-semibold">Todavía no hay lotes dibujados</p>
                <p className="text-[11.5px] text-muted-foreground max-w-xs">
                    Los contornos de las casas se dibujan una vez sobre el plano del barrio, en Mapa → Editar mapa.
                    Después se eligen desde acá.
                </p>
                <a href="/admin/mapa" target="_blank" rel="noopener noreferrer"
                    className="text-[12px] font-semibold tono-accion hover:underline mt-1">
                    Ir a dibujarlos
                </a>
            </div>
        );
    }

    return (
        <div style={{ height: alto }} className="rounded-lg overflow-hidden border border-border relative">
            <MapContainer
                center={(mapa.center as [number, number]) || CENTRO_POR_DEFECTO}
                zoom={mapa.zoom || 17}
                zoomControl={false}
                attributionControl={false}
                style={{ height: "100%", width: "100%", background: "var(--muted)" }}>

                <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    maxZoom={21} maxNativeZoom={19} />
                <Acomodar cuando={alto} />
                <Encuadrar puntos={aEncuadrar} />

                {lotes.map((lo) => {
                    const esEste = lo.id === loteElegido;
                    const deOtra = !!lo.unitId && lo.unitId !== unidadId;
                    const nombreOtra = deOtra && nombreDeUnidad ? nombreDeUnidad(lo.unitId!) : undefined;
                    return (
                        <Polygon key={lo.id} positions={lo.points}
                            pathOptions={{
                                color: esEste ? "#f59e0b" : deOtra ? "#64748b" : "#38bdf8",
                                weight: esEste ? 3 : 2,
                                fillColor: esEste ? "#f59e0b" : deOtra ? "#64748b" : "#38bdf8",
                                fillOpacity: esEste ? 0.34 : deOtra ? 0.1 : 0.16,
                            }}
                            eventHandlers={{
                                /* Volver a tocar el lote elegido lo suelta. Es la única
                                   forma de quitar la asignación sin buscar otro botón. */
                                click: () => alElegir(esEste ? null : lo),
                            }}>
                            <LTooltip direction="center" sticky>
                                <span className="font-semibold">{lo.label}</span>
                                {nombreOtra && <span className="opacity-70"> · ya es {nombreOtra}</span>}
                                {esEste && <span className="opacity-70"> · tocá otra vez para soltarlo</span>}
                            </LTooltip>
                        </Polygon>
                    );
                })}
            </MapContainer>

            <div className={cn("absolute bottom-2 left-2 right-2 z-[500] px-3 py-1.5 rounded-lg",
                "bg-background/92 backdrop-blur-sm border border-border text-[11.5px] pointer-events-none")}>
                {elegido
                    ? <span><span className="font-semibold">{elegido.label}</span> · tocá el contorno otra vez para soltarlo</span>
                    : <span className="text-muted-foreground">Tocá el contorno de esta propiedad en el plano</span>}
            </div>
        </div>
    );
}
