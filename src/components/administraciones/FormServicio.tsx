"use client";

import { useState } from "react";
import { Building2, CheckCircle2, Truck } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import { guardarServicioAdm, type ServicioAdm } from "@/app/actions/administraciones";
import { Button } from "@/components/ui/button";
import { Cajon, CajonCampo, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { cn } from "@/lib/utils";

/**
 * El cajón de un servicio que contrata una administración (jardinería, recolección, mantenimiento).
 *
 * Vivía adentro de la página de Administraciones. Salió a su archivo el 28/11, cuando Usuarios ›
 * Proveedores empezó a juntar los proveedores del barrio, los de las administraciones y los de cada
 * lote: desde esa lista se corrige con este mismo cajón, en vez de escribir un segundo formulario
 * que con el tiempo diría otra cosa.
 */

const ENTRADA = "h-9 w-full px-3 rounded-[6px] border border-border bg-background text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/40 focus-visible:border-[var(--accion)]";
const RUBROS = ["Jardinería", "Recolección de residuos", "Mantenimiento", "Piscinas", "Seguridad", "Limpieza", "Iluminación", "Caminería", "Fumigación"];
export function FormServicio({ administracionId, nombreAdm, s, alCerrar, alGuardar }: { administracionId: string; nombreAdm: string; s: Partial<ServicioAdm>; alCerrar: () => void; alGuardar: () => void }) {
    const [f, setF] = useState({ rubro: s.rubro || "", proveedor: s.proveedor || "", contacto: s.contacto || "", telefono: s.telefono || "", email: s.email || "", horario: s.horario || "", notas: s.notas || "" });
    const [guardando, setGuardando] = useState(false);
    const guardar = async () => {
        setGuardando(true);
        try { const r = await guardarServicioAdm(administracionId, { id: s.id, ...f }); if (!r.ok) toast.error({ title: "No se guardó", description: r.error }); else alGuardar(); }
        catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    };
    return (
        <Cajon open onOpenChange={(x) => { if (!x && !guardando) alCerrar(); }}>
            <CajonContenido ancho="angosto" titulo={s.id ? "Editar el servicio" : "Agregar un servicio"} descripcion={`Algo que contrata ${nombreAdm || "esta administración"} para sus lotes o sus áreas comunes.`}
                pie={<><Button variant="ghost" onClick={alCerrar} disabled={guardando}>Cancelar</Button><Button onClick={guardar} disabled={guardando || !f.rubro.trim()}>{guardando ? <Loader2 size={14} /> : <CheckCircle2 size={14} />} Guardar</Button></>}>
                <CajonSeccion titulo="Qué servicio" icono={Truck}>
                    <CajonCampo etiqueta="Servicio"><input autoFocus value={f.rubro} onChange={(e) => setF({ ...f, rubro: e.target.value })} placeholder="Jardinería, recolección, mantenimiento…" className={ENTRADA} /></CajonCampo>
                    <div className="flex flex-wrap gap-1.5 -mt-1">
                        {RUBROS.map((r) => (
                            <button key={r} type="button" onClick={() => setF({ ...f, rubro: r })} aria-pressed={f.rubro === r}
                                className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", f.rubro === r ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>{r}</button>))}
                    </div>
                    <CajonCampo etiqueta="Cuándo viene" ayuda="Para que la guardia sepa a quién espera y cuándo."><input value={f.horario} onChange={(e) => setF({ ...f, horario: e.target.value })} placeholder="Lunes y jueves, de 8 a 12" className={ENTRADA} /></CajonCampo>
                </CajonSeccion>
                <CajonSeccion titulo="Quién lo hace" icono={Building2}>
                    <CajonCampo etiqueta="Empresa"><input value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} className={ENTRADA} /></CajonCampo>
                    <CajonCampo etiqueta="Persona de contacto"><input value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} className={ENTRADA} /></CajonCampo>
                    <div className="grid grid-cols-2 gap-3">
                        <CajonCampo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" className={cn(ENTRADA, "tabular-nums")} /></CajonCampo>
                        <CajonCampo etiqueta="Correo"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} inputMode="email" className={ENTRADA} /></CajonCampo>
                    </div>
                    <CajonCampo etiqueta="Notas"><textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} rows={3} className={cn(ENTRADA, "h-auto py-2 leading-snug")} /></CajonCampo>
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}
