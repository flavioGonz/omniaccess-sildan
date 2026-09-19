"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Building2, Home, Loader2, MapPin, Phone, Save, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Chip } from "@/components/ui/estados";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { createUnit, updateUnit, deleteUnit } from "@/app/actions/units";
import { asignarLoteAUnidad } from "@/app/actions/barriomap";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/* El mapa arrastra Leaflet, que toca `window` al cargarse. Entra sólo en el navegador y
   sólo cuando el cajón se abre: no tiene sentido cargarlo para ver una lista. */
const MapaLotes = dynamic(() => import("./MapaLotes").then((m) => m.MapaLotes), {
    ssr: false,
    loading: () => (
        <div className="h-[300px] rounded-lg border border-border bg-muted/40 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </div>
    ),
});

/**
 * Alta y edición de una propiedad, en un cajón.
 *
 * Reemplaza un diálogo centrado de 6xl con pestañas adentro. Ese diálogo era tan grande que
 * tapaba la lista, pero sin llegar a ser una pantalla: lo peor de los dos mundos — perdía
 * el contexto como una pantalla y no daba el lugar de una.
 *
 * **Todo es una propiedad.** Antes el flujo se bifurcaba temprano: primero elegías si ibas
 * a crear un barrio, un edificio o una casa, y cada camino te llevaba a un formulario
 * distinto. Eso obliga a decidir la taxonomía antes de tener los datos, y a que quien carga
 * un lote suelto tenga que averiguar en qué casillero entra. Acá la clase es **un campo
 * más**, en el medio del formulario, con un valor por defecto sensato: se carga la
 * propiedad y después se dice qué es. Las que dependen de otra se atan con «pertenece a», y
 * eso es toda la jerarquía que hace falta.
 *
 * **Y se elige su lote en el plano.** Hasta acá había dos mundos sin tocarse: el mapa
 * dibujaba contornos y el padrón listaba unidades, y nadie decía cuál era cuál. La atadura
 * ya existía en el dato (`lote.unitId`) pero sólo se podía hacer desde el mapa — o sea,
 * desde el lado que NO tiene el padrón a mano. Ahora se hace desde donde se conoce la
 * unidad, que es acá.
 */

const CLASES = [
    { valor: "BARRIO", rotulo: "Barrio", icono: MapPin, ayuda: "Un conjunto que contiene a otras propiedades." },
    { valor: "EDIFICIO", rotulo: "Edificio", icono: Building2, ayuda: "Una torre con unidades adentro." },
    { valor: "CASA", rotulo: "Casa o lote", icono: Home, ayuda: "Una vivienda. Es lo que se marca en el plano." },
] as const;

export type UnidadDelCajon = {
    id?: string;
    name?: string | null;
    type?: string | null;
    lot?: string | null;
    houseNumber?: string | null;
    address?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    adminPhone?: string | null;
    parentId?: string | null;
    description?: string | null;
    users?: any[];
    [k: string]: any;
};

