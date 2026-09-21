"use client";

import { useEffect, useState } from "react";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pista } from "@/components/ui/pista";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CreditCard, User as UserIcon, RadioTower, Loader2, RefreshCw } from "lucide-react";
import { TarjetaAnimada } from "./TarjetaAnimada";
import {
    createTag, updateTag, unassignTag, reenviarTag, destinosDeTag,
} from "@/app/actions/tags";
import type { Destino } from "@/lib/tags";

/**
 * El cajón de una tarjeta.
 *
 * ## Por qué el dueño va primero
 *
 * Porque una tarjeta **es una propiedad de la persona**, no un objeto suelto con un dueño
 * opcional. El modelo ya lo dice —`Credential` cuelga de `User`— y la pantalla anterior lo
 * contaba al revés: una lista de números donde el nombre era una columna más. La pregunta
 * del guardia nunca es "qué número tiene esa tarjeta" sino "de quién es".
 *
 * ## La sección que faltaba entera
 *
 * **En qué lectores está.** Hasta ahora dar de alta un tag escribía una fila en la base y
 * nada más: el `AkuvoxDriver` tiene `syncRfKey` desde siempre y nadie lo llamaba. La
 * pantalla era una lista de tarjetas que no abrían ninguna puerta, y no había manera de
 * notarlo mirándola.
 *
 * Ahora cada lector dice en qué estado está esa tarjeta, incluidos los que **no la pueden
 * recibir**. Esconder esos equipos dejaría la pantalla llena de tarjetas "cargadas" y una
 * puerta que no abre, sin pista de por qué. Aparecer diciendo "esta marca no sabe recibir
 * tarjetas" es información accionable: quien instala sabe que tiene que abrir la otra app.
 */

type Fila = {
    id: string; value: string; notes: string | null; userId: string | null;
    user?: { id: string; name: string } | null;
};

type Persona = { id: string; name: string };

/** Sin dueño. Un `<Select>` no admite valor vacío, así que hace falta un centinela con nombre. */
const NADIE = "__sin_dueno__";

const TONO: Record<Destino["estado"], string> = {
    "cargado": "chip-bien",
    "error": "chip-mal",
    "no soporta": "chip-quieto",
    "sin intentar": "chip-aviso",
};

