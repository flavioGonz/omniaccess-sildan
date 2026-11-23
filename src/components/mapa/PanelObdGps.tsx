"use client";

import type { Rastreador } from "@/app/actions/gps";
import { hace } from "@/lib/fechas";

/**
 * El tablero del motor, acoplado a la derecha del globo de un vehículo en el mapa (23/11).
 *
 * Nico: «en el tooltip con los estados sobre el mapa, a la derecha, debe tener acoplados los datos
 * OBD, premium, cuando el GPS trae esos datos». Y antes: «no veo los datos del motor en ningún
 * lado» — estaban sólo adentro de la ficha de Gestión GPS, y al vehículo se lo mira acá.
 *
 * Es un tablero y no una lista más de renglones: lo que se lee de un vistazo en un auto —vueltas,
 * temperatura, tanque— va grande y con su barra; lo demás, chico abajo. Va sobre fondo oscuro para
 * que se lea como un instrumento aparte del estado del rastreador, que está al lado en claro.
 *
 * Sólo aparece cuando el rastreador trae datos del motor (`tieneObd`). Cada dato se dibuja si el
 * vehículo lo contesta; el que no, no deja un hueco con una raya. La excepción es el tanque: es lo
 * primero que se pregunta, así que cuando no se sabe se dice POR QUÉ y qué hacer.
 *
 * Los colores son estado, como en el resto: verde bien, ámbar para mirar, rojo mal. El celeste es
 * el del dato sin juicio (una barra de vueltas no está «bien» ni «mal»).
 */

const TINTA = "#f8fafc", GRIS = "#94a3b8", LINEA = "rgba(148,163,184,.22)", FONDO = "#0f172a";
const CELESTE = "#38bdf8", VERDE = "#34d399", AMBAR = "#fbbf24", ROJO = "#f87171";
/** Hasta dónde llega cada barra. Las vueltas, a 7.000: más que eso no lo da un motor de calle. */
const RPM_TOPE = 7000, AGUA_FRIA = 70, AGUA_ALTA = 110, TANQUE_BAJO = 15;

export const tieneObd = (r: Rastreador) => !!(r.motor || r.fallas || r.vin || r.odometroKm !== null);

const n = (v: number, d = 0) => v.toLocaleString("es-UY", { minimumFractionDigits: d, maximumFractionDigits: d });

function Barra({ pct, color, alto = 4 }: { pct: number; color: string; alto?: number }) {
    return (
        <div style={{ height: alto, borderRadius: alto, background: "rgba(148,163,184,.2)", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", borderRadius: alto, background: color, transition: "width .5s ease" }} />
        </div>
    );
}

/** Un instrumento grande: el número, su unidad y la barra. */
function Reloj({ k, valor, unidad, pct, color }: { k: string; valor: string; unidad: string; pct: number; color: string }) {
    return (
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: GRIS, fontSize: 10.5 }}>{k}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, margin: "1px 0 5px" }}>
                <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{valor}</span>
                <span style={{ color: GRIS, fontSize: 11 }}>{unidad}</span>
            </div>
            <Barra pct={pct} color={color} />
        </div>
    );
}

function Fila({ k, v, color }: { k: string; v: string; color?: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, minHeight: 20, alignItems: "center" }}>
            <span style={{ color: GRIS }}>{k}</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", color: color || TINTA, textAlign: "right", whiteSpace: "nowrap" }}>{v}</span>
        </div>
    );
}