export function CajonUnidad({ abierto, alCerrar, unidad, unidades, lotes, alGuardar }: {
    abierto: boolean;
    alCerrar: () => void;
    /** La unidad a editar. Sin `id` es un alta. */
    unidad: UnidadDelCajon | null;
    /** El padrón, para elegir de qué depende y para nombrar lotes ya tomados. */
    unidades: UnidadDelCajon[];
    /** Los lotes dibujados en el mapa. */
    lotes: { id: string; label: string; unitId?: string | null }[];
    alGuardar: () => void;
}) {
    const esAlta = !unidad?.id;

    const [nombre, setNombre] = useState("");
    const [clase, setClase] = useState<string>("CASA");
    const [lote, setLote] = useState("");
    const [numero, setNumero] = useState("");
    const [direccion, setDireccion] = useState("");
    const [contacto, setContacto] = useState("");
    const [correo, setCorreo] = useState("");
    const [telefono, setTelefono] = useState("");
    const [padre, setPadre] = useState("");
    const [notas, setNotas] = useState("");
    const [loteMapa, setLoteMapa] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    /** Cada vez que se abre con otra unidad, el formulario arranca en esa. */
    useEffect(() => {
        if (!abierto) return;
        setNombre(unidad?.name || "");
        setClase(unidad?.type || "CASA");
        setLote(unidad?.lot || "");
        setNumero(unidad?.houseNumber || "");
        setDireccion(unidad?.address || "");
        setContacto(unidad?.contactName || "");
        setCorreo(unidad?.contactEmail || "");
        setTelefono(unidad?.adminPhone || "");
        setPadre(unidad?.parentId || "");
        setNotas(unidad?.description || "");
        setLoteMapa(unidad?.id ? (lotes.find((l) => l.unitId === unidad.id)?.id || null) : null);
        setGuardando(false);
    }, [abierto, unidad, lotes]);

    const nombreDeUnidad = useCallback(
        (id: string) => unidades.find((u) => u.id === id)?.name || undefined, [unidades]);

    /* De qué puede depender: cualquier otra propiedad menos ella misma. Dejar que una
       unidad sea su propia madre crea un ciclo que después rompe el árbol al dibujarlo. */
    const posiblesPadres = useMemo(
        () => unidades.filter((u) => u.id && u.id !== unidad?.id),
        [unidades, unidad?.id]);

    const guardar = async () => {
        if (!nombre.trim()) {
            toast.error({ title: "Falta el nombre", description: "Es lo único que no se puede deducir después." });
            return;
        }
        setGuardando(true);
        try {
            const fd = new FormData();
            fd.set("name", nombre.trim());
            fd.set("type", clase);
            fd.set("lot", lote.trim());
            fd.set("houseNumber", numero.trim());
            fd.set("address", direccion.trim());
            fd.set("contactName", contacto.trim());
            fd.set("contactEmail", correo.trim());
            fd.set("adminPhone", telefono.trim());
            fd.set("parentId", padre);

            const guardada = unidad?.id
                ? await updateUnit(unidad.id, fd)
                : await createUnit(fd);

            /* La atadura con el plano va después y por separado: el lote vive en el mapa,
               no en la fila de la unidad. Si falla, la unidad igual quedó guardada — y se
               dice, en vez de hacer pasar el todo por nada. */
            const id = (guardada as any)?.id || unidad?.id;
            if (id) {
                const antes = lotes.find((l) => l.unitId === id)?.id || null;
                if (loteMapa !== antes) {
                    const r = await asignarLoteAUnidad(loteMapa, id);
                    if (!r.ok) {
                        toast.warning({
                            title: "Se guardó la propiedad, pero no su lote",
                            description: r.error || "No se pudo escribir el mapa.",
                        });
                        alGuardar(); alCerrar(); return;
                    }
                }
            }

            toast.success({
                title: esAlta ? "Propiedad creada" : "Propiedad guardada",
                description: loteMapa ? "Queda marcada en el plano del barrio." : undefined,
            });
            alGuardar();
            alCerrar();
        } catch (e: any) {
            toast.error({ title: "No se pudo guardar", description: e?.message });
        } finally {
            setGuardando(false);
        }
    };

    const gente = unidad?.users || [];

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido
                ancho="medio"
                titulo={esAlta ? "Nueva propiedad" : (unidad?.name || "Propiedad")}
                descripcion={esAlta
                    ? "Una casa, un lote, un edificio o un barrio. Se define qué es más abajo."
                    : "Cambiar sus datos, de qué depende y qué contorno le corresponde en el plano."}
                pie={
                    <>
                        {!esAlta && unidad?.id && (
                            <span className="mr-auto">
                                <DeleteConfirmDialog
                                    id={unidad.id}
                                    title={unidad.name || "Propiedad"}
                                    description={gente.length
                                        ? `Hay ${gente.length} residente${gente.length === 1 ? "" : "s"} en esta propiedad. No se borran: quedan sin unidad asignada.`
                                        : "Se elimina del padrón. Si tenía un contorno en el plano, queda libre para otra."}
                                    onDelete={deleteUnit}
                                    onSuccess={() => { alGuardar(); alCerrar(); }}>
                                    <Button variant="ghost" size="sm"
                                        className="text-[var(--mal-texto)] hover:bg-[var(--mal-suave)] gap-1.5">
                                        <Trash2 size={14} /> Eliminar
                                    </Button>
                                </DeleteConfirmDialog>
                            </span>
                        )}
                        <Button variant="ghost" onClick={alCerrar}>Cancelar</Button>
                        <Button onClick={guardar} disabled={guardando} className="accion gap-1.5">
                            {guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            {esAlta ? "Crear" : "Guardar"}
                        </Button>
                    </>
                }>

                <CajonSeccion titulo="Cómo se la conoce">
                    <CajonCampo etiqueta="Nombre"
                        ayuda="El que usan en el barrio. Es lo primero que se busca y lo único que no se puede deducir después.">
                        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus
                            placeholder="Casa 14, Torre Norte, Lote 3…" className="h-10" />
                    </CajonCampo>

                    <div className="grid grid-cols-2 gap-3">
                        <CajonCampo etiqueta="Lote">
                            <Input value={lote} onChange={(e) => setLote(e.target.value)} className="h-10" placeholder="—" />
                        </CajonCampo>
                        <CajonCampo etiqueta="Número">
                            <Input value={numero} onChange={(e) => setNumero(e.target.value)} className="h-10" placeholder="—" />
                        </CajonCampo>
                    </div>

                    <CajonCampo etiqueta="Dirección">
                        <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} className="h-10"
                            placeholder="Calle y número, si tiene" />
                    </CajonCampo>
                </CajonSeccion>

                <CajonSeccion titulo="Qué es"
                    ayuda="Va acá, en el medio, y no al principio: antes había que elegir la clase para poder empezar, y eso obliga a decidir la taxonomía antes de tener los datos.">
                    <div className="grid grid-cols-3 gap-2">
                        {CLASES.map((c) => {
                            const Ico = c.icono;
                            const activa = clase === c.valor;
                            return (
                                <button key={c.valor} type="button" onClick={() => setClase(c.valor)}
                                    title={c.ayuda}
                                    className={cn(
                                        "flex flex-col items-start gap-1.5 p-3 rounded-lg border text-left transition-colors",
                                        activa
                                            ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]"
                                            : "border-border hover:bg-accent",
                                    )}>
                                    <Ico size={16} className={activa ? "tono-accion" : "text-muted-foreground"} />
                                    <span className="text-[12.5px] font-semibold">{c.rotulo}</span>
                                    <span className="text-[11px] text-muted-foreground leading-snug">{c.ayuda}</span>
                                </button>
                            );
                        })}
                    </div>

                    <CajonCampo etiqueta="Pertenece a"
                        ayuda="Sólo si vive adentro de otra: un piso dentro de un edificio, una casa dentro de un barrio.">
                        <select value={padre} onChange={(e) => setPadre(e.target.value)}
                            className="h-10 w-full rounded-md border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring">
                            <option value="">No depende de ninguna — es principal</option>
                            {posiblesPadres.map((u) => (
                                <option key={u.id} value={u.id!}>{u.name}</option>
                            ))}
                        </select>
                    </CajonCampo>
                </CajonSeccion>

                <CajonSeccion titulo="Cuál es en el plano"
                    ayuda="El contorno que le corresponde en el mapa del barrio. Hasta ahora el plano y el padrón eran dos mundos sin tocarse: el mapa dibujaba casas y el padrón listaba unidades, y nadie decía cuál era cuál.">
                    {abierto && (
                        <MapaLotes
                            unidadId={unidad?.id || null}
                            loteElegido={loteMapa}
                            alElegir={(l) => setLoteMapa(l?.id || null)}
                            nombreDeUnidad={nombreDeUnidad}
                            alto={320}
                        />
                    )}
                </CajonSeccion>

                <CajonSeccion titulo="A quién llamar"
                    ayuda="El responsable de la propiedad. No es lo mismo que sus residentes: puede ser el administrador del edificio o el dueño que la alquila.">
                    <CajonCampo etiqueta="Nombre del contacto">
                        <Input value={contacto} onChange={(e) => setContacto(e.target.value)} className="h-10" placeholder="—" />
                    </CajonCampo>
                    <div className="grid grid-cols-2 gap-3">
                        <CajonCampo etiqueta="Teléfono">
                            <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} className="h-10" placeholder="—" />
                        </CajonCampo>
                        <CajonCampo etiqueta="Correo">
                            <Input value={correo} onChange={(e) => setCorreo(e.target.value)} className="h-10" placeholder="—" />
                        </CajonCampo>
                    </div>
                </CajonSeccion>

                {!esAlta && (
                    <CajonSeccion titulo="Quiénes viven acá">
                        {gente.length ? (
                            <ul className="divide-y divide-border -mt-1">
                                {gente.map((r: any) => (
                                    <li key={r.id} className="flex items-center gap-2.5 py-2">
                                        <span className="w-7 h-7 rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground">
                                            <User size={13} />
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-[13px] font-medium truncate">{r.name}</span>
                                            {(r.phone || r.email) && (
                                                <span className="block text-[11.5px] text-muted-foreground truncate">
                                                    {r.phone || r.email}
                                                </span>
                                            )}
                                        </span>
                                        {!!(r.vehicles || []).length && (
                                            <Chip tono="neutro">{r.vehicles.length} veh.</Chip>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-[12.5px] text-muted-foreground">
                                Todavía no hay nadie asignado. Los residentes se cargan desde
                                {" "}<a href="/admin/users" className="tono-accion font-semibold hover:underline">Usuarios</a>,
                                {" "}eligiendo esta propiedad.
                            </p>
                        )}
                    </CajonSeccion>
                )}
            </CajonContenido>
        </Cajon>
    );
}
