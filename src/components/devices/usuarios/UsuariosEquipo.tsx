"use client";
/**
 * «Usuarios del equipo», en la ficha de un dispositivo (openspec usuarios-de-equipos, fase de lectura):
 * las cuentas locales con su clase y quién está conectado ahora y desde dónde. No escribe nada en el
 * equipo; lo único que cambia es la marca de «conocida», que vive en OmniAccess.
 */
import { useMemo, useState } from "react";
import { Info, Loader2, RefreshCw, ShieldCheck, UserRound, Users, Wifi, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Momento } from "@/components/ui/celdas";
import { Chip, Cargando, ErrorEstado } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { hace } from "@/lib/fechas";
import { CLASES, PROCEDENCIAS, type Procedencia } from "@/lib/usuarios-equipo/inventario";
import { useSessionRole } from "@/hooks/useSessionRole";
import { useDatos, type FichaUsuarios, type CuentaVista, type SesionVista } from "@/components/devices/usuarios/datos";
import { MarcarConocida, type QueMarcar } from "@/components/devices/usuarios/MarcarConocida";

export function UsuariosEquipo({ deviceId }: { deviceId: string }) {
    const { datos, error, cargando, traer } = useDatos<FichaUsuarios>(`/api/devices/${deviceId}/usuarios`);
    const { tiene } = useSessionRole();
    const puedeMarcar = tiene("dispositivos.usuarios");
    const [marcar, setMarcar] = useState<QueMarcar | null>(null);
    const [leyendo, setLeyendo] = useState(false);
    const leerAhora = async () => { setLeyendo(true); await traer("?leer=1"); setLeyendo(false); };

    const columnas = useMemo<ColumnaTabla<CuentaVista>[]>(() => [
        { clave: "nombre", titulo: "Cuenta", valor: (c) => c.nombre, celda: (c) => (
            <span className="flex items-center gap-2 min-w-0">
                <UserRound size={14} className="text-muted-foreground shrink-0" />
                <span className={c.desaparecida ? "line-through text-muted-foreground" : "font-semibold"}>{c.nombre}</span>
                {c.idEquipo && <span className="text-[11px] text-muted-foreground tabular-nums">id {c.idEquipo}</span>}
            </span>
        ) },
        { clave: "nivel", titulo: "Nivel", valor: (c) => c.nivel || "—" },
        { clave: "clase", titulo: "Clase", valor: (c) => CLASES[c.clase].rotulo, celda: (c) => (
            <span className="inline-flex items-center gap-1.5">
                <Pista texto={CLASES[c.clase].ayuda}><Chip tono={c.desaparecida ? "neutro" : CLASES[c.clase].tono}>{CLASES[c.clase].rotulo}</Chip></Pista>
                {c.conocida && <Pista titulo="Conocida" texto={`${c.conocidaMotivo || ""}${c.conocidaPor ? ` · marcó ${c.conocidaPor}` : ""}`}><ShieldCheck size={13} className="tono-bien" /></Pista>}
            </span>
        ) },
        { clave: "visto", titulo: "Vista", valor: (c) => c.desaparecida || c.ultimaVez, celda: (c) => c.desaparecida
            ? <span className="text-[12px] text-muted-foreground">ya no está · {hace(c.desaparecida)}</span>
            : <Momento t={c.ultimaVez} /> },
        { clave: "accion", titulo: "", auxiliar: true, alinear: "der", celda: (c) => (
            c.clase === "no-gestionada" && !c.conocida && !c.desaparecida && puedeMarcar
                ? <Button variant="outline" size="sm" onClick={() => setMarcar({ tipo: "cuenta", cuentaId: c.id, nombre: c.nombre, equipo: datos?.equipo.name || "el equipo" })}><ShieldCheck />Es conocida</Button>
                : null
        ) },
    ], [puedeMarcar, datos?.equipo.name]);

    if (cargando && !datos) return <Cargando texto="Leyendo las cuentas…" />;
    if (error && !datos) return <ErrorEstado mensaje={error} alReintentar={() => traer()} />;
    if (!datos) return null;
    const { equipo, lectura, cuentas, sesiones } = datos;

    if (!equipo.soporte) {
        return (
            <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
                <Info size={15} className="mt-0.5 shrink-0" />
                Las cuentas de esta marca todavía no se leen. Por ahora sólo Hikvision; el catálogo de marcas lo dice en Dispositivos.
            </p>
        );
    }
    const nunca = !lectura?.cuentasAt && !lectura?.sesionesAt;
    const visibles = cuentas.filter((c) => !c.desaparecida);
    const idas = cuentas.length - visibles.length;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                {equipo.soloLectura && <Pista texto="Este servidor sólo puede leer este equipo (OMNI_EQUIPOS_SOLO_LECTURA). Las cuentas se cambian desde el servidor de ese barrio."><Chip tono="info" icono={Lock}>Sólo lectura</Chip></Pista>}
                {nunca
                    ? <span>Todavía no se leyó. La lectura automática corre cada 5 minutos.</span>
                    : <span>Cuentas leídas {hace(lectura?.cuentasAt)} · sesiones {hace(lectura?.sesionesAt)}</span>}
                {lectura?.maxCuentas && <span className="tabular-nums">· admite hasta {lectura.maxCuentas} cuentas</span>}
                <Button variant="outline" size="sm" className="ml-auto" onClick={leerAhora} disabled={leyendo}>
                    {leyendo ? <Loader2 className="animate-spin" /> : <RefreshCw />}Leer ahora
                </Button>
            </div>
            {(lectura?.cuentasError || lectura?.sesionesError) && (
                <div className="rounded-[10px] border chip-aviso px-3 py-2 text-[12.5px] normal-case tracking-normal font-normal">
                    {lectura?.cuentasError && <div><b>Cuentas:</b> {lectura.cuentasError} Se muestra lo último leído.</div>}
                    {lectura?.sesionesError && lectura.sesionesError !== lectura.cuentasError && <div><b>Sesiones:</b> {lectura.sesionesError}</div>}
                </div>
            )}

            <Tabla filas={visibles} clave={(c) => c.id} columnas={columnas} controles={false} seleccionCeldas={false} filasFantasma={2}
                vacio={{ icono: Users, titulo: nunca ? "Sin lectura todavía" : "El equipo no informó cuentas", ayuda: nunca ? "Tocá «Leer ahora» para no esperar." : undefined }} />
            {idas > 0 && <p className="text-[11.5px] text-muted-foreground">{idas} {idas === 1 ? "cuenta que estaba ya no está" : "cuentas que estaban ya no están"} en el equipo: su historia queda en Auditoría.</p>}

            <div className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><Wifi size={13} /> Conectados ahora</div>
                {sesiones.length === 0
                    ? <p className="text-[12.5px] text-muted-foreground">{lectura?.sesionesAt ? "Nadie conectado en la última lectura." : "Sin lectura de sesiones todavía."}</p>
                    : <ul className="divide-y divide-border rounded-[10px] border border-border">
                        {sesiones.map((s) => <FilaSesion key={s.id} s={s} puedeMarcar={puedeMarcar} alMarcar={() => setMarcar({ tipo: "ip", ip: s.ip, cuenta: s.nombre, equipo: equipo.name })} />)}
                    </ul>}
                <p className="text-[11px] text-muted-foreground">Las sesiones se miran cada 5 minutos: una entrada más corta puede no verse.</p>
            </div>

            <MarcarConocida que={marcar} onCerrar={() => setMarcar(null)} onHecho={() => traer()} />
        </div>
    );
}

function FilaSesion({ s, puedeMarcar, alMarcar }: { s: SesionVista; puedeMarcar: boolean; alMarcar: () => void }) {
    const p = PROCEDENCIAS[s.procedencia as Procedencia] || PROCEDENCIAS.desconocida;
    return (
        <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]">
            <span className="font-semibold">{s.nombre}</span>
            <span className="tabular-nums text-muted-foreground">{s.ip}</span>
            <Chip tono={p.tono}>{s.origenNombre && s.procedencia !== "servidor" ? s.origenNombre : p.rotulo}</Chip>
            <span className="text-muted-foreground">vista desde {hace(s.vistaPrimera)}</span>
            {s.procedencia === "desconocida" && puedeMarcar && <Button variant="outline" size="sm" className="ml-auto" onClick={alMarcar}><ShieldCheck />Es conocida</Button>}
        </li>
    );
}
