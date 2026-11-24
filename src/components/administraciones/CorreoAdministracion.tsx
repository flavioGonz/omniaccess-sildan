"use client";

import { useState } from "react";
import { AtSign, CheckCircle2, KeyRound, Mail, Send, ShieldCheck, TriangleAlert, Trash2 } from "lucide-react";
import { sileo as toast } from "sileo";
import { guardarCorreoAdm, probarCorreoAdm, quitarCorreoAdm, type CorreoAdm } from "@/app/actions/administraciones";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { Button } from "@/components/ui/button";
import { Pista } from "@/components/ui/pista";
import { hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * La cuenta de correo de una administración (25/11).
 *
 * Nico: «tenemos que cargar una cuenta de correo para cada administración, con su clave de app cada
 * una, todas son Gmail… el objetivo es que cada administración envíe correos del sistema a sus lotes».
 *
 * Lo que se carga es la casilla, el nombre que ve quien recibe y la clave de aplicación. La clave no
 * vuelve nunca a esta pantalla: queda cifrada en el servidor y acá sólo se sabe si hay una. Al
 * guardarla se le pregunta a Gmail si la acepta, y eso queda a la vista (✓ y cuándo, o lo que dijo).
 */
const ENTRADA = "h-9 w-full px-3 rounded-[6px] border border-border bg-background text-[13px]";

export function CorreoAdministracion({ id, nombre, correo, copia, alCambiar }: { id: string; nombre: string; correo: CorreoAdm; copia: string; alCambiar: () => void }) {
    const [f, setF] = useState({ cuenta: correo.cuenta || "", nombre: correo.nombre || "", clave: "" });
    const [guardando, setGuardando] = useState(false);
    const [probando, setProbando] = useState<"" | "probar" | "mandar">("");
    const [prueba, setPrueba] = useState("");

    const lista = !!correo.cuenta && correo.conClave && !!correo.probadoAt && !correo.error;
    const cambio = f.cuenta.trim().toLowerCase() !== (correo.cuenta || "") || f.nombre.trim() !== (correo.nombre || "") || !!f.clave.trim();

    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await guardarCorreoAdm(id, { cuenta: f.cuenta, nombre: f.nombre, clave: f.clave || undefined });
            if (!r.ok) toast.error({ title: "No se guardó", description: r.error });
            else if (r.probada) toast.success({ title: "Gmail aceptó la cuenta", description: `${nombre} ya puede escribirles a sus lotes.` });
            else toast.warning({ title: "Guardada, pero todavía no manda", description: r.aviso });
            if (r.ok) { setF((x) => ({ ...x, clave: "" })); alCambiar(); }
        } catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    };
    const probar = async (mandarA?: string) => {
        setProbando(mandarA ? "mandar" : "probar");
        try {
            const r = await probarCorreoAdm(id, mandarA || null);
            if (r.ok) toast.success({ title: mandarA ? "Salió el correo de prueba" : "Gmail acepta la cuenta", description: mandarA ? `Mirá la casilla de ${mandarA}.` : undefined });
            else toast.error({ title: "No anduvo", description: r.error });
            alCambiar();
        } finally { setProbando(""); }
    };

    return (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {/* ── La cuenta ── */}
            <section className="rounded-[14px] border border-border bg-card p-5">
                <div className="flex items-start gap-3">
                    <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[12px]", lista ? "chip-bien" : correo.cuenta ? "chip-aviso" : "bg-muted text-muted-foreground")}><Mail size={20} strokeWidth={1.8} /></span>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-bold leading-tight">Desde dónde escribe {nombre}</h3>
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground leading-snug">
                            Cada correo del sistema a un lote de esta administración —la invitación del censo, los avisos— sale desde esta casilla. Sin cuenta, a sus lotes no se les manda nada.
                        </p>
                    </div>
                </div>

                <div className="mt-4 space-y-3">
                    <label className="block">
                        <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold"><AtSign size={13} className="text-muted-foreground" /> Casilla de Gmail</span>
                        <input value={f.cuenta} onChange={(e) => setF({ ...f, cuenta: e.target.value })} placeholder="administracion@gmail.com" autoComplete="off" spellCheck={false} className={ENTRADA} />
                    </label>
                    <label className="block">
                        <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold"><Send size={13} className="text-muted-foreground" /> Nombre que ve quien recibe</span>
                        <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder={`San Nicolás · ${nombre}`} className={ENTRADA} />
                    </label>
                    <label className="block">
                        <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold">
                            <KeyRound size={13} className="text-muted-foreground" /> Clave de aplicación
                            <Pista ancho={300} titulo="Clave de aplicación de Gmail" texto="No es la clave de la cuenta: es una de 16 letras que se genera en la cuenta de Google › Seguridad › Contraseñas de aplicaciones (hace falta la verificación en dos pasos prendida). Se puede pegar con los espacios. Queda cifrada y no se vuelve a mostrar.">
                                <span className="cursor-help text-[11px] font-normal text-muted-foreground underline decoration-dotted">¿qué es?</span>
                            </Pista>
                        </span>
                        <input type="password" value={f.clave} onChange={(e) => setF({ ...f, clave: e.target.value })} autoComplete="new-password" spellCheck={false}
                            placeholder={correo.conClave ? "•••• •••• •••• ••••  (cargada; escribí otra para cambiarla)" : "xxxx xxxx xxxx xxxx"} className={cn(ENTRADA, "tracking-wider")} />
                    </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button onClick={guardar} disabled={guardando || !cambio || !f.cuenta.trim()}>{guardando ? <Loader2 size={14} /> : <ShieldCheck size={14} />} Guardar y probar</Button>
                    {correo.cuenta && <Button variant="ghost" size="sm" className="tono-mal ml-auto" onClick={async () => { await quitarCorreoAdm(id); setF({ cuenta: "", nombre: "", clave: "" }); alCambiar(); }}><Trash2 size={14} /> Quitar la cuenta</Button>}
                </div>
            </section>

            {/* ── Cómo está, y una prueba ── */}
            <section className="space-y-3">
                <div className={cn("rounded-[14px] border p-4", lista ? "chip-bien" : correo.cuenta ? "chip-aviso" : "border-border bg-card")}>
                    <p className="flex items-center gap-2 text-[13.5px] font-bold">
                        {lista ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
                        {lista ? "Lista para mandar" : !correo.cuenta ? "Sin cuenta de correo" : !correo.conClave ? "Falta la clave de aplicación" : correo.error ? "Gmail no la acepta" : "Sin probar"}
                    </p>
                    <p className="mt-1 text-[12.5px] leading-snug text-foreground/85">
                        {lista ? <>Gmail aceptó <b>{correo.cuenta}</b> {hace(correo.probadoAt)}.</>
                            : correo.error ? correo.error
                                : !correo.cuenta ? "Las invitaciones del censo de esta administración esperan hasta que se cargue."
                                    : "Cargá la clave y tocá «Guardar y probar»."}
                    </p>
                    {correo.cuenta && correo.conClave && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="outline" disabled={!!probando} onClick={() => probar()}>{probando === "probar" ? <Loader2 size={14} /> : <ShieldCheck size={14} />} Probar de nuevo</Button>
                        </div>
                    )}
                </div>

                {lista && (
                    <div className="rounded-[14px] border border-border bg-card p-4">
                        <p className="text-[13px] font-semibold">Mandar un correo de prueba</p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">Sale desde {correo.cuenta}, sin las copias fijas.</p>
                        <div className="mt-2.5 flex gap-2">
                            <input value={prueba} onChange={(e) => setPrueba(e.target.value)} placeholder="a quién (tu correo)" className={ENTRADA} />
                            <Button size="sm" disabled={!!probando || !prueba.trim()} onClick={() => probar(prueba.trim())}>{probando === "mandar" ? <Loader2 size={14} /> : <Send size={14} />} Mandar</Button>
                        </div>
                    </div>
                )}

                <div className="rounded-[14px] border border-border bg-card p-4 text-[12.5px] leading-snug">
                    <p className="font-semibold">Quién recibe copia oculta de cada correo</p>
                    <ul className="mt-2 space-y-1.5 text-muted-foreground">
                        <li className="flex items-start gap-2"><Mail size={13} className="mt-0.5 shrink-0" /><span>La propia casilla{correo.cuenta ? <> (<b className="text-foreground">{correo.cuenta}</b>)</> : ""}: así cada envío le queda en la bandeja, además de en Enviados.</span></li>
                        <li className="flex items-start gap-2"><Mail size={13} className="mt-0.5 shrink-0" /><span>{copia ? <>La copia fija: <b className="text-foreground">{copia}</b>.</> : "No hay copia fija cargada (Ajustes › Correo › Copia)."} El vecino no ve ninguna de las dos.</span></li>
                    </ul>
                </div>
            </section>
        </div>
    );
}
