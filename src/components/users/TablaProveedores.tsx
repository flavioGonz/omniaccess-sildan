"use client";

import { useMemo } from "react";
import { Brush, Building2, ClipboardCheck, Clock, DoorOpen, Eye, Home, IdCard, Info, KeyRound, Landmark, Mail, Phone, Shovel, Truck, UserX, Waves, Wrench } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Matricula, Nada } from "@/components/ui/celdas";
import { Chip } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import type { EntradaProveedor, OrigenProveedor, ProveedorReunido } from "@/lib/proveedores-reunidos";

/**
 * Usuarios › Proveedores: los del barrio, los de las administraciones y los de cada lote, juntos
 * (28/11, Nico: «ese panel debe juntarlos y distinguirlos», «indicando a qué lote pertenece»).
 *
 * La pestaña mostraba sólo a las personas del padrón con rol de proveedor. El jardinero de una casa
 * estaba en el cajón de su lote y el de la comisión en Administraciones: para saber de quién era
 * una camioneta había que saber de antemano dónde ir a buscarla.
 *
 * Cómo se distinguen. La columna «De quién» dice de dónde sale cada fila con un dibujo y dos
 * renglones —el barrio, una administración, un lote—, y NO con un color: el color en esta
 * aplicación dice cómo están las cosas, no de qué clase son. El único color de la tabla está en
 * «Entrada», que sí es estado: entra solo, se lo reconoce pero no entra, o dejó de venir.
 */

const DIBUJO_TIPO: Record<string, React.ComponentType<{ size?: number; className?: string }>> = { JARDINERO: Shovel, PISCINERO: Waves, LIMPIEZA: Brush, OTRO: Wrench };

export const ORIGEN: Record<OrigenProveedor, { icono: React.ComponentType<{ size?: number; className?: string }>; rotulo: string; plural: string; que: string }> = {
    barrio: { icono: Building2, rotulo: "Del barrio", plural: "del barrio", que: "Del padrón del barrio. Tiene sus propias credenciales y entra con ellas. Se carga y se corrige acá." },
    administracion: { icono: Landmark, rotulo: "Administraciones", plural: "de administraciones", que: "Lo que contrata una administración para sus lotes o sus áreas comunes. Dice a quién espera la guardia; no abre el portón." },
    lote: { icono: Home, rotulo: "Lotes", plural: "de lotes", que: "El jardinero, el piscinero o la limpieza de una casa. Lo declara el residente o lo carga la administración en el cajón del lote." },
};

const ENTRADA: Record<EntradaProveedor, { rotulo: string; tono: "bien" | "quieto" | "neutro" | "aviso"; icono: React.ComponentType<{ size?: number }>; titulo: string; texto: string }> = {
    credencial: { rotulo: "Con credencial", tono: "bien", icono: KeyRound, titulo: "Entra con su credencial", texto: "Es del padrón: pasa con su matrícula, tag, PIN o rostro, según sus grupos y horarios." },
    "sin-credencial": { rotulo: "Sin credencial", tono: "quieto", icono: UserX, titulo: "No tiene con qué entrar", texto: "Está en el padrón pero sin matrícula, tag, PIN ni rostro cargados. La guardia lo anuncia a mano." },
    horario: { rotulo: "Entra en su horario", tono: "bien", icono: DoorOpen, titulo: "Entrada habilitada", texto: "Entra por su matrícula sólo en sus días y su horario, con media hora de margen. Fuera de horario queda denegado y la guardia ve de qué lote es." },
    identifica: { rotulo: "Sólo se identifica", tono: "quieto", icono: Eye, titulo: "Se lo reconoce, no entra solo", texto: "El monitor dice quién es y a qué lote viene, pero la barrera no le abre. La entrada se habilita en el cajón del lote, con su matrícula y sus días." },
    // Gris y no el violeta de «quieto»: no es un proveedor esperando que le habiliten algo, es un dato.
    informativo: { rotulo: "Informativo", tono: "neutro", icono: Info, titulo: "Para saber a quién se espera", texto: "Es un servicio de la administración: dice quién viene y cuándo. No tiene matrícula ni abre el portón." },
    baja: { rotulo: "Dejó de venir", tono: "aviso", icono: UserX, titulo: "Dado de baja", texto: "Queda en el registro del lote, apagado. Se vuelve a activar desde el cajón del lote." },
};

