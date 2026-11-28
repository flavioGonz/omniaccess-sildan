"use client";

import { useMemo, useState } from "react";
import { MapPinned, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/estados";
import { Matricula } from "@/components/ui/celdas";
import { Seek } from "@/components/ui/search";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import type { LoteAdm } from "@/app/actions/administraciones";

/**
 * La tabla de lotes: la de cada administración y, desde el 25/11, la de Unidades con todas juntas.
 *
 * Nico: «/admin/units debe cambiar por completo; ya tenemos la estructura bien definida en
 * Administraciones: traer esa tabla aquí, y drawers etc., y que sea una tabla igual para poder buscar
 * unidades con sus datos». Por eso vive acá y no adentro de la pantalla de Administraciones: es la
 * misma tabla, con las mismas columnas y el mismo cajón, en los dos lugares. En Unidades suma la
 * columna de la administración y la de las matrículas, y el buscador busca también por chapa,
 * teléfono y administración.
 */

export type FiltroLotes = "todos" | "gente" | "sin" | "terrenos";
export const SITUACION: Record<string, { rotulo: string; tono: "quieto" | "info" | "aviso" }> = {
    TERRENO: { rotulo: "Terreno", tono: "quieto" }, DESARROLLADOR: { rotulo: "Del desarrollador", tono: "info" }, SIN_TITULAR: { rotulo: "Sin titular", tono: "aviso" },
};
export const VINCULO: Record<string, string> = { PROPIETARIO: "propietario", INQUILINO: "inquilino", OCUPANTE: "ocupante", FAMILIA: "familia" };
const CODIGO: Record<string, { punto: string; dice: string }> = {
    sin: { punto: "bg-muted-foreground/40", dice: "sin código del censo" }, listo: { punto: "bg-[var(--aviso)]", dice: "código listo, sin enviar" },
    enviado: { punto: "bg-[var(--info)]", dice: "código enviado" }, cargo: { punto: "bg-[var(--bien)]", dice: "ya cargó su censo" },
};
const soloLetras = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

export function TablaLotes({ filas, alAbrir, filtro, alFiltrar: setFiltro, conAdministracion, alto = "calc(100vh - 260px)", id, nombreArchivo = "lotes", vacioSinLotes }: {
    filas: LoteAdm[] | null;
    alAbrir: (id: string) => void;
    filtro: FiltroLotes;
    alFiltrar: (f: FiltroLotes) => void;
    /** Varias administraciones juntas (Unidades): suma su columna y la de matrículas. */
    conAdministracion?: boolean;
    alto?: string;
    id?: string;
    nombreArchivo?: string;
    vacioSinLotes?: string;
}) {
    const [q, setQ] = useState("");
    const todos = useMemo(() => filas || [], [filas]);
    const n = useMemo(() => ({ todos: todos.length, gente: todos.filter((l) => l.personas.length).length, sin: todos.filter((l) => !l.situacion && !l.personas.length).length, terrenos: todos.filter((l) => l.situacion === "TERRENO").length }), [todos]);
    const vistos = useMemo(() => {
        const t = q.trim().toLowerCase(), chapa = soloLetras(t), digitos = t.replace(/\D/g, "");
        return todos.filter((l) => (filtro === "todos" || (filtro === "gente" && l.personas.length > 0) || (filtro === "sin" && !l.situacion && !l.personas.length) || (filtro === "terrenos" && l.situacion === "TERRENO"))
            && (!t
                || [l.nombre, l.titular, l.edificio, l.observaciones, l.administracion?.nombre, ...l.personas.flatMap((p) => [p.nombre, p.email]), ...(l.servicios || []).map((sv) => sv.rotulo)].some((x) => (x || "").toLowerCase().includes(t))
                || (chapa.length >= 3 && [...(l.chapas || []), ...(l.servicios || []).map((sv) => sv.chapa || "")].some((c) => c && soloLetras(c).includes(chapa)))
                || (digitos.length >= 4 && l.personas.some((p) => (p.telefono || "").replace(/\D/g, "").includes(digitos)))));
    }, [todos, q, filtro]);
    const cols = useMemo<ColumnaTabla<LoteAdm>[]>(() => [
        { clave: "lote", titulo: "Lote", ancho: 150, ordenable: true, valor: (l) => l.nombre, celda: (l) => (
            <div className="leading-tight"><div className="text-[13px] font-bold tabular-nums">{l.codigo}</div>{l.edificio && <div className="text-[11px] text-muted-foreground">{l.edificio}</div>}</div>) },
        ...(conAdministracion ? [{ clave: "adm", titulo: "Administración", ancho: 180, ordenable: true, valor: (l: LoteAdm) => l.administracion?.nombre || "",
            celda: (l: LoteAdm) => l.administracion ? <span className="inline-flex items-center gap-1.5 text-[12.5px]"><span className="grid h-5 min-w-[28px] shrink-0 place-items-center whitespace-nowrap rounded-[6px] bg-muted px-1 text-[10.5px] font-bold tabular-nums">{l.administracion.sigla}</span><span className="truncate">{l.administracion.nombre}</span></span> : <span className="text-[12px] text-muted-foreground">Sin administración</span> } as ColumnaTabla<LoteAdm>] : []),
        { clave: "titular", titulo: "Titular según la administración", ayuda: "Como figura en la lista de gastos comunes. «X - Y» es un matrimonio; «X / Y», propietario e inquilino. Es un texto de la administración, no una persona del padrón.",
            valor: (l) => l.titular || "", celda: (l) => (
                <div className="leading-tight min-w-0"><div className="text-[12.5px] truncate">{l.titular || <span className="text-muted-foreground">—</span>}</div>{l.observaciones && <div className="text-[11px] text-muted-foreground line-clamp-1" title={l.observaciones}>{l.observaciones}</div>}</div>) },
        { clave: "personas", titulo: "Personas con correo", ayuda: "La gente del lote. El punto dice cómo va su censo: ámbar listo sin enviar, azul enviado, verde ya cargó. La principal es a quien se le manda primero el código del lote.",
            valor: (l) => l.personas.map((p) => `${p.nombre} (${VINCULO[p.vinculo] || p.vinculo || "sin vínculo"})`).join("; "), celda: (l) => l.personas.length === 0 ? <span className="text-[12px] text-muted-foreground">—</span> : (
                <ul className="space-y-0.5">{l.personas.map((p) => (
                    <li key={p.id} className="flex items-center gap-1.5 text-[12.5px] min-w-0" title={`${p.email || "sin correo"} · ${CODIGO[p.codigo].dice}`}>
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CODIGO[p.codigo].punto)} />
                        <span className={cn("truncate", p.principal && "font-semibold")}>{p.nombre}</span><span className="shrink-0 text-[11px] text-muted-foreground">{VINCULO[p.vinculo] || p.vinculo || "sin vínculo"}{p.principal ? " · principal" : ""}</span>
                    </li>))}</ul>) },
        ...(conAdministracion ? [{ clave: "chapas", titulo: "Matrículas", valor: (l: LoteAdm) => (l.chapas || []).join(" "),
            celda: (l: LoteAdm) => (l.chapas || []).length ? <span className="flex flex-wrap gap-1">{(l.chapas || []).slice(0, 4).map((c) => <Matricula key={c} p={c} />)}{(l.chapas || []).length > 4 && <span className="text-[11px] text-muted-foreground">+{(l.chapas || []).length - 4}</span>}</span> : <span className="text-[12px] text-muted-foreground">—</span> } as ColumnaTabla<LoteAdm>,
            { clave: "servicios", titulo: "Servicios", valor: (l: LoteAdm) => (l.servicios || []).map((sv) => sv.rotulo).join(" · "),
                celda: (l: LoteAdm) => (l.servicios || []).length ? <span className="inline-flex items-center gap-1.5 text-[12px]" title={(l.servicios || []).map((sv) => sv.rotulo).join("\n")}><Wrench size={12} className="text-muted-foreground" /><span className="truncate max-w-[180px]">{(l.servicios || [])[0].rotulo}</span>{(l.servicios || []).length > 1 && <span className="text-[11px] text-muted-foreground">+{(l.servicios || []).length - 1}</span>}</span> : <span className="text-[12px] text-muted-foreground">—</span> } as ColumnaTabla<LoteAdm>] : []),
        { clave: "situacion", titulo: "Situación", ancho: 150, valor: (l) => (l.situacion ? SITUACION[l.situacion]?.rotulo || l.situacion : ""), celda: (l) => (l.situacion && SITUACION[l.situacion] ? <Chip tono={SITUACION[l.situacion].tono}>{SITUACION[l.situacion].rotulo}</Chip> : null) },
        ...(conAdministracion ? [] : [{ clave: "area", titulo: "Área", ancho: 100, alinear: "der", ordenable: true, valor: (l: LoteAdm) => l.areaM2 ?? "", celda: (l: LoteAdm) => (l.areaM2 ? <span className="text-[12px] tabular-nums text-muted-foreground">{Math.round(l.areaM2).toLocaleString("es-UY")} m²</span> : null) } as ColumnaTabla<LoteAdm>]),
    ], [conAdministracion]);
    const OPC: { v: FiltroLotes; r: string }[] = [{ v: "todos", r: "Todos" }, { v: "gente", r: "Con gente" }, { v: "sin", r: "Sin nadie con correo" }, { v: "terrenos", r: "Terrenos" }];
    return (
        <Tabla filas={vistos} cargando={!filas} clave={(l) => l.id} columnas={cols} alto={alto} id={id} nombreArchivo={nombreArchivo} alClickFila={(l) => alAbrir(l.id)}
            barra={(
                <div className="flex flex-wrap items-center gap-2">
                    <Seek value={q} onChange={setQ} placeholder={conAdministracion ? "Lote, titular, persona, correo, teléfono o matrícula" : "Lote, titular o persona"} startOpen width={conAdministracion ? 320 : 240} alto={34} />
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qué lotes">
                        {OPC.map((o) => (
                            <button key={o.v} type="button" aria-pressed={filtro === o.v} onClick={() => setFiltro(o.v)}
                                className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold inline-flex items-center gap-1.5", filtro === o.v ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>
                                {o.r}<span className={cn("tabular-nums text-[10.5px]", filtro === o.v ? "opacity-70" : "text-muted-foreground")}>{n[o.v]}</span>
                            </button>))}
                    </div>
                    {q.trim() && <span className="ml-auto text-[11.5px] text-muted-foreground tabular-nums">{vistos.length} de {todos.length}</span>}
                </div>)}
            vacio={{ icono: MapPinned, titulo: todos.length ? "Ningún lote coincide" : vacioSinLotes || "Esta administración no tiene lotes", ayuda: todos.length ? "Probá con otro filtro o con menos texto." : "Los lotes llegan con la planilla del padrón: «Importar padrón», en Administraciones." }} />
    );
}
