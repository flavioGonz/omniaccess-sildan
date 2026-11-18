"use client";

import { useCallback, useEffect, useState } from "react";
import { Car, Check, Clock, Download, Home, Loader2, MapPin, QrCode, Users, Wrench, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Chip, Cargando, ErrorEstado } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { fechaHora } from "@/lib/fechas";
import { TENENCIAS, TIPOS_SERVICIO, TIPOS_VEHICULO, type ServicioCargado, type VehiculoCargado } from "@/lib/registro-padron";


/**
 * La bandeja del censo: lo que carga la gente desde el QR (/registro), antes de ser padrón.
 *
 * Existe porque el formulario es una URL pública: cualquiera puede escribir que es del lote 42 y
 * cargar una matrícula que abre un portón. Nada entra solo. Acá se mira, y recién ahí se da de
 * alta la persona, su lote y sus matrículas.
 */

type Carga = {
    id: string; lote: string; apellido: string; nombre: string; tenencia: string; telefono: string; email: string;
    vehiculos: VehiculoCargado[]; servicios: ServicioCargado[]; comentario: string;
    lat: number | null; lng: number | null;
    estado: string; revisadaPor: string | null; revisadaAt: string | null; nota: string | null; createdAt: string;
};

const VISTAS = [
    { valor: "pendiente", rotulo: "Sin revisar" },
    { valor: "aprobada", rotulo: "Aprobadas" },
    { valor: "rechazada", rotulo: "Rechazadas" },
    { valor: "todas", rotulo: "Todas" },
];

const tel = (t: string) => (t.startsWith("598") ? `0${t.slice(3)}` : t).replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");

