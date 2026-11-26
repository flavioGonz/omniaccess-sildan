"use client";

import { useState } from "react";
import { FileText, Sheet, PackageOpen, KeyRound, HardDrive, Download, ShieldAlert, Check, Lock, Info } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/**
 * Exportar los equipos (26/11). Nico: «un botón para exportar todos los datos con portada premium y
 * los logos de OmniAccess: nombre, NVR, retención, usuario y clave del dispositivo, y si es NVR la
 * salud de los discos y el hardware. PDF y Excel estilizados, y una exportación de dispositivos con
 * sus áreas y parámetros hacia otras instancias de OmniAccess».
 *
 * Tres salidas, una decisión cada una:
 *  · Informe PDF — para mostrar o archivar: tapa, grabadores con sus discos, equipos por área.
 *  · Planilla Excel — lo mismo para trabajarlo: una fila por equipo, con filtros.
 *  · Paquete — para llevar los equipos a otra instancia. Los secretos, cifrados con una frase.
 *
 * Las claves nunca vienen por defecto: hay que pedirlas, se advierte qué significa, y queda en
 * Auditoría quién las bajó. El archivo se arma en el servidor y se baja con un POST (la frase del
 * paquete no viaja en la URL).
 */
type Formato = "pdf" | "xlsx" | "paquete";
const FORMATOS: { k: Formato; t: string; d: string; I: typeof FileText; tono: string }[] = [
    { k: "pdf", t: "Informe PDF", d: "Tapa con la marca, los grabadores con sus discos y cada equipo por área. Para mostrar o archivar.", I: FileText, tono: "text-red-500" },
    { k: "xlsx", t: "Planilla Excel", d: "Una fila por equipo con filtros, y hojas de grabadores, discos y áreas. Para trabajar los datos.", I: Sheet, tono: "text-emerald-600" },
    { k: "paquete", t: "Paquete para otra instancia", d: "Equipos, áreas y parámetros en un archivo para cargar en otro OmniAccess. Los secretos van cifrados.", I: PackageOpen, tono: "text-[var(--accion)]" },
];
const FRASE_MIN = 10;

