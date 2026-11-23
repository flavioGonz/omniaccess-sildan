"use client";

import type { Rastreador } from "@/app/actions/gps";
import { hace } from "@/lib/fechas";

/**
 * Los datos del motor, acoplados a la derecha del globo de un vehículo en el mapa (23/11).
 *
 * Nico: «en el tooltip con los estados sobre el mapa, a la derecha, debe tener acoplados los datos
 * OBD cuando el GPS trae esos datos». La primera versión fue un tablero oscuro con números grandes y
 * barras, y además caía DEBAJO del globo en vez de al costado. La devolvió con una captura: «está
 * mal el diseño; deben ir a la derecha, acoplado al tooltip, más discreto».
 *
 * Así que es una segunda columna del mismo globo, no una pieza aparte: el mismo fondo, la misma
 * letra y los mismos renglones «nombre · valor» que la columna del estado, separada por una línea
 * fina. Lo único que se dibuja es la barrita del tanque. El color aparece sólo cuando hay algo que
 * mirar: refrigerante alto, tanque bajo, una falla.
 *
 * Sólo existe cuando el rastreador trae datos del motor (`tieneObd`), y cada renglón sólo si el
 * vehículo contesta ese dato. La excepción es el tanque: es lo primero que se pregunta, así que
 * cuando no se sabe se dice en un renglón, sin párrafo.
 */

const GRIS = "#64748b", LINEA = "#e2e8f0", ROJO = "#b91c1c", AMBAR = "#b45309", VERDE = "#047857";
const AGUA_ALTA = 110, TANQUE_BAJO = 15;
/** El ancho de la columna: el globo se abre lo justo para que entre al lado del estado. */
export const ANCHO_OBD = 186;

export const tieneObd = (r: Rastreador) => !!(r.motor || r.fallas || r.vin || r.odometroKm !== null);

const n = (v: number, d = 0) => v.toLocaleString("es-UY", { minimumFractionDigits: d, maximumFractionDigits: d });

function Fila({ k, v, color, nota }: { k: string; v: string; color?: string; nota?: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, minHeight: 22 }} title={nota}>
            <span style={{ color: GRIS, whiteSpace: "nowrap" }}>{k}</span>
            <span style={{ fontWeight: 600, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color }}>{v}</span>
        </div>
    );
}

/** `abajo`: en una pantalla angosta no entra al costado y va debajo, con la línea arriba en vez de a la izquierda. */
export function PanelObdGps({ r, abajo }: { r: Rastreador; abajo?: boolean }) {
    const m = r.motor, f = r.fallas, t = r.tanque;
    const girando = (m?.rpm || 0) > 0;
    const colorTanque = t.pct === null ? undefined : t.pct <= TANQUE_BAJO ? ROJO : t.pct <= 30 ? AMBAR : undefined;
    const tanque = [t.pct !== null ? `${t.pct} %` : null, t.litros !== null ? `${n(t.litros, 1)} l` : null].filter(Boolean).join(" · ");
    const admision = [m?.presion !== undefined ? `${m.presion} kPa` : null, m?.aire !== undefined ? `${m.aire} °C` : null].filter(Boolean).join(" · ");
    return (
        <div style={{ font: "13px/1.45 Outfit,system-ui,sans-serif", ...(abajo ? { width: "100%", borderTop: `1px solid ${LINEA}`, paddingTop: 8 } : { width: ANCHO_OBD, flexShrink: 0, borderLeft: `1px solid ${LINEA}`, paddingLeft: 12 }) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, color: GRIS, fontSize: 11.5, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>Motor · OBD</span>
                {m?.cuando ? <span>{hace(m.cuando)}</span> : null}
            </div>
            {m?.rpm !== undefined && <Fila k="Vueltas" v={girando ? `${n(m.rpm)} rpm` : "Parado"} />}
            {m?.agua !== undefined && <Fila k="Refrigerante" v={`${m.agua} °C`} color={m.agua >= AGUA_ALTA ? ROJO : undefined} nota={m.agua >= AGUA_ALTA ? "Temperatura alta" : undefined} />}
            {/* El tanque: lo que dice el vehículo, lo estimado (y se dice que lo es), o que no se sabe. */}
            {tanque ? (
                <>
                    <Fila k={t.fuente === "estimado" ? "Tanque (est.)" : "Tanque"} v={tanque} color={colorTanque} nota={t.fuente === "estimado" && t.desde ? `Estimado por lo que quemó el motor desde que se llenó, ${hace(t.desde)}` : undefined} />
                    {t.pct !== null && <div style={{ height: 3, borderRadius: 3, background: LINEA, overflow: "hidden", margin: "1px 0 4px" }}><div style={{ width: `${Math.max(0, Math.min(100, t.pct))}%`, height: "100%", background: colorTanque || GRIS }} /></div>}
                </>
            ) : <Fila k="Tanque" v="sin dato" color={GRIS} nota={`El vehículo no informa el nivel del tanque.${t.falta ? ` Para estimarlo: ${t.falta.charAt(0).toLowerCase()}${t.falta.slice(1)} (Gestión GPS › ficha del vehículo).` : ""}`} />}
            {m?.consumo !== undefined && <Fila k="Consumo" v={`${n(m.consumo, 1)} l/h`} />}
            {r.rendimiento !== null && <Fila k="Rendimiento" v={`${n(r.rendimiento, 1)} l/100 km`} />}
            {m?.consumido !== undefined && <Fila k="Consumido" v={`${n(m.consumido, 2)} l`} nota="Desde que el equipo está puesto en el vehículo" />}
            {m?.carga !== undefined && <Fila k="Carga" v={`${m.carga} %`} />}
            {m?.acelerador !== undefined && <Fila k="Acelerador" v={`${m.acelerador} %`} />}
            {admision && <Fila k="Admisión" v={admision} />}
            {m?.caudal !== undefined && <Fila k="Caudal de aire" v={`${m.caudal} g/s`} />}
            {f && <Fila k="Fallas" v={f.codigos.length ? f.codigos.join(" · ") : "ninguna"} color={f.codigos.length ? ROJO : VERDE} />}
            {r.odometroKm !== null && <Fila k="Recorrido" v={`${n(r.odometroKm, 1)} km`} nota="Desde que el equipo está puesto en el vehículo" />}
            {r.vin && <div style={{ color: GRIS, fontSize: 10.5, marginTop: 4, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }} title="Número de chasis">{r.vin}</div>}
        </div>
    );
}