const Rotulo = ({ children }: { children: React.ReactNode }) => (
    <div style={{ color: GRIS, fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", margin: "10px 0 4px", paddingTop: 9, borderTop: `1px solid ${LINEA}` }}>{children}</div>
);

export function PanelObdGps({ r }: { r: Rastreador }) {
    const m = r.motor, f = r.fallas, t = r.tanque;
    const girando = (m?.rpm || 0) > 0;
    const agua = m?.agua;
    const colorAgua = agua === undefined ? CELESTE : agua >= AGUA_ALTA ? ROJO : agua < AGUA_FRIA ? CELESTE : VERDE;
    const colorTanque = t.pct === null ? CELESTE : t.pct <= TANQUE_BAJO ? ROJO : t.pct <= 30 ? AMBAR : VERDE;
    const admision = [m?.presion !== undefined ? `${m.presion} kPa` : null, m?.aire !== undefined ? `${m.aire} °C` : null, m?.caudal !== undefined ? `${m.caudal} g/s` : null].filter(Boolean).join(" · ");

    return (
        <div style={{ width: 232, flexShrink: 0, background: FONDO, color: TINTA, borderRadius: 10, padding: "11px 12px 10px", font: "12px/1.4 Outfit,system-ui,sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>Motor <span style={{ color: GRIS, fontWeight: 500 }}>· OBD</span></span>
                <span style={{ color: GRIS, fontSize: 10.5 }}>{m?.cuando ? `leído ${hace(m.cuando)}` : "sin lectura todavía"}</span>
            </div>

            {/* Lo que se mira primero: vueltas y temperatura. Con el motor parado no hay temperatura que mostrar. */}
            {m?.rpm !== undefined && (
                <div style={{ display: "flex", gap: 14, marginTop: 9 }}>
                    <Reloj k={girando ? "Vueltas" : "Motor"} valor={girando ? n(m.rpm) : "Parado"} unidad={girando ? "rpm" : ""} pct={(m.rpm / RPM_TOPE) * 100} color={m.rpm >= 5500 ? ROJO : CELESTE} />
                    {agua !== undefined && <Reloj k="Refrigerante" valor={String(agua)} unidad="°C" pct={((agua - 40) / (130 - 40)) * 100} color={colorAgua} />}
                </div>
            )}
            {agua !== undefined && agua >= AGUA_ALTA && <div style={{ marginTop: 6, color: ROJO, fontWeight: 600 }}>Temperatura alta: conviene detenerse</div>}

            <Rotulo>Combustible</Rotulo>
            {t.pct !== null || t.litros !== null ? (
                <div style={{ marginBottom: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                        <span style={{ color: GRIS }}>Tanque{t.fuente === "estimado" ? " (estimado)" : ""}</span>
                        <span style={{ fontWeight: 700, fontSize: 13.5, fontVariantNumeric: "tabular-nums", color: colorTanque === VERDE ? TINTA : colorTanque }}>
                            {t.pct !== null ? `${t.pct} %` : ""}{t.pct !== null && t.litros !== null ? " · " : ""}{t.litros !== null ? `${n(t.litros, 1)} l` : ""}
                        </span>
                    </div>
                    {t.pct !== null && <Barra pct={t.pct} color={colorTanque} alto={6} />}
                    {t.fuente === "estimado" && t.desde && <div style={{ color: GRIS, fontSize: 10.5, marginTop: 3 }}>Desde que se llenó, {hace(t.desde)}</div>}
                </div>
            ) : (
                /* No se sabe cuánto queda: se dice por qué y qué hacer, no una raya. */
                <div style={{ color: GRIS, fontSize: 11, lineHeight: 1.35, marginBottom: 5 }}>
                    <span style={{ color: TINTA, fontWeight: 600 }}>El vehículo no informa el nivel del tanque.</span>{" "}
                    {t.falta ? `Para estimarlo: ${t.falta.charAt(0).toLowerCase()}${t.falta.slice(1)} (Gestión GPS › ficha del vehículo).` : ""}
                </div>
            )}
            {m?.consumo !== undefined && <Fila k="Consumo ahora" v={`${n(m.consumo, 1)} l/h`} />}
            {r.rendimiento !== null && <Fila k="Rendimiento" v={`${n(r.rendimiento, 1)} l/100 km`} />}
            {m?.consumido !== undefined && <Fila k="Consumido" v={`${n(m.consumido, 2)} l`} />}

            {(m?.carga !== undefined || m?.acelerador !== undefined || admision) && <Rotulo>Esfuerzo</Rotulo>}
            {m?.carga !== undefined && <div style={{ marginBottom: 6 }}><Fila k="Carga del motor" v={`${m.carga} %`} /><Barra pct={m.carga} color={m.carga >= 90 ? AMBAR : CELESTE} /></div>}
            {m?.acelerador !== undefined && <div style={{ marginBottom: 6 }}><Fila k="Acelerador" v={`${m.acelerador} %`} /><Barra pct={m.acelerador} color={CELESTE} /></div>}
            {admision && <Fila k="Admisión" v={admision} />}

            {/* «Consumido» y «Recorrido» cuentan desde que el equipo está puesto en el vehículo, no desde que salió de fábrica. */}
            {(f || r.odometroKm !== null || r.vin) && <Rotulo>Vehículo</Rotulo>}
            {f && <Fila k="Fallas del motor" v={f.codigos.length ? f.codigos.join(" · ") : "Sin códigos"} color={f.codigos.length ? ROJO : VERDE} />}
            {r.odometroKm !== null && <Fila k="Recorrido" v={`${n(r.odometroKm, 1)} km`} />}
            {r.vin && <div style={{ color: GRIS, fontSize: 10.5, marginTop: 3, fontVariantNumeric: "tabular-nums", letterSpacing: "0.03em" }}>Chasis {r.vin}</div>}
        </div>
    );
}