export function ExportarEquipos({ abierto, alCerrar, puedeClaves }: { abierto: boolean; alCerrar: () => void; puedeClaves: boolean }) {
    const [formato, setFormato] = useState<Formato>("pdf");
    const [claves, setClaves] = useState(false);
    const [salud, setSalud] = useState(true);
    const [frase, setFrase] = useState("");
    const [repetir, setRepetir] = useState("");
    const [bajando, setBajando] = useState(false);

    const esPaquete = formato === "paquete";
    const fraseMal = esPaquete && !!frase && (frase.length < FRASE_MIN || frase !== repetir);
    const listo = !bajando && !fraseMal;

    const exportar = async () => {
        setBajando(true);
        try {
            const r = await fetch("/api/devices/exportar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formato, claves: !esPaquete && claves, salud, frase: esPaquete ? frase : undefined }) });
            if (!r.ok) { const j = await r.json().catch(() => null); toast.error({ title: "No se pudo exportar", description: j?.error || `El servidor contestó ${r.status}` }); return; }
            const blob = await r.blob();
            const nombre = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || `equipos.${formato === "paquete" ? "json" : formato}`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            toast.success({ title: "Listo", description: nombre });
            setFrase(""); setRepetir("");
        } catch { toast.error({ title: "No se pudo exportar", description: "Sin conexión con el servidor." }); }
        finally { setBajando(false); }
    };

    return (
        <Cajon open={abierto} onOpenChange={(v) => { if (!v && !bajando) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo="Exportar equipos" sinCerrar={bajando}
                descripcion="Todos los equipos con su grabación, su retención y su estado; los grabadores con sus discos. Se arma en el servidor con los datos de este momento."
                pie={
                    <div className="flex items-center gap-3 w-full">
                        <span className="text-[11.5px] text-muted-foreground flex-1">{claves && !esPaquete ? "Va con claves: queda registrado en Auditoría." : esPaquete && frase ? "Secretos cifrados con tu frase." : "Sin claves."}</span>
                        <Button variant="outline" onClick={alCerrar} disabled={bajando}>Cancelar</Button>
                        <Button onClick={exportar} disabled={!listo} className="gap-1.5 bg-[var(--accion)] text-white">
                            {bajando ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {bajando ? "Armando…" : "Exportar"}
                        </Button>
                    </div>
                }>
                <CajonSeccion titulo="Qué querés bajar" icono={Download}>
                    <div className="grid gap-2">
                        {FORMATOS.map((x) => (
                            <button key={x.k} type="button" onClick={() => setFormato(x.k)} aria-pressed={formato === x.k}
                                className={cn("flex items-start gap-3 rounded-[10px] border p-3.5 text-left transition-colors", formato === x.k ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border hover:bg-accent/50")}>
                                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted", x.tono)}><x.I size={17} /></span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[13px] font-semibold">{x.t}</span>
                                    <span className="block text-[12px] text-muted-foreground">{x.d}</span>
                                </span>
                                {formato === x.k && <Check size={16} className="mt-1 shrink-0 text-[var(--accion)]" />}
                            </button>
                        ))}
                    </div>
                </CajonSeccion>

                {!esPaquete && (
                    <CajonSeccion titulo="Qué incluye" icono={Info}>
                        <Interruptor on={salud} cambiar={setSalud} icono={HardDrive} titulo="Salud de los grabadores, en vivo"
                            detalle="Pregunta ahora a cada NVR por sus discos (estado, capacidad, ocupado), memoria y hace cuánto está prendido. Tarda unos segundos más." />
                        <Interruptor on={claves} cambiar={setClaves} icono={KeyRound} titulo="Usuario y clave de cada equipo" peligro deshabilitado={!puedeClaves}
                            detalle={puedeClaves ? "El usuario va siempre; con esto va también la clave, en claro. El archivo pasa a ser una llave de todos los equipos: no lo mandes por correo ni lo dejes en una carpeta compartida." : "Hace falta el permiso Editar dispositivos."} />
                        {claves && (
                            <div className="flex items-start gap-2.5 rounded-[10px] border border-red-500/30 bg-red-500/5 p-3 text-[12px]">
                                <ShieldAlert size={15} className="tono-mal mt-0.5 shrink-0" />
                                <span>El {formato === "pdf" ? "PDF" : "Excel"} va a decir «Confidencial: incluye claves» en la tapa y en cada hoja, y la bajada queda en Auditoría con tu usuario.</span>
                            </div>
                        )}
                    </CajonSeccion>
                )}

                {esPaquete && (
                    <CajonSeccion titulo="Secretos del paquete" icono={Lock}
                        ayuda="Usuarios, claves y URL RTSP. Con una frase van cifrados (AES-256); sin frase no van, y en la otra instancia se cargan a mano.">
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                                <span className="block text-[12px] font-semibold mb-1.5">Frase</span>
                                <input type="password" value={frase} onChange={(e) => setFrase(e.target.value)} disabled={!puedeClaves} autoComplete="new-password" placeholder={puedeClaves ? `Mínimo ${FRASE_MIN} caracteres` : "Sin permiso"}
                                    className="h-10 w-full rounded-[6px] border border-border bg-background px-3 text-[13px] outline-none focus:border-[var(--accion)] disabled:opacity-60" />
                            </label>
                            <label className="block">
                                <span className="block text-[12px] font-semibold mb-1.5">Repetila</span>
                                <input type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)} disabled={!puedeClaves || !frase} autoComplete="new-password"
                                    className="h-10 w-full rounded-[6px] border border-border bg-background px-3 text-[13px] outline-none focus:border-[var(--accion)] disabled:opacity-60" />
                            </label>
                        </div>
                        {fraseMal && <p className="text-[11.5px] tono-mal">{frase.length < FRASE_MIN ? `Le faltan ${FRASE_MIN - frase.length} caracteres.` : "Las dos frases no coinciden."}</p>}
                        <p className="text-[11.5px] text-muted-foreground">La frase no se guarda en ningún lado: sin ella, los secretos del paquete no se pueden abrir. Pasala por otro camino que el archivo.</p>
                        <Interruptor on={salud} cambiar={setSalud} icono={HardDrive} titulo="Incluye áreas, grupos y grabaciones" detalle="El árbol de áreas, en qué área está cada equipo, sus grupos de acceso, en qué NVR y canal graba, la calibración de lectura y las geometrías." fijo />
                    </CajonSeccion>
                )}
            </CajonContenido>
        </Cajon>
    );
}

function Interruptor({ on, cambiar, icono: I, titulo, detalle, peligro, deshabilitado, fijo }: { on: boolean; cambiar: (v: boolean) => void; icono: typeof FileText; titulo: string; detalle: string; peligro?: boolean; deshabilitado?: boolean; fijo?: boolean }) {
    return (
        <button type="button" role="switch" aria-checked={fijo ? true : on} disabled={deshabilitado || fijo} onClick={() => cambiar(!on)}
            className={cn("flex w-full items-start gap-3 rounded-[10px] border border-border p-3 text-left transition-colors disabled:cursor-default", !deshabilitado && !fijo && "hover:bg-accent/40", deshabilitado && "opacity-60")}>
            <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted", peligro && on ? "tono-mal" : "text-muted-foreground")}><I size={15} /></span>
            <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{titulo}</span>
                <span className="block text-[11.5px] text-muted-foreground">{detalle}</span>
            </span>
            {!fijo && <span className={cn("mt-1 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors", on ? (peligro ? "bg-red-500" : "bg-[var(--accion)]") : "bg-muted-foreground/30")}>
                <span className={cn("block h-4 w-4 rounded-full bg-white transition-transform", on && "translate-x-4")} />
            </span>}
            {fijo && <Check size={15} className="mt-1 shrink-0 text-[var(--accion)]" />}
        </button>
    );
}
