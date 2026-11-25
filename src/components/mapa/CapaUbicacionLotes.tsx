"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CircleMarker, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import { sileo as toast } from "sileo";
import { tomarUbicacionDelCenso, ubicacionesDeLotes, type UbicacionDeLote } from "@/app/actions/administraciones";

/**
 * Los lotes del padrón en el mapa, con su nombre en su lugar, y lo que marcó cada vecino en el censo
 * cuando no coincide (25/11).
 *
 * Nico: «los usuarios en el censo definen la posición GPS; ese punto, que es la ubicación del lote,
 * debe figurar como el nombre del lote en el mapa, como ya tenemos los polígonos… debemos poder tomar
 * esa posición definida en el censo como válida en el mapa».
 *
 *   · El nombre del lote va en su ubicación (la del croquis calibrado, o la que se tomó del censo o
 *     se corrigió a mano). Sólo de cerca —desde el zoom 17— y sólo lo que está en pantalla: son más de
 *     cuatrocientos.
 *   · Lo que marcó el vecino, si cae a más de una casa de distancia, es un punto celeste unido al lote
 *     con una línea punteada. Tocarlo dice a cuánto está y ofrece «Tomar la del censo».
 */
const ZOOM_NOMBRES = 17;
const icono = (texto: string) => L.divIcon({ className: "lote-ubic-nombre", html: `<span>${texto.replace(/[<>&"]/g, "")}</span>`, iconSize: null as unknown as L.PointExpression, iconAnchor: [0, 0] });

export function CapaUbicacionLotes({ verNombres, verCenso, zoom, bounds }: { verNombres: boolean; verCenso: boolean; zoom: number; bounds: L.LatLngBounds | null }) {
    const [lotes, setLotes] = useState<UbicacionDeLote[]>([]);
    const [otra, setOtra] = useState(0);
    const [tomando, setTomando] = useState<string | null>(null);
    useEffect(() => { let vivo = true; ubicacionesDeLotes().then((l) => { if (vivo) setLotes(l); }).catch(() => { }); return () => { vivo = false; }; }, [otra]);
    const visibles = useMemo(() => lotes.filter((l) => {
        const enVista = (lat: number | null, lng: number | null) => lat !== null && lng !== null && (!bounds || bounds.contains([lat, lng]));
        return enVista(l.lat, l.lng) || (l.censo && enVista(l.censo.lat, l.censo.lng));
    }), [lotes, bounds]);
    const tomar = useCallback(async (l: UbicacionDeLote) => {
        if (!l.censo) return;
        setTomando(l.id);
        try {
            const r = await tomarUbicacionDelCenso(l.id, l.censo.solicitudId);
            if (!r.ok) toast.error({ title: "No se tomó", description: r.error });
            else { toast.success({ title: `${l.nombre}: ubicación del censo tomada`, description: r.enElPlano ? "También se movió su punto en el plano." : undefined }); setOtra((n) => n + 1); }
        } catch (e) { toast.error({ title: "No se tomó", description: e instanceof Error ? e.message : undefined }); }
        finally { setTomando(null); }
    }, []);

    return (
        <>
            {verNombres && zoom >= ZOOM_NOMBRES && visibles.filter((l) => l.lat !== null).map((l) => (
                <Marker key={`n_${l.id}`} position={[l.lat!, l.lng!]} icon={icono(l.nombre)} interactive={false} zIndexOffset={300} />
            ))}
            {verCenso && visibles.filter((l) => l.censo).map((l) => {
                const c = l.censo!;
                const lejos = c.metros !== null && c.metros > 300;
                return (
                    <Fragment key={`c_${l.id}`}>
                        {l.lat !== null && !lejos && <Polyline positions={[[l.lat!, l.lng!], [c.lat, c.lng]]} pathOptions={{ color: "#38bdf8", weight: 1.5, dashArray: "4 4", opacity: 0.9 }} interactive={false} />}
                        <CircleMarker center={[c.lat, c.lng]} radius={6} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#0ea5e9", fillOpacity: 0.95 }}>
                            <Popup>
                                <div style={{ minWidth: 210, fontSize: 12.5, lineHeight: 1.4 }}>
                                    <b style={{ fontSize: 14 }}>{l.nombre}</b>
                                    <div style={{ color: "#64748b", marginTop: 2 }}>
                                        Ubicación marcada en el censo{c.metros !== null ? ` · a ${c.metros >= 1000 ? `${(c.metros / 1000).toFixed(1)} km` : `${c.metros} m`} de la actual` : " · el lote no tenía ubicación"}.
                                    </div>
                                    {lejos && <div style={{ color: "#b45309", marginTop: 4 }}>Está lejos: puede ser el GPS de donde estaba la persona, no de su casa.</div>}
                                    <button type="button" disabled={tomando === l.id} onClick={() => tomar(l)}
                                        style={{ marginTop: 8, width: "100%", height: 30, borderRadius: 8, border: 0, background: "var(--accion, #2563eb)", color: "#fff", fontWeight: 600, cursor: "pointer", opacity: tomando === l.id ? 0.6 : 1 }}>
                                        {tomando === l.id ? "Tomando…" : "Tomar la del censo"}
                                    </button>
                                </div>
                            </Popup>
                        </CircleMarker>
                    </Fragment>
                );
            })}
        </>
    );
}
