"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Printer } from "lucide-react";
import { rastreadoresGps, recorridoGps, type Rastreador, type RecorridoGps } from "@/app/actions/gps";
import { marcaDeInformes } from "@/app/actions/settings";
import { getSession } from "@/app/actions/auth";
import { OmniLogo } from "@/components/brand/OmniLogo";
import { ESTILO_DE_TAPA, TapaInforme, type MarcaDeTapa } from "@/components/informes/TapaInforme";
import { COLOR } from "@/lib/informes/paleta";
import { Button } from "@/components/ui/button";
import { duracionLarga, excesosDe, franjasDe, COLOR_FRANJA, jornadaDe, jornadaPorDia, minutosEstacionado, resumenDeExcesos, type Exceso } from "@/lib/gps-jornada";
import { diaSemana, fechaNumerica, hora, horaSeg, paraInput } from "@/lib/fechas";
import { claveDeLugar } from "@/lib/direccion-texto";

const Mapa = dynamic(() => import("./MapaInforme"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-neutral-400"><Loader2 className="animate-spin" /></div> });

/**
 * El informe de un recorrido, para imprimir o guardar como PDF (22/11).
 *
 * Es una página y no un PDF armado en el servidor, a propósito: el informe lleva un mapa de verdad
 * —el plano de calles, con la línea pintada por velocidad— y eso lo sabe dibujar el navegador, no
 * el servidor. «Imprimir» abre el diálogo del sistema, que guarda como PDF.
 *
 * Vive fuera de /admin a propósito: el marco del panel (el menú, el área con su propio scroll) al
 * imprimir corta la hoja en la primera página. Sigue pidiendo sesión, y los datos los traen las
 * mismas acciones del mapa, con su mismo permiso.
 *
 * Va siempre en claro y sin el menú del panel: es un papel. Lo que entra es lo que se le manda a un
 * cliente o a un chofer: de qué vehículo, de cuándo a cuándo, cuánto anduvo, la jornada y cada
 * exceso con su hora.
 *
 * Abre con una tapa (24/11, la misma del PDF de rastreo: components/informes/TapaInforme). La hoja
 * que sigue conserva su encabezado con el vehículo y el período: una hoja suelta en una carpeta
 * tiene que poder leerse sin la tapa.
 */
/** Sin marca cargada, o si no se pudo leer: la tapa de OmniAccess sola, en tinta. */
const MARCA_DE_FABRICA: MarcaDeTapa & { preparadoPor: string } = { empresa: "OmniAccess", logoUrl: "", primario: COLOR.tinta, preparadoPor: "" };

function Informe() {
    const q = useSearchParams();
    const imei = q.get("imei") || "", desde = q.get("desde") || "", hasta = q.get("hasta") || "";
    const [d, setD] = useState<{ datos: RecorridoGps; r: Rastreador | null; marca: typeof MARCA_DE_FABRICA; quien: string | null } | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!imei || !desde) return;
        let vivo = true;
        /* La marca y quién lo emite son de la tapa: si alguna no llega, el informe sale igual, con la de fábrica. */
        Promise.all([recorridoGps(imei, 0, { desde, hasta: hasta || null }), rastreadoresGps().catch(() => [] as Rastreador[]), marcaDeInformes().catch(() => null), getSession().catch(() => null)])
            .then(([datos, lista, marca, sesion]) => { if (vivo) setD({ datos, r: lista.find((x) => x.imei === imei) || null, marca: marca || MARCA_DE_FABRICA, quien: typeof sesion?.name === "string" ? sesion.name : null }); })
            .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo traer el recorrido."); });
        return () => { vivo = false; };
    }, [imei, desde, hasta]);

    const cuentas = useMemo(() => {
        if (!d) return null;
        const { puntos, viajes, limite, resumen } = d.datos;
        const jornada = jornadaDe(viajes, { desde: resumen.desde, hasta: hasta ? resumen.hasta : new Date().toISOString(), hastaAhora: !hasta });
        const excesos: (Exceso & { viaje: number })[] = viajes.flatMap((v, n) => excesosDe(puntos.filter((p) => p.cuando >= v.desde && p.cuando <= v.hasta), limite).map((e) => ({ ...e, viaje: n + 1 })));
        return { jornada, dias: jornadaPorDia(jornada, (iso) => paraInput(iso)), excesos, rex: resumenDeExcesos(excesos) };
    }, [d, hasta]);

    if (!imei || !desde) return <p className="p-10 text-[14px]">Falta decir de qué rastreador y desde cuándo.</p>;
    if (error) return <p className="p-10 text-[14px] text-red-700">{error}</p>;
    if (!d || !cuentas) return <div className="grid min-h-dvh place-items-center bg-white text-neutral-500"><Loader2 className="animate-spin" /></div>;
    const { datos, r, marca } = d, km = (x: number) => `${x.toFixed(1).replace(".", ",")} km`;
    const nombre = r?.nombre || r?.matricula || `Rastreador ${imei.slice(-6)}`;
    /* Con el año: es un papel que se archiva, y «23 nov» dentro de dos años no dice de cuándo es. */
    const conAnio = (v: string | Date) => `${fechaNumerica(v)} ${hora(v)}`;
    const periodo = `Del ${conAnio(desde)} ${hasta ? `al ${conAnio(hasta)}` : `hasta el ${conAnio(new Date())}`}`;
    const nViajes = datos.viajes.length, nExcesos = cuentas.rex.veces;

    return (
        <div className="informe min-h-dvh bg-neutral-100 text-neutral-900 print:bg-white">
            {/* En papel no hay menú, ni botones, ni fondo gris; y los colores de la línea tienen que imprimirse. */}
            <style>{`
                @media print { .no-imprimir { display: none !important; } .informe { background: #fff !important; } .hoja { box-shadow: none !important; margin: 0 !important; max-width: none !important; padding: 0 !important; } }
                .informe * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                @page { size: A4; margin: 14mm; }
                ${ESTILO_DE_TAPA}
                .informe table { border-collapse: collapse; width: 100%; } .informe th { text-align: left; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; padding: 4px 8px 4px 0; border-bottom: 1px solid #d1d5db; }
                .informe td { font-size: 12px; padding: 5px 8px 5px 0; border-bottom: 1px solid #eceff3; font-variant-numeric: tabular-nums; vertical-align: top; }
                .informe tr { break-inside: avoid; }
            `}</style>
            <div className="no-imprimir sticky top-0 z-[1000] flex items-center gap-3 border-b border-neutral-200 bg-white/95 px-5 py-2.5 backdrop-blur">
                <p className="text-[13px] font-bold">Informe del recorrido</p>
                <p className="text-[12px] text-neutral-500">Así sale en papel. «Imprimir» también guarda como PDF.</p>
                <Button size="sm" className="ml-auto" onClick={() => window.print()}><Printer size={14} /> Imprimir o guardar PDF</Button>
            </div>

            <TapaInforme marca={marca} linea="Rastreo satelital" rotulo="Informe de recorrido" titulo={nombre}
                debajo={r?.matricula && r.matricula !== nombre ? `Matrícula ${r.matricula}` : null} periodo={periodo}
                cifras={[
                    { valor: km(datos.resumen.km), que: "recorridos" }, { valor: String(nViajes), que: nViajes === 1 ? "viaje" : "viajes" }, { valor: duracionLarga(datos.resumen.enMovimientoMin), que: "andando" },
                    { valor: duracionLarga(minutosEstacionado(cuentas.jornada)), que: "estacionado" }, { valor: datos.resumen.velMax ? `${datos.resumen.velMax} km/h` : "—", que: "velocidad máxima" },
                    { valor: String(nExcesos), que: nExcesos === 1 ? "exceso de velocidad" : "excesos de velocidad", tono: nExcesos ? "mal" : undefined },
                ]}
                adentro={[
                    { que: "El mapa del recorrido", cuanto: datos.puntos.length > 1 ? `${datos.resumen.puntos.toLocaleString("es-UY")} posiciones` : null },
                    { que: "La jornada, viaje por viaje", cuanto: nViajes ? `${nViajes} ${nViajes === 1 ? "viaje" : "viajes"}` : null },
                    { que: "Cada exceso, con su hora", cuanto: nExcesos ? `${nExcesos} ${nExcesos === 1 ? "exceso" : "excesos"}` : null },
                ]}
                vara={`Velocidad permitida: ${datos.limite} km/h`} emitido={conAnio(new Date())} por={marca.preparadoPor || d.quien} />

            <div className="hoja mx-auto my-5 max-w-[820px] bg-white p-9 shadow-[0_2px_18px_rgba(0,0,0,.12)]">
                <div className="flex items-start gap-4 border-b border-neutral-300 pb-3">
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Informe de recorrido</p>
                        <h1 className="mt-0.5 text-[24px] font-bold leading-tight tracking-[-0.02em]">{nombre}</h1>
                        <p className="mt-1 text-[12.5px] text-neutral-600">{r?.matricula && r.matricula !== nombre ? `${r.matricula} · ` : ""}{periodo}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-neutral-900"><OmniLogo size={22} /><span className="text-[15px] font-bold tracking-[-0.01em]">OmniAccess</span></div>
                </div>

                <dl className="mt-4 grid grid-cols-5 gap-3">
                    {[["Recorrió", km(datos.resumen.km)], ["Viajes", String(datos.viajes.length)], ["Andando", duracionLarga(datos.resumen.enMovimientoMin)], ["Estacionado", duracionLarga(minutosEstacionado(cuentas.jornada))], ["Velocidad máxima", `${datos.resumen.velMax} km/h`]].map(([k, v]) => (
                        <div key={k}><dt className="text-[10px] uppercase tracking-[0.08em] text-neutral-500">{k}</dt><dd className="text-[19px] font-bold tabular-nums leading-tight">{v}</dd></div>
                    ))}
                </dl>
                <p className="mt-2 text-[12px] text-neutral-700">
                    Velocidad permitida: <b>{datos.limite} km/h</b>. {cuentas.rex.veces
                        ? <>La pasó <b>{cuentas.rex.veces} {cuentas.rex.veces === 1 ? "vez" : "veces"}</b>, {cuentas.rex.segundos >= 60 ? duracionLarga(Math.round(cuentas.rex.segundos / 60)) : `${cuentas.rex.segundos} s`} en total, hasta <b>{cuentas.rex.velMax} km/h</b>.</>
                        : "No la pasó en ningún momento."}
                </p>

                {datos.puntos.length > 1 && (
                    <>
                        <div className="mt-4 h-[380px] overflow-hidden rounded-[6px] border border-neutral-300"><Mapa datos={datos} /></div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-neutral-600">
                            {franjasDe(datos.limite).map((f) => <span key={f.franja} className="inline-flex items-center gap-1.5 tabular-nums"><span className="h-[5px] w-5 rounded-full" style={{ background: COLOR_FRANJA[f.franja] }} />{f.rotulo} km/h</span>)}
                            <span className="ml-auto">Los números marcan dónde empieza cada viaje.</span>
                        </div>
                    </>
                )}

                <h2 className="mt-6 text-[13px] font-bold">La jornada</h2>
                {cuentas.dias.length === 0 ? <p className="mt-1 text-[12px] text-neutral-600">No hizo ningún viaje en el período.</p> : (
                    <table className="mt-1">
                        <thead><tr><th style={{ width: 34 }}>N.º</th><th>Qué</th><th>Desde</th><th>Hasta</th><th>Duró</th><th>Recorrió</th><th>Máx.</th><th>Media</th></tr></thead>
                        <tbody>
                            {cuentas.dias.map((dia) => (
                                <FilasDelDia key={dia.dia} dia={dia} lugares={datos.lugares || {}} />
                            ))}
                        </tbody>
                    </table>
                )}

                <h2 className="mt-6 text-[13px] font-bold">Excesos de velocidad</h2>
                {cuentas.excesos.length === 0 ? <p className="mt-1 text-[12px] text-neutral-600">Ninguno: no superó los {datos.limite} km/h.</p> : (
                    <table className="mt-1">
                        <thead><tr><th>Día</th><th>Hora</th><th>Viaje</th><th>Duró</th><th>Tramo</th><th>Llegó a</th><th>Sobre el límite</th></tr></thead>
                        <tbody>
                            {cuentas.excesos.map((e, i) => (
                                <tr key={i}><td>{diaSemana(e.desde)}</td><td>{horaSeg(e.desde)}</td><td>{e.viaje}</td><td>{e.segundos} s</td><td>{e.metros >= 1000 ? km(e.metros / 1000) : `${e.metros} m`}</td><td><b>{e.velMax} km/h</b></td><td>+{e.velMax - datos.limite} km/h</td></tr>
                            ))}
                        </tbody>
                    </table>
                )}

                <p className="mt-6 border-t border-neutral-300 pt-2 text-[10px] leading-snug text-neutral-500">
                    Hecho con las posiciones que reportó el rastreador ({datos.resumen.puntos.toLocaleString("es-UY")} con buena señal en el período). Un viaje es un tramo en que se alejó más de 250 m; una espera de menos de 4 minutos no lo corta.
                    Emitido el {conAnio(new Date())} · OmniAccess · Ingeniería en Seguridad
                </p>
            </div>
        </div>
    );
}