export function CajonTag({
    tag, personas, abierto, alCerrar, alGuardar,
}: {
    /** `null` = alta. */
    tag: Fila | null;
    personas: Persona[];
    abierto: boolean;
    alCerrar: () => void;
    alGuardar: () => void;
}) {
    const esAlta = !tag;
    const [valor, setValor] = useState("");
    const [notas, setNotas] = useState("");
    const [duenio, setDuenio] = useState(NADIE);
    const [destinos, setDestinos] = useState<Destino[] | null>(null);
    const [ocupado, setOcupado] = useState<"" | "guardando" | "mandando">("");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!abierto) return;
        setValor(tag?.value ?? "");
        setNotas(tag?.notes ?? "");
        setDuenio(tag?.userId ?? NADIE);
        setError(null);
        setDestinos(null);
        if (tag) destinosDeTag(tag.id).then(setDestinos).catch(() => setDestinos([]));
    }, [abierto, tag]);

    const cargada = (destinos || []).some((d) => d.estado === "cargado");

    const guardar = async () => {
        setOcupado("guardando"); setError(null);
        try {
            const userId = duenio === NADIE ? null : duenio;
            const r = esAlta
                ? await createTag({ value: valor, userId, notes: notas })
                : await updateTag(tag!.id, { value: valor, userId, notes: notas });
            if (!r.ok) { setError(r.error); return; }
            /* Se muestran los destinos ANTES de cerrar: guardar y mandar a los lectores son
               dos cosas, y la segunda puede fallar sola. Cerrar de una haría que un fallo
               de carga se viera como un alta exitosa. */
            setDestinos((r.dato as any)?.destinos ?? null);
            alGuardar();
            if (esAlta) alCerrar();
        } finally { setOcupado(""); }
    };

    const reenviar = async () => {
        if (!tag) return;
        setOcupado("mandando"); setError(null);
        try {
            const r = await reenviarTag(tag.id);
            if (!r.ok) setError(r.error);
            else setDestinos(r.dato?.destinos ?? []);
        } finally { setOcupado(""); }
    };

    const soltar = async () => {
        if (!tag) return;
        setOcupado("guardando"); setError(null);
        try {
            const r = await unassignTag(tag.id);
            if (!r.ok) { setError(r.error); return; }
            setDuenio(NADIE);
            setDestinos(await destinosDeTag(tag.id));
            alGuardar();
        } finally { setOcupado(""); }
    };

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido
                titulo={esAlta ? "Nueva tarjeta" : `Tarjeta ${tag?.value}`}
                descripcion={esAlta
                    ? "Cargá el número que trae la tarjeta y de quién va a ser."
                    : "De quién es, qué número tiene y en qué lectores está cargada."}
                pie={
                    <div className="flex items-center gap-2 w-full">
                        {error && <span className="text-[12px] tono-mal flex-1">{error}</span>}
                        <div className="ml-auto flex gap-2">
                            <Button variant="ghost" onClick={alCerrar} disabled={!!ocupado}>Cerrar</Button>
                            <Button onClick={guardar} disabled={!!ocupado} className="accion">
                                {ocupado === "guardando" ? <Loader2 size={15} className="animate-spin" /> : null}
                                {esAlta ? "Crear y cargar" : "Guardar"}
                            </Button>
                        </div>
                    </div>
                }
            >
                <div className="flex justify-center py-1">
                    <TarjetaAnimada viva={cargada} className="w-[220px] h-[132px]" />
                </div>

                <CajonSeccion titulo="De quién es" icono={UserIcon}
                    ayuda="La tarjeta es una propiedad de la persona: de acá sale quién pasó cuando el lector la lee. Sin dueño se guarda igual, pero no se manda a ningún lector — cargarla abriría la puerta a quien la tenga en la mano.">
                    <CajonCampo etiqueta="Residente"
                        pistaTitulo="Por qué importa"
                        pista="El historial de accesos muestra el nombre, no el número. Una tarjeta sin dueño entra al registro como un código suelto y después nadie sabe quién pasó.">
                        <Select value={duenio} onValueChange={setDuenio}>
                            <SelectTrigger><SelectValue placeholder="Elegí a quién" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NADIE}>Sin asignar — queda en el cajón</SelectItem>
                                {personas.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </CajonCampo>

                    {!esAlta && tag?.userId && (
                        <Button variant="outline" size="sm" onClick={soltar} disabled={!!ocupado}>
                            Sacarle la tarjeta y dejarla en el cajón
                        </Button>
                    )}
                </CajonSeccion>

                <CajonSeccion titulo="La tarjeta" icono={CreditCard}>
                    <CajonCampo etiqueta="Número / UID"
                        pistaTitulo="Tiene que ser exacto"
                        pista="Es el código que lee el equipo, no el que está impreso arriba — en muchas tarjetas no coinciden. Un dígito de diferencia y la tarjeta no abre, sin ningún aviso.">
                        <Input value={valor} autoComplete="off"
                            onChange={(e) => { setValor(e.target.value); setError(null); }}
                            placeholder="El número que lee el equipo" />
                    </CajonCampo>

                    <CajonCampo etiqueta="Nota"
                        pistaTitulo="Para qué sirve"
                        pista="Dónde está físicamente la tarjeta, o por qué se dio de alta. Lo que va a querer saber quien mire esto dentro de seis meses.">
                        <Input value={notas} onChange={(e) => setNotas(e.target.value)}
                            placeholder="Llavero azul · entregada en portería" />
                    </CajonCampo>
                </CajonSeccion>

                {!esAlta && (
                    <CajonSeccion titulo="En qué lectores está" icono={RadioTower}
                        ayuda="Guardar la tarjeta y cargarla en los equipos son dos cosas distintas, y la segunda puede fallar sola. Acá se ve dónde llegó de verdad.">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[12px] text-muted-foreground">
                                {destinos === null ? "Preguntando…"
                                    : destinos.length === 0 ? "No hay lectores cargados en el sistema."
                                        : `${destinos.filter((d) => d.estado === "cargado").length} de ${destinos.length} la tienen`}
                            </span>
                            <Button variant="outline" size="sm" onClick={reenviar} disabled={!!ocupado || !tag?.userId}>
                                {ocupado === "mandando"
                                    ? <Loader2 size={15} className="animate-spin" />
                                    : <RefreshCw size={15} />}
                                Volver a mandarla
                            </Button>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            {(destinos || []).map((d) => (
                                <div key={d.deviceId} className="flex items-center gap-2 text-[12px]">
                                    <Pista titulo={d.nombre} texto={d.detalle}>
                                        <span className={TONO[d.estado]}>{d.estado}</span>
                                    </Pista>
                                    <span className="font-medium">{d.nombre}</span>
                                    <span className="text-muted-foreground">{d.marca}</span>
                                </div>
                            ))}
                        </div>

                        {/* Se dice, en vez de dejar que alguien lo descubra el lunes. */}
                        <p className="text-[11px] text-muted-foreground">
                            Sacar una tarjeta de un equipo todavía hay que hacerlo desde la app del
                            fabricante: ningún driver sabe borrarla. Acá se olvida la anotación, pero
                            la tarjeta sigue abriendo hasta que se la quite a mano.
                        </p>
                    </CajonSeccion>
                )}
            </CajonContenido>
        </Cajon>
    );
}
