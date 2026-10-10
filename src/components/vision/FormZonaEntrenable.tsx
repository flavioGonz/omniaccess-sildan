"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { DeleteButton } from "@/components/ui/delete-button";
import { EditorGeometria } from "@/components/vision/EditorGeometria";
import { CADA_SEG, SOSTENER_SEG, UMBRAL, LARGO_NOMBRE, LARGO_ESTADO, type Punto, type Horario } from "@/lib/zona-entrenable";

/**
 * Crear o cambiar una analítica entrenable. Lo único que de verdad hay que pensar es qué dos
 * estados se distinguen y cómo se ven con palabras (las frases son el arranque sin ejemplos);
 * lo demás tiene valores por defecto razonables para un contenedor de basura.
 */
export type FormZona = {
    nombre: string; deviceId: string; zona: Punto[];
    positivo: string; negativo: string; frasesPositivo: string; frasesNegativo: string;
    cadaMin: number; sostenerMin: number; umbral: number; horario: Horario; avisar: boolean; activa: boolean;
};

export const FORM_VACIO: FormZona = {
    nombre: "", deviceId: "", zona: [],
    positivo: "", negativo: "", frasesPositivo: "", frasesNegativo: "",
    cadaMin: CADA_SEG.defecto / 60, sostenerMin: SOSTENER_SEG.defecto / 60, umbral: UMBRAL.defecto,
    horario: null, avisar: false, activa: true,
};

/** El ejemplo con el que se explica todo: es el caso que la pidió. */
const EJEMPLO = {
    nombre: "Contenedor de la entrada", positivo: "Desbordado", negativo: "Normal",
    frasesPositivo: "un contenedor de basura desbordado\nbolsas de basura tiradas en el piso alrededor de un contenedor",
    frasesNegativo: "un contenedor de basura cerrado y ordenado\nun contenedor de basura sin bolsas alrededor",
};
const HORARIO_DIA = { desde: "07:00", hasta: "20:00" };

export function aFormulario(z: any): FormZona {
    return {
        nombre: z.nombre, deviceId: z.deviceId, zona: z.zona || [],
        positivo: z.positivo, negativo: z.negativo, frasesPositivo: (z.frasesPositivo || []).join("\n"), frasesNegativo: (z.frasesNegativo || []).join("\n"),
        cadaMin: Math.round(z.cadaSeg / 60), sostenerMin: Math.round(z.sostenerSeg / 60), umbral: z.umbral, horario: z.horario || null, avisar: z.avisar, activa: z.activa,
    };
}
export function aCuerpo(f: FormZona) {
    return {
        nombre: f.nombre, deviceId: f.deviceId, zona: f.zona, positivo: f.positivo, negativo: f.negativo,
        frasesPositivo: f.frasesPositivo.split("\n"), frasesNegativo: f.frasesNegativo.split("\n"),
        cadaSeg: Math.round(f.cadaMin * 60), sostenerSeg: Math.round(f.sostenerMin * 60), umbral: f.umbral, horario: f.horario, avisar: f.avisar, activa: f.activa,
    };
}

