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
/* Los colores de los dibujos, los mismos que usa la columna del estado: verde lo que está vivo, gris lo que no. */
const D_VIVO = "#10b981", D_QUIETO = "#94a3b8", D_AVISO = "#f59e0b", D_MAL = "#ef4444";
/** El ancho de la columna: el globo se abre lo justo para que entre al lado del estado. */
export const ANCHO_OBD = 208;

export const tieneObd = (r: Rastreador) => !!(r.motor || r.fallas || r.vin || r.odometroKm !== null);

const n = (v: number, d = 0) => v.toLocaleString("es-UY", { minimumFractionDigits: d, maximumFractionDigits: d });

type QueIcono = "vueltas" | "agua" | "tanque" | "consumo" | "rendimiento" | "consumido" | "carga" | "acelerador" | "admision" | "fallas" | "recorrido" | "chasis";

/**
 * Los dibujos de cada renglón, hechos como los de la columna del estado (el `Dibujo` de CapaGps): 16
 * px, trazo de 1,5 y puntas redondas, en verde cuando lo que muestran está vivo y en gris cuando no.
 * La primera versión de esta columna no los tenía y se notaba: al lado de una columna con un dibujo
 * por renglón, una sin ninguno parecía de otra pantalla (Nico: «le faltan los íconos»).
 * Los que pueden, dicen CUÁNTO además de qué: la aguja de las vueltas, la columna del termómetro, la
 * gota del tanque y las barras de la carga se mueven con el valor.
 */
function Icono({ que, color, valor = 0 }: { que: QueIcono; color: string; valor?: number }) {
    const p = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: color, strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, style: { flexShrink: 0 } };
    const parte = Math.min(1, Math.max(0, valor));
    switch (que) {
        case "vueltas": {                                   // un cuentavueltas: la aguja va de las 7 a las 5
            const grados = -130 + parte * 260;
            return <svg {...p}><circle cx="8" cy="8" r="5.8" /><path d="M8 8V4.2" strokeWidth="1.8" style={{ transformOrigin: "8px 8px", transform: `rotate(${grados}deg)`, transition: "transform .5s ease" }} /><circle cx="8" cy="8" r="1" fill={color} stroke="none" /></svg>;
        }
        case "agua":                                        // un termómetro: la columna sube con la temperatura
            return <svg {...p}><path d="M6.4 9.3V3.6a1.6 1.6 0 0 1 3.2 0v5.7a3 3 0 1 1-3.2 0Z" /><path d={`M8 11.6V${(9.6 - parte * 5.4).toFixed(1)}`} strokeWidth="1.6" /><circle cx="8" cy="11.8" r="1.2" fill={color} stroke="none" /></svg>;
        case "tanque":                                      // el surtidor
            return <svg {...p}><rect x="2.6" y="2.6" width="6.6" height="10.8" rx="1.2" /><path d="M4.6 5.2h2.6" /><path d="M9.2 7h1.3a1.1 1.1 0 0 1 1.1 1.1v2.6a1 1 0 0 0 2 0V5.6l-1.7-1.8" /></svg>;
        case "consumo":                                     // una gota: lo que está quemando ahora
            return <svg {...p}><path d="M8 2.4c2.5 2.9 3.9 4.9 3.9 6.7a3.9 3.9 0 0 1-7.8 0c0-1.8 1.4-3.8 3.9-6.7Z" /><path d="M6.3 9.6A1.8 1.8 0 0 0 8 11.3" /></svg>;
        case "rendimiento":                                 // una hoja: cuánto rinde
            return <svg {...p}><path d="M3 13c0-6 3.8-9.6 10-10 0 6.2-3.6 10-10 10Z" /><path d="M3 13l5.2-5.2" /></svg>;
        case "consumido":                                   // un bidón: lo que ya quemó
            return <svg {...p}><path d="M4 5.2 6.4 2.8h4.2a1.4 1.4 0 0 1 1.4 1.4v7.6a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 11.8Z" /><path d="M6.4 8.6h3.2" /></svg>;
        case "carga": {                                     // tres barras que se llenan con la carga
            const llena = (desde: number) => (parte > desde ? 1 : 0.3);
            return <svg {...p}><path d="M3.6 13v-3" opacity={llena(0.02)} /><path d="M8 13V7" opacity={llena(0.34)} /><path d="M12.4 13V3.4" opacity={llena(0.67)} /></svg>;
        }
        case "acelerador":                                  // el pedal
            return <svg {...p}><path d="M2.6 13.4h10.8" /><path d="M5.2 11.4 9 3.2a1 1 0 0 1 1.8.1l1 2.4" /><path d="M5.2 11.4h3.4" /></svg>;
        case "admision":                                    // el aire que entra
            return <svg {...p}><path d="M2.4 6h6.4a1.9 1.9 0 1 0-1.9-1.9" /><path d="M2.4 9.2h9.2a1.9 1.9 0 1 1-1.9 1.9" /><path d="M2.4 12.2h3.4" /></svg>;
        case "fallas":                                      // el aviso de «revisar motor»
            return <svg {...p}><path d="M8 2.6 14 13.2H2Z" /><path d="M8 6.8v2.9" /><circle cx="8" cy="11.4" r="0.4" fill={color} /></svg>;
        case "recorrido":                                   // un camino entre dos puntos
            return <svg {...p}><circle cx="3.6" cy="12.4" r="1.2" /><circle cx="12.4" cy="3.6" r="1.2" /><path d="M4.8 12.4h3.6a2.3 2.3 0 0 0 0-4.6H7.6a2.3 2.3 0 0 1 0-4.6h3.6" /></svg>;
        case "chasis":                                      // la chapa de identificación
            return <svg {...p} width={14} height={14}><rect x="2" y="4" width="12" height="8" rx="1.4" /><path d="M4.6 6.8v2.4M7 6.8v2.4M9.4 6.8v2.4M11.6 6.8v2.4" /></svg>;
    }
}