export default function BandejaCenso() {
    const [vista, setVista] = useState("pendiente");
    const [cargas, setCargas] = useState<Carga[] | null>(null);
    const [pendientes, setPendientes] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<Carga | null>(null);
    const [qr, setQr] = useState(false);

    const traer = useCallback(async () => {
        try {
            const r = await fetch(`/api/censo?estado=${vista}`, { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setCargas(j.cargas); setPendientes(j.pendientes); setError(null);
        } catch (e) { setError(e instanceof Error ? e.message : "No se pudo traer la bandeja"); }
    }, [vista]);
    useEffect(() => { setCargas(null); traer(); }, [traer]);

    async function resolver(c: Carga, accion: "aprobar" | "rechazar", motivo?: string) {
        const r = await fetch("/api/censo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, accion, motivo }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { toast.error({ title: "No se pudo", description: j?.error }); return; }
        if (accion === "aprobar") {
            toast.success({
                title: `${j.persona} en ${j.unidad}`,
                description: [`${j.matriculas} ${j.matriculas === 1 ? "matrícula dada de alta" : "matrículas dadas de alta"}`, ...(j.avisos || [])].join(" · "),
            });
        } else toast.success({ title: "Rechazada" });
        setAbierta(null); traer();
    }

    return (
        <div className="p-4 sm:p-6 space-y-4 max-w-[1100px]">
            <header className="flex items-center gap-3 flex-wrap">
                <div>
                    <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">Censo del barrio</h1>
                    <p className="text-[13px] text-muted-foreground">
                        Lo que carga cada lote desde el QR. Nada entra al padrón hasta que lo aprobás acá.
                    </p>
                </div>
                <Button variant="outline" className="ml-auto" onClick={() => setQr(true)}><QrCode size={15} /> El QR</Button>
            </header>

            <div className="flex items-center gap-3 flex-wrap">
                <Filtros grupos={[{ clave: "e", titulo: "Ver", valor: vista, alElegir: setVista, opciones: VISTAS }]} />
                {pendientes > 0 && <Chip tono="aviso">{pendientes} sin revisar</Chip>}
            </div>

            {error && !cargas ? <ErrorEstado mensaje={error} alReintentar={traer} />
                : !cargas ? <Cargando texto="Trayendo la bandeja…" />
                    : cargas.length === 0 ? (
                        <div className="rounded-[10px] border border-dashed border-border p-10 text-center">
                            <Users size={20} className="mx-auto mb-2 text-muted-foreground" />
                            <p className="text-[13px] text-muted-foreground">Todavía no hay cargas acá. El QR las trae solas.</p>
                        </div>
                    ) : (
                        <div className="grid gap-2.5 sm:grid-cols-2">
                            {cargas.map((c) => (
                                <button key={c.id} type="button" onClick={() => setAbierta(c)}
                                    className="text-left rounded-[10px] border border-border bg-card p-3.5 hover:bg-accent/40 transition-colors">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[15px] font-bold">Lote {c.lote}</span>
                                        <span className="text-[14px] font-semibold truncate">{[c.nombre, c.apellido].filter(Boolean).join(" ")}</span>
                                        {c.estado === "aprobada" && <Chip tono="bien" className="ml-auto">Aprobada</Chip>}
                                        {c.estado === "rechazada" && <Chip tono="mal" className="ml-auto">Rechazada</Chip>}
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-3 text-[12px] text-muted-foreground tabular-nums">
                                        <span className="inline-flex items-center gap-1"><Car size={12} /> {c.vehiculos.length}</span>
                                        <span className="inline-flex items-center gap-1"><Wrench size={12} /> {c.servicios.length}</span>
                                        <span className="inline-flex items-center gap-1"><Clock size={12} /> {fechaHora(c.createdAt)}</span>
                                    </div>
                                    {!!c.vehiculos.length && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {c.vehiculos.slice(0, 4).map((v) => (
                                                <span key={v.chapa} className="rounded-[6px] border border-border px-1.5 py-0.5 text-[11.5px] font-bold tracking-[0.08em] tabular-nums">{v.chapa}</span>
                                            ))}
                                            {c.vehiculos.length > 4 && <span className="text-[11.5px] text-muted-foreground">+{c.vehiculos.length - 4}</span>}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

            <Ficha carga={abierta} alCerrar={() => setAbierta(null)} alResolver={resolver} />
            <CajonQr abierto={qr} alCerrar={() => setQr(false)} />
        </div>
    );
}

function Ficha({ carga, alCerrar, alResolver }: { carga: Carga | null; alCerrar: () => void; alResolver: (c: Carga, a: "aprobar" | "rechazar", motivo?: string) => Promise<void> }) {
    const [trabajando, setTrabajando] = useState<"aprobar" | "rechazar" | null>(null);
    const [motivo, setMotivo] = useState("");
    useEffect(() => { setMotivo(""); setTrabajando(null); }, [carga?.id]);
    const hacer = async (a: "aprobar" | "rechazar") => { if (!carga) return; setTrabajando(a); try { await alResolver(carga, a, motivo); } finally { setTrabajando(null); } };
    const pendiente = carga?.estado === "pendiente";

    return (
        <Cajon open={!!carga} onOpenChange={(o) => { if (!o && !trabajando) alCerrar(); }}>
            <CajonContenido ancho="intermedio" titulo={carga ? `Lote ${carga.lote} · ${[carga.nombre, carga.apellido].filter(Boolean).join(" ")}` : ""}
                descripcion={carga ? `${TENENCIAS.find((t) => t.id === carga.tenencia)?.rotulo} · cargado ${fechaHora(carga.createdAt)}` : ""}
                pie={pendiente ? (
                    <div className="flex flex-col gap-2 w-full">
                        <Button className="h-10 w-full rounded-full" onClick={() => hacer("aprobar")} disabled={!!trabajando}>
                            {trabajando === "aprobar" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Dar de alta en el padrón
                        </Button>
                        <button type="button" onClick={() => hacer("rechazar")} disabled={!!trabajando}
                            className="h-10 w-full rounded-full border border-border text-[13px] font-semibold hover:bg-accent disabled:opacity-60 inline-flex items-center justify-center gap-2">
                            {trabajando === "rechazar" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Rechazar
                        </button>
                    </div>
                ) : undefined}>
                {carga && (
                    <div className="space-y-4">
                        <section className="rounded-[10px] border border-border divide-y divide-border">
                            <Dato icono={Home} rotulo="Lote" valor={carga.lote} />
                            <Dato icono={Users} rotulo="Teléfono" valor={tel(carga.telefono)} />
                            {carga.email && <Dato icono={Users} rotulo="Correo" valor={carga.email} />}
                            {/* Al aprobar, este punto completa la ubicación del lote si todavía no tenía
                                ninguna — la que dibujó la administración sobre el plano nunca se pisa. */}
                            {carga.lat != null && carga.lng != null && (
                                <Dato icono={MapPin} rotulo="Ubicación que marcó" valor={`${carga.lat.toFixed(5)}, ${carga.lng.toFixed(5)}`} />
                            )}
                        </section>

                        <section className="space-y-2">
                            <h3 className="text-[13px] font-bold">Vehículos · {carga.vehiculos.length}</h3>
                            {carga.vehiculos.length === 0 && <p className="text-[12.5px] text-muted-foreground">No cargó ninguno.</p>}
                            {carga.vehiculos.map((v) => (
                                <div key={v.chapa} className="flex items-center gap-2 rounded-[10px] border border-border px-3 py-2">
                                    <span className="text-[14px] font-bold tracking-[0.1em] tabular-nums">{v.chapa}</span>
                                    <span className="text-[12px] text-muted-foreground">{TIPOS_VEHICULO.find((t) => t.id === v.tipo)?.rotulo}</span>
                                    {v.quien && <span className="text-[12px] text-muted-foreground truncate">· {v.quien}</span>}
                                </div>
                            ))}
                        </section>

                        {carga.servicios.length > 0 && (
                            <section className="space-y-2">
                                <h3 className="text-[13px] font-bold">Quién entra seguido · {carga.servicios.length}</h3>
                                {carga.servicios.map((s, i) => (
                                    <div key={i} className="rounded-[10px] border border-border px-3 py-2 text-[13px]">
                                        <span className="font-semibold">{TIPOS_SERVICIO.find((t) => t.id === s.tipo)?.rotulo}</span>
                                        {s.nombre && <span> · {s.nombre}</span>}
                                        {!!s.dias?.length && <span className="text-muted-foreground"> · {s.dias.join(", ")}</span>}
                                        {(s.desde || s.hasta) && <span className="text-muted-foreground tabular-nums"> · {s.desde || "?"} a {s.hasta || "?"}</span>}
                                        {s.chapa && <span className="font-bold tabular-nums tracking-[0.08em]"> · {s.chapa}</span>}
                                    </div>
                                ))}
                                <p className="text-[12px] text-muted-foreground leading-snug">
                                    Los servicios quedan anotados en la ficha de la persona. Todavía no se convierten solos en
                                    autorizaciones: eso se arma en Visitas, mirándolo.
                                </p>
                            </section>
                        )}

                        {carga.comentario && (
                            <section>
                                <h3 className="text-[13px] font-bold mb-1">Dijo</h3>
                                <p className="text-[13px] leading-relaxed rounded-[10px] bg-muted/50 p-3">{carga.comentario}</p>
                            </section>
                        )}

                        {pendiente ? (
                            <label className="block">
                                <span className="block text-[12.5px] font-semibold mb-1">Motivo, si la rechazás</span>
                                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ese lote ya lo cargó otra persona"
                                    className="w-full h-10 rounded-[6px] border border-border bg-background px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--accion)]/30" />
                            </label>
                        ) : (
                            <p className="text-[12.5px] text-muted-foreground">
                                {carga.estado === "aprobada" ? "Aprobada" : "Rechazada"} por {carga.revisadaPor || "alguien"} el {fechaHora(carga.revisadaAt)}.
                                {carga.nota ? ` ${carga.nota}` : ""}
                            </p>
                        )}
                    </div>
                )}
            </CajonContenido>
        </Cajon>
    );
}

function Dato({ icono: I, rotulo, valor }: { icono: typeof Home; rotulo: string; valor: string }) {
    return (
        <div className="flex items-center gap-2 px-3 py-2">
            <I size={13} className="text-muted-foreground shrink-0" />
            <span className="text-[12.5px] text-muted-foreground">{rotulo}</span>
            <span className="ml-auto text-[13.5px] font-semibold tabular-nums">{valor}</span>
        </div>
    );
}

function CajonQr({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
    const url = typeof window !== "undefined" ? `${window.location.origin}/registro` : "/registro";
    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="angosto" titulo="El QR del censo" descripcion="Lo generamos nosotros: la dirección no pasa por ninguna página de afuera.">
                <div className="space-y-4">
                    <div className="rounded-[10px] border border-border bg-white p-4 grid place-items-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/api/censo/qr?formato=png&tam=720" alt="QR del censo" className="w-full max-w-[320px]" />
                    </div>
                    <p className="text-[13px] text-center font-semibold tabular-nums break-all">{url}</p>
                    <div className="grid grid-cols-2 gap-2">
                        <a href="/api/censo/qr?formato=svg" download="qr-censo.svg"
                            className="h-10 rounded-full border border-border text-[13px] font-semibold hover:bg-accent inline-flex items-center justify-center gap-2"><Download size={14} /> SVG, para imprimir</a>
                        <a href="/api/censo/qr?formato=png&tam=2048" download="qr-censo.png"
                            className="h-10 rounded-full border border-border text-[13px] font-semibold hover:bg-accent inline-flex items-center justify-center gap-2"><Download size={14} /> PNG, para proyectar</a>
                    </div>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                        El SVG no se pixela por más grande que se imprima. Si el barrio tiene logo cargado en Ajustes →
                        Branding, va en el medio del PNG: el código se lee igual porque está hecho con corrección alta.
                    </p>
                </div>
            </CajonContenido>
        </Cajon>
    );
}