/** De quién es, en dos renglones: el nombre arriba, qué clase de dueño abajo. */
function DeQuien({ f }: { f: ProveedorReunido }) {
    const o = ORIGEN[f.origen], I = o.icono;
    const arriba = f.origen === "barrio" ? "Todo el barrio" : f.de?.nombre || "—";
    const abajo = f.origen === "barrio" ? "Proveedor del padrón" : f.origen === "administracion" ? "Servicio de la administración" : "Servicio del lote";
    return (
        <div className="flex items-center gap-2 min-w-0">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] bg-muted text-muted-foreground"><I size={14} /></span>
            <div className="min-w-0 leading-tight">
                <div className="truncate text-[12.5px] font-semibold text-foreground">{arriba}</div>
                <div className="truncate text-[10.5px] text-muted-foreground">{abajo}</div>
            </div>
            {f.tambienEn.length > 0 && (
                <Pista titulo="El mismo vehículo viene a otros lotes" texto={<span className="block space-y-0.5">{f.tambienEn.map((l) => <span key={l} className="block">{l}</span>)}</span>}>
                    <span className="shrink-0 cursor-help text-[10.5px] font-semibold tabular-nums text-muted-foreground">+{f.tambienEn.length}</span>
                </Pista>
            )}
        </div>
    );
}