function FilasDelDia({ dia, lugares }: { dia: ReturnType<typeof jornadaPorDia>[number]; /** La dirección de cada lugar donde quedó estacionado, por la clave del punto. */ lugares: Record<string, string> }) {
    const km = (x: number) => `${x.toFixed(1).replace(".", ",")} km`;
    const primero = dia.tramos[0], iso = primero.tipo === "viaje" ? primero.viaje.desde : primero.desde, n = diaSemana(iso);
    return (
        <>
            <tr><td colSpan={8} style={{ background: "#f3f4f6", fontWeight: 700, padding: "5px 8px" }}>{n.charAt(0).toUpperCase() + n.slice(1)} <span style={{ fontWeight: 400, color: "#4b5563" }}>· {dia.viajes ? `${dia.viajes} ${dia.viajes === 1 ? "viaje" : "viajes"} · ${km(dia.km)} · ${duracionLarga(dia.andandoMin)} andando` : "sin viajes"}</span></td></tr>
            {dia.tramos.map((t, i) => t.tipo === "viaje" ? (
                <tr key={i}><td><b>{t.n}</b></td><td>Viaje</td><td>{hora(t.viaje.desde)}</td><td>{hora(t.viaje.hasta)}</td><td>{duracionLarga(t.viaje.minutos)}</td><td>{km(t.viaje.km)}</td><td>{t.viaje.velMax} km/h</td><td>{t.viaje.velMedia} km/h</td></tr>
            ) : (
                <tr key={i} style={{ color: "#6b7280" }}><td /><td>Estacionado{t.sigue ? " (sigue)" : ""}</td><td>{hora(t.desde)}</td><td>{t.sigue ? "—" : hora(t.hasta)}</td><td>{duracionLarga(t.minutos)}</td><td colSpan={3}>{lugares[claveDeLugar(t.lat, t.lon)] || ""}</td></tr>
            ))}
        </>
    );
}

export default function Pagina() {
    return <Suspense fallback={null}><Informe /></Suspense>;
}
