"use client";

import { useEffect, useState } from "react";
import { Radar, Radio, Siren, type LucideIcon } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { FilaFuncion } from "@/components/ajustes/piezas-funciones";
import { FUNCIONES, FUNCIONES_INSTALACION, dependenciaCumplida, type FuncionId, type Funcion } from "@/lib/funciones";
import { MODULE_DEFINITIONS, type ModuleId } from "@/lib/module-definitions";
import { getEnabledModules } from "@/app/actions/modules";
import { getFunciones, toggleFuncion } from "@/app/actions/funciones";
import { fijarMarcasCamara } from "@/lib/marca-vehiculo";
import { fijarFuncion } from "@/lib/funciones-cliente";

/**
 * Características: todo lo que esta instalación puede prender y apagar, en un solo lugar.
 *
 * Pedido de Nico (18/11): «donde estén todas las built-in features juntas, así podemos activarlas
 * ahí y sacarlas de Modo de la instalación, que no dependen del modo LPR necesariamente».
 *
 * El orden que arregla: **un modo es qué hace esta instalación** (matrículas, rostro, filas, y hay
 * uno solo puesto); **una característica es algo que puede hacer o no hacer**. La intrusión, las
 * alarmas y el censo valen igual con cualquier modo, y estaban colgando de la pantalla de modos
 * por donde se habían escrito primero, no por donde correspondían.
 *
 * Las que SÍ dependen de un modo siguen diciéndolo —van agrupadas bajo su modo y sólo aparecen si
 * ese modo está puesto—, porque prender «estadías» con el modo Rostro no significaría nada.
 */
const ICONO_FUNCION: Partial<Record<FuncionId, LucideIcon>> = { FUNC_INTRUSION: Radar, FUNC_ALARMAS_RECEPCION: Radio, FUNC_ALARMAS_GESTION: Siren };

export default function CaracteristicasSection({ extra }: {
    /** Lo que es una característica pero no vive en `lib/funciones` todavía: hoy, Omni-LPR. */
    extra?: React.ReactNode;
}) {
    const [funciones, setFunciones] = useState<Record<string, boolean>>({});
    const [modulos, setModulos] = useState<Record<string, boolean>>({});
    const [alternando, setAlternando] = useState<string | null>(null);
    /** Apagar una característica de la instalación se confirma: saca menús, alertas y hasta puertos. */
    const [confirmar, setConfirmar] = useState<Funcion | null>(null);

    useEffect(() => {
        getFunciones().then(setFunciones).catch(() => { });
        getEnabledModules().then(setModulos).catch(() => { });
    }, []);

    const prendido = (id: ModuleId) => modulos[id] ?? MODULE_DEFINITIONS.find((m) => m.id === id)?.defaultEnabled ?? false;

    const alternarFuncion = async (f: Funcion) => {
        setAlternando(f.id);
        // `f.porDefecto` y no `true`: una característica que nace apagada tiene que prenderse al
        // primer clic aunque su valor todavía no esté leído.
        const valor = !(funciones[f.id] ?? f.porDefecto);
        const r = await toggleFuncion(f.id as FuncionId, valor);
        if (r.ok) {
            setFunciones((p) => ({ ...p, [f.id]: valor }));
            if (f.id === "LPR_MARCAS") fijarMarcasCamara(valor);  // el resto del panel, sin recargar
            fijarFuncion(f.id, valor);  // menú, monitor, fichas: lo ven sin recargar (lib/funciones-cliente)
            toast.success({ title: valor ? `${f.nombre}: activada` : `${f.nombre}: apagada` });
        } else {
            toast.error({ title: "No se pudo cambiar", description: r.error });
        }
        setAlternando(null);
    };

    /** Prender es directo; apagar pasa por el cajón que dice qué deja de pasar. */
    const pedir = (f: Funcion) => {
        const encendida = funciones[f.id] ?? f.porDefecto;
        if (f.alcance === "instalacion" && encendida) setConfirmar(f); else alternarFuncion(f);
    };

    const fila = (f: Funcion) => (
        <FilaFuncion
            key={f.id}
            f={f}
            icono={ICONO_FUNCION[f.id]}
            encendida={funciones[f.id] ?? f.porDefecto}
            ocupada={alternando === f.id}
            bloqueada={!dependenciaCumplida(f, funciones)}
            padre={f.requiere ? FUNCIONES.find((x) => x.id === f.requiere)?.nombre : undefined}
            onToggle={() => pedir(f)}
        />
    );

    return (
        <div className="space-y-8">
            <section className="space-y-2.5">
                <h3 className="text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-muted-foreground">De la instalación</h3>
                <p className="max-w-2xl text-[11px] leading-[1.45] text-muted-foreground">
                    Valen igual con cualquier modo puesto: cambiar de modo no las toca. Se prenden y se apagan
                    sin recargar — el menú, las alertas y las vistas de pared obedecen enseguida.
                </p>
                <div className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
                    {FUNCIONES_INSTALACION().map(fila)}
                </div>
            </section>

            {MODULE_DEFINITIONS.map((mod) => {
                const delModulo = FUNCIONES.filter((f) => f.alcance === "modulo" && f.modulo === mod.id);
                if (!delModulo.length || !prendido(mod.id)) return null;
                return (
                    <section key={`fn-${mod.id}`} className="space-y-2.5">
                        <h3 className="text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-muted-foreground">De {mod.name}</h3>
                        <p className="max-w-2xl text-[11px] leading-[1.45] text-muted-foreground">
                            Cuelgan del modo que está puesto: sin él no existen. No cambian qué pantallas se ven;
                            cambian cuánto trabajo hace el servidor y qué se registra.
                        </p>
                        <div className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
                            {delModulo.map(fila)}
                        </div>
                    </section>
                );
            })}

            {extra}

            <Cajon open={!!confirmar} onOpenChange={(o) => { if (!o) setConfirmar(null); }}>
                <CajonContenido ancho="angosto" titulo={confirmar ? `Apagar ${confirmar.nombre}` : ""}
                    descripcion="Vale para toda la instalación, en cualquier modo. Queda registrado con tu nombre."
                    pie={<>
                        <Button variant="outline" onClick={() => setConfirmar(null)}>Cancelar</Button>
                        <Button variant="destructive" disabled={alternando === confirmar?.id}
                            onClick={async () => { const f = confirmar; if (!f) return; await alternarFuncion(f); setConfirmar(null); }}>Apagar</Button>
                    </>}>
                    {confirmar && (
                        <CajonSeccion titulo="Qué deja de pasar">
                            <p className="text-[13px] leading-relaxed">{confirmar.siSeApaga}</p>
                            {FUNCIONES.some((x) => x.requiere === confirmar.id && (funciones[x.id] ?? x.porDefecto)) && (
                                <p className="mt-2 text-[12.5px] text-[var(--aviso-texto)]">
                                    También queda sin efecto «{FUNCIONES.filter((x) => x.requiere === confirmar.id).map((x) => x.nombre).join("», «")}», que depende de ésta. Su ajuste se conserva: vuelve a andar al prender ésta.
                                </p>
                            )}
                        </CajonSeccion>
                    )}
                </CajonContenido>
            </Cajon>
        </div>
    );
}