export function CajonZona({ inicial, nueva, camaras, guardando, alCerrar, alGuardar, alBorrar }: {
    inicial: FormZona; nueva: boolean; camaras: { id: string; name: string }[]; guardando: boolean;
    alCerrar: () => void; alGuardar: (f: FormZona) => void; alBorrar?: () => void;
}) {
    const [f, setF] = useState<FormZona>(inicial);
    const cambiar = (p: Partial<FormZona>) => setF((x) => ({ ...x, ...p }));
    const listo = f.nombre.trim() && f.deviceId && f.zona.length >= 3 && f.positivo.trim() && f.negativo.trim() && f.frasesPositivo.trim() && f.frasesNegativo.trim();
    const zonaCambio = !nueva && (f.deviceId !== inicial.deviceId || JSON.stringify(f.zona) !== JSON.stringify(inicial.zona));

    return (
        <Cajon open onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={nueva ? "Nueva analítica entrenable" : f.nombre || "Analítica"}
                descripcion="Una zona fija de una cámara y dos estados. Arranca con las frases; con ejemplos etiquetados aprende esa zona en particular."
                pie={
                    <>
                        {!nueva && alBorrar && <div className="mr-auto"><DeleteButton onConfirm={alBorrar} /></div>}
                        <Button variant="ghost" onClick={alCerrar}>Cancelar</Button>
                        <Button onClick={() => alGuardar(f)} disabled={!listo || guardando}>{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {nueva ? "Crear" : "Guardar"}</Button>
                    </>
                }>
                <CajonSeccion titulo="Qué distingue">
                    {nueva && !f.positivo && (
                        <button type="button" onClick={() => cambiar(EJEMPLO)} className="text-left text-[12.5px] text-[var(--accion)] font-semibold hover:underline">
                            Usar el ejemplo: contenedor desbordado / normal
                        </button>
                    )}
                    <CajonCampo etiqueta="Nombre">
                        <Input value={f.nombre} maxLength={LARGO_NOMBRE} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder="Contenedor de la entrada" />
                    </CajonCampo>
                    <div className="grid grid-cols-2 gap-3">
                        <CajonCampo etiqueta="El estado que avisa" ayuda={`Así se llama en el aviso. Corto: «Falta el cono», «Desbordado» (hasta ${LARGO_ESTADO} letras).`}>
                            <Input value={f.positivo} maxLength={LARGO_ESTADO} onChange={(e) => cambiar({ positivo: e.target.value })} placeholder="Desbordado" />
                        </CajonCampo>
                        <CajonCampo etiqueta="El normal">
                            <Input value={f.negativo} maxLength={LARGO_ESTADO} onChange={(e) => cambiar({ negativo: e.target.value })} placeholder="Normal" />
                        </CajonCampo>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <CajonCampo etiqueta={`Cómo se ve «${f.positivo || "el que avisa"}»`} ayuda="Una frase por renglón, como se lo contarías a alguien. Es lo que usa mientras no haya ejemplos.">
                            <textarea value={f.frasesPositivo} onChange={(e) => cambiar({ frasesPositivo: e.target.value })} rows={4}
                                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--accion)]" />
                        </CajonCampo>
                        <CajonCampo etiqueta={`Cómo se ve «${f.negativo || "el normal"}»`}>
                            <textarea value={f.frasesNegativo} onChange={(e) => cambiar({ frasesNegativo: e.target.value })} rows={4}
                                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--accion)]" />
                        </CajonCampo>
                    </div>
                </CajonSeccion>

                <CajonSeccion titulo="Dónde mira" ayuda="Dibujá la zona ajustada a lo que hay que mirar: se recorta su rectángulo. Si después se cambia la cámara o la zona, lo entrenado se descarta (aprendió a mirar otro recorte).">
                    <CajonCampo etiqueta="Cámara">
                        <Select value={f.deviceId} onValueChange={(v) => cambiar({ deviceId: v, zona: [] })}>
                            <SelectTrigger><SelectValue placeholder="Elegí la cámara" /></SelectTrigger>
                            <SelectContent>{camaras.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                        </Select>
                    </CajonCampo>
                    {f.deviceId ? (
                        <EditorGeometria deviceId={f.deviceId} modo="zona" linea={null} zona={f.zona} alCambiarLinea={() => { }} alCambiarZona={(z: Punto[]) => cambiar({ zona: z })} />
                    ) : <p className="text-[12px] text-muted-foreground">Elegí la cámara primero.</p>}
                    {zonaCambio && <p className="text-[12px] tono-aviso">Cambió la cámara o la zona: al guardar se descarta lo entrenado.</p>}
                </CajonSeccion>

                <CajonSeccion titulo="Cuándo avisa">
                    <div className="grid grid-cols-3 gap-3">
                        <CajonCampo etiqueta="Mirar cada" ayuda="minutos">
                            <Input type="number" min={CADA_SEG.min / 60} max={CADA_SEG.max / 60} value={f.cadaMin} onChange={(e) => cambiar({ cadaMin: Number(e.target.value) })} className="tabular-nums" />
                        </CajonCampo>
                        <CajonCampo etiqueta="Sostenido" ayuda="minutos antes de avisar">
                            <Input type="number" min={0} max={SOSTENER_SEG.max / 60} value={f.sostenerMin} onChange={(e) => cambiar({ sostenerMin: Number(e.target.value) })} className="tabular-nums" />
                        </CajonCampo>
                        <CajonCampo etiqueta="Desde" ayuda="% de probabilidad">
                            <Input type="number" min={UMBRAL.min * 100} max={UMBRAL.max * 100} value={Math.round(f.umbral * 100)} onChange={(e) => cambiar({ umbral: Number(e.target.value) / 100 })} className="tabular-nums" />
                        </CajonCampo>
                    </div>
                    <CajonCampo etiqueta="Horario" ayuda="De noche la cámara pasa a infrarrojo y se ve distinto: sin ejemplos de noche, conviene mirar sólo de día. Hora del barrio.">
                        <div className="inline-flex rounded-md bg-muted p-0.5 w-fit">
                            {([["siempre", "Siempre"], ["horario", "En un horario"]] as const).map(([v, r]) => (
                                <button key={v} type="button" onClick={() => cambiar({ horario: v === "siempre" ? null : f.horario || HORARIO_DIA })}
                                    className={cn("h-8 px-3 rounded-md text-[12.5px] font-semibold", (f.horario ? "horario" : "siempre") === v ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>{r}</button>
                            ))}
                        </div>
                    </CajonCampo>
                    {f.horario && (
                        <div className="flex items-end gap-3">
                            <CajonCampo etiqueta="Desde"><Input type="time" value={f.horario.desde} onChange={(e) => cambiar({ horario: { ...f.horario!, desde: e.target.value } })} className="w-32 tabular-nums" /></CajonCampo>
                            <CajonCampo etiqueta="Hasta"><Input type="time" value={f.horario.hasta} onChange={(e) => cambiar({ horario: { ...f.horario!, hasta: e.target.value } })} className="w-32 tabular-nums" /></CajonCampo>
                        </div>
                    )}
                    <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
                        <span><span className="block text-[13px] font-semibold">Avisar a la guardia</span><span className="block text-[11.5px] text-muted-foreground">Apagado, registra el evento pero no avisa: para probarla unos días antes de confiar en ella.</span></span>
                        <Switch checked={f.avisar} onCheckedChange={(v) => cambiar({ avisar: v })} />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
                        <span><span className="block text-[13px] font-semibold">Activa</span><span className="block text-[11.5px] text-muted-foreground">Pausada no toma muestras ni avisa; lo entrenado queda.</span></span>
                        <Switch checked={f.activa} onCheckedChange={(v) => cambiar({ activa: v })} />
                    </label>
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}