export function TablaProveedores({ filas, cargando, error, alReintentar, alAbrir, barra, pie, hayMas, traerMas }: {
    filas: ProveedorReunido[];
    cargando?: boolean;
    error?: string | null;
    alReintentar?: () => void;
    alAbrir: (f: ProveedorReunido) => void;
    barra?: React.ReactNode;
    pie?: React.ReactNode;
    /** Con cuatrocientos lotes y dos servicios cada uno son ochocientas filas: se traen de a tandas. */
    hayMas?: boolean;
    traerMas?: () => void;
}) {
    const columnas = useMemo<ColumnaTabla<ProveedorReunido>[]>(() => [
        {
            clave: "quien", titulo: "Proveedor", ancho: 290, ordenable: true,
            valor: (f) => [f.nombre, f.rubro].filter(Boolean).join(" · "),
            celda: (f) => {
                const I = f.origen === "lote" ? DIBUJO_TIPO[f.tipo || "OTRO"] || Wrench : Truck;
                return (
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><I size={15} /></span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate text-[13px] font-semibold text-foreground">{f.nombre || f.rubro}</span>
                                {f.declarado && (
                                    <Pista titulo={f.declarado === "censo" ? "Lo declaró el residente en el censo" : "Lo cargó el residente en su portal"} texto="No lo cargó la administración: son los datos tal como los escribió la casa.">
                                        <span className="shrink-0 cursor-help"><Chip tono="info" icono={ClipboardCheck}>{f.declarado === "censo" ? "Censo" : "Portal"}</Chip></span>
                                    </Pista>
                                )}
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">{f.nombre ? f.rubro : "Sin nombre cargado"}{f.contacto ? ` · ${f.contacto}` : ""}</div>
                        </div>
                    </div>
                );
            },
        },
        {
            clave: "de", titulo: "De quién", ancho: 220, ordenable: true,
            tituloAyuda: "A quién le trabaja",
            ayuda: "De dónde sale cada proveedor: el padrón del barrio, lo que contrata una administración, o el servicio de un lote. En los de lote dice a qué lote viene; el «+2» marca que el mismo vehículo figura en otros lotes.",
            valor: (f) => (f.origen === "barrio" ? "Todo el barrio" : `${f.origen === "lote" ? "Lote" : "Administración"} ${f.de?.nombre || ""}`),
            celda: (f) => <DeQuien f={f} />,
        },
        {
            clave: "cuando", titulo: "Cuándo viene", ancho: 190,
            valor: (f) => f.cuando,
            celda: (f) => (f.cuando ? <span className="inline-flex items-center gap-1.5 text-[12px]"><Clock size={11} className="shrink-0 text-muted-foreground" />{f.cuando}</span> : <Nada />),
        },
        {
            clave: "contacto", titulo: "Contacto", ancho: 180,
            valor: (f) => [f.telefono, f.email, f.documento].filter(Boolean).join(" · "),
            celda: (f) => (f.telefono || f.email || f.documento ? (
                <div className="leading-tight text-[11.5px] text-muted-foreground">
                    {f.telefono && <div className="inline-flex items-center gap-1 tabular-nums text-foreground"><Phone size={10} />{f.telefono}</div>}
                    {f.email && <div className="flex items-center gap-1 truncate max-w-[165px]"><Mail size={10} className="shrink-0" /><span className="truncate">{f.email}</span></div>}
                    {f.documento && <div className="flex items-center gap-1 tabular-nums"><IdCard size={10} />{f.documento}</div>}
                </div>
            ) : <Nada />),
        },
        {
            clave: "chapas", titulo: "Matrículas", alinear: "centro", ancho: 150,
            tituloAyuda: "Con qué vehículo viene",
            ayuda: "La matrícula con la que se lo reconoce en las cámaras. Los servicios de una administración no llevan matrícula.",
            valor: (f) => f.chapas.join(" "),
            celda: (f) => {
                if (!f.chapas.length) return <Nada />;
                return f.chapas.length === 1 ? <Matricula p={f.chapas[0]} /> : (
                    <Pista titulo="Matrículas" texto={<span className="block space-y-0.5">{f.chapas.map((p) => <span key={p} className="block tabular-nums tracking-wider">{p}</span>)}</span>}>
                        <span className="inline-flex cursor-help items-center gap-1"><Matricula p={f.chapas[0]} /><span className="text-[10px] text-muted-foreground">+{f.chapas.length - 1}</span></span>
                    </Pista>
                );
            },
        },
        {
            clave: "entrada", titulo: "Entrada", ancho: 170, ordenable: true,
            tituloAyuda: "Qué pasa en el portón",
            ayuda: "Un proveedor del padrón entra con su credencial. Uno de un lote se identifica y, si se le habilitó, entra por su matrícula en sus días y horario. Los de una administración son informativos.",
            valor: (f) => ENTRADA[f.entrada].rotulo,
            celda: (f) => {
                const e = ENTRADA[f.entrada];
                return <Pista titulo={e.titulo} texto={e.texto} ancho={260}><span className="cursor-help"><Chip tono={e.tono} icono={e.icono}>{e.rotulo}</Chip></span></Pista>;
            },
        },
    ], []);

    return (
        <Tabla<ProveedorReunido>
            id="proveedores"
            nombreArchivo="proveedores"
            filas={filas}
            clave={(f) => f.clave}
            columnas={columnas}
            barra={barra}
            cargando={cargando}
            error={error}
            alReintentar={alReintentar}
            vacio={{
                icono: Truck,
                titulo: "Sin proveedores",
                ayuda: "Probá con otra búsqueda. Los del barrio se cargan acá; los de una administración, en Administraciones › Servicios; los de un lote, en el cajón del lote o los declara el residente en el censo.",
            }}
            alClickFila={alAbrir}
            claseFila={(f) => (f.entrada === "baja" ? "opacity-60" : undefined)}
            masFilas={hayMas && traerMas ? { hay: hayMas, cargando, traer: traerMas, modo: "scroll" } : undefined}
            alto="calc(100vh - 300px)"
            pie={pie}
        />
    );
}