function Fila({ icono, k, v, color, nota }: { icono?: React.ReactNode; k: string; v: string; color?: string; nota?: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, minHeight: 22 }} title={nota}>
            <span style={{ color: GRIS, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}>{icono}{k}</span>
            <span style={{ fontWeight: 600, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color }}>{v}</span>
        </div>
    );
}

/** `abajo`: en una pantalla angosta no entra al costado y va debajo, con la línea arriba en vez de a la izquierda. */
export function PanelObdGps({ r, abajo }: { r: Rastreador; abajo?: boolean }) {
    const m = r.motor, f = r.fallas, t = r.tanque;
    const girando = (m?.rpm || 0) > 0;
    /* Con el motor girando los dibujos van en verde, como «en línea» y «encendido» en la otra columna; parado, en gris. */
    const vivo = girando ? D_VIVO : D_QUIETO;
    const colorTanque = t.pct === null ? undefined : t.pct <= TANQUE_BAJO ? ROJO : t.pct <= 30 ? AMBAR : undefined;
    const tanque = [t.pct !== null ? `${t.pct} %` : null, t.litros !== null ? `${n(t.litros, 1)} l` : null].filter(Boolean).join(" · ");
    const admision = [m?.presion !== undefined ? `${m.presion} kPa` : null, m?.aire !== undefined ? `${m.aire} °C` : null].filter(Boolean).join(" · ");
    return (
        <div style={{ font: "13px/1.45 Outfit,system-ui,sans-serif", ...(abajo ? { width: "100%", borderTop: `1px solid ${LINEA}`, paddingTop: 8 } : { width: ANCHO_OBD, flexShrink: 0, borderLeft: `1px solid ${LINEA}`, paddingLeft: 12 }) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, color: GRIS, fontSize: 11.5, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>Motor · OBD</span>
                {m?.cuando ? <span>{hace(m.cuando)}</span> : null}
            </div>
            {m?.rpm !== undefined && <Fila icono={<Icono que="vueltas" color={m.rpm >= 5500 ? D_MAL : vivo} valor={m.rpm / 7000} />} k="Vueltas" v={girando ? `${n(m.rpm)} rpm` : "Parado"} />}
            {m?.agua !== undefined && <Fila icono={<Icono que="agua" color={m.agua >= AGUA_ALTA ? D_MAL : vivo} valor={(m.agua - 40) / 90} />} k="Refrigerante" v={`${m.agua} °C`} color={m.agua >= AGUA_ALTA ? ROJO : undefined} nota={m.agua >= AGUA_ALTA ? "Temperatura alta" : undefined} />}
            {/* El tanque: lo que dice el vehículo, lo estimado (y se dice que lo es), o que no se sabe. */}
            {tanque ? (
                <>
                    <Fila icono={<Icono que="tanque" color={colorTanque === ROJO ? D_MAL : colorTanque === AMBAR ? D_AVISO : D_VIVO} />} k={t.fuente === "estimado" ? "Tanque (est.)" : "Tanque"} v={tanque} color={colorTanque} nota={t.fuente === "estimado" && t.desde ? `Estimado por lo que quemó el motor desde que se llenó, ${hace(t.desde)}` : undefined} />
                    {t.pct !== null && <div style={{ height: 3, borderRadius: 3, background: LINEA, overflow: "hidden", margin: "1px 0 4px 22px" }}><div style={{ width: `${Math.max(0, Math.min(100, t.pct))}%`, height: "100%", background: colorTanque || GRIS }} /></div>}
                </>
            ) : <Fila icono={<Icono que="tanque" color={D_QUIETO} />} k="Tanque" v="sin dato" color={GRIS} nota={`El vehículo no informa el nivel del tanque.${t.falta ? ` Para estimarlo: ${t.falta.charAt(0).toLowerCase()}${t.falta.slice(1)} (Gestión GPS › ficha del vehículo).` : ""}`} />}
            {m?.consumo !== undefined && <Fila icono={<Icono que="consumo" color={vivo} />} k="Consumo" v={`${n(m.consumo, 1)} l/h`} />}
            {r.rendimiento !== null && <Fila icono={<Icono que="rendimiento" color={D_QUIETO} />} k="Rendimiento" v={`${n(r.rendimiento, 1)} l/100 km`} />}
            {m?.consumido !== undefined && <Fila icono={<Icono que="consumido" color={D_QUIETO} />} k="Consumido" v={`${n(m.consumido, 2)} l`} nota="Desde que el equipo está puesto en el vehículo" />}
            {m?.carga !== undefined && <Fila icono={<Icono que="carga" color={m.carga >= 90 ? D_AVISO : vivo} valor={m.carga / 100} />} k="Carga" v={`${m.carga} %`} />}
            {m?.acelerador !== undefined && <Fila icono={<Icono que="acelerador" color={vivo} />} k="Acelerador" v={`${m.acelerador} %`} />}
            {admision && <Fila icono={<Icono que="admision" color={vivo} />} k="Admisión" v={admision} />}
            {m?.caudal !== undefined && <Fila icono={<Icono que="admision" color={vivo} />} k="Caudal de aire" v={`${m.caudal} g/s`} />}
            {f && <Fila icono={<Icono que="fallas" color={f.codigos.length ? D_MAL : D_VIVO} />} k="Fallas" v={f.codigos.length ? f.codigos.join(" · ") : "ninguna"} color={f.codigos.length ? ROJO : VERDE} />}
            {r.odometroKm !== null && <Fila icono={<Icono que="recorrido" color={D_QUIETO} />} k="Recorrido" v={`${n(r.odometroKm, 1)} km`} nota="Desde que el equipo está puesto en el vehículo" />}
            {r.vin && <div style={{ color: GRIS, fontSize: 10.5, marginTop: 4, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 7 }} title="Número de chasis"><Icono que="chasis" color={D_QUIETO} />{r.vin}</div>}
        </div>
    );
}
