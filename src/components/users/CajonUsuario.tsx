"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { User, Unit, AccessGroup, Credential } from "@prisma/client";
import {
    AlertCircle, Camera, Car, Check, CheckCircle2, CreditCard, DoorOpen,
    KeyRound, Loader2, MapPin, ParkingSquare, Phone, Save, ScanFace, Server,
    Shield, Upload, User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { createUser, updateUser } from "@/app/actions/users";
import { addDevicePlate } from "@/app/actions/devices";
import { syncUserToDevice } from "@/app/actions/deviceMemory";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/**
 * La ficha de una persona, en un cajón.
 *
 * Reemplaza un diálogo de 4xl partido en dos mitades: a la izquierda tres pestañas
 * —general, credenciales, sincronización— y a la derecha la foto ocupando media ventana.
 *
 * Las pestañas eran el problema. Cargar a alguien es UNA tarea, no tres, y partirla obliga
 * a ir y volver para contestar preguntas que dependen entre sí: los equipos a los que se
 * manda la matrícula estaban en la tercera pestaña, y la matrícula en la segunda. Peor: al
 * validar, el formulario tenía que SALTAR de pestaña para mostrar el error, porque el
 * campo vacío estaba escondido detrás de otra. Un formulario que tiene que moverse solo
 * para poder señalar lo que falta está mal partido.
 *
 * Acá es una sola columna que se lee de arriba abajo en el orden en que se conoce a la
 * persona: quién es, dónde vive, con qué entra, y recién al final a qué equipos se manda
 * —que es lo último porque depende de todo lo anterior.
 *
 * Los `name=` de los campos son los mismos de antes a propósito: el `FormData` que arma el
 * submit y las acciones del servidor no cambiaron. Esto es la carcasa, no la lógica.
 */

const CLASES_VEHICULO = [
    { valor: "SEDAN", rotulo: "Particular / Sedán" },
    { valor: "SUV", rotulo: "SUV / Camioneta" },
    { valor: "PICKUP", rotulo: "Pick-up" },
    { valor: "VAN", rotulo: "Furgón / Van" },
    { valor: "TRUCK", rotulo: "Camión" },
    { valor: "MOTORCYCLE", rotulo: "Motocicleta" },
];

const ROLES = [
    { valor: "RESIDENT", rotulo: "Residente" },
    { valor: "VISITOR", rotulo: "Visita" },
    { valor: "TEMPORARY_VISITOR", rotulo: "Visita temporal" },
    { valor: "PROVIDER", rotulo: "Proveedor" },
    { valor: "STAFF", rotulo: "Personal" },
    { valor: "WHITELISTED", rotulo: "Lista blanca" },
    { valor: "ADMIN", rotulo: "Administrador" },
];

type UsuarioConRelaciones = User & {
    unit: Unit | null;
    credentials: Credential[];
    accessGroups: AccessGroup[];
    vehicles: any[];
    accessTags?: string[];
    apartment?: string | null;
    parkingSlotId?: string | null;
};

type Estado = "pendiente" | "enviando" | "listo" | "falló";

export interface CajonUsuarioProps {
    user?: UsuarioConRelaciones;
    initialData?: { name?: string; dni?: string; plate?: string; cara?: string };
    units: Unit[];
    groups: AccessGroup[];
    devices: any[];
    parkingSlots?: any[];
    onSuccess: () => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Una tarjeta de equipo que se prende y se apaga, con el resultado de su envío. */
function Equipo({ equipo, elegido, estado, alTocar, icono: Icono }: {
    equipo: any; elegido: boolean; estado?: Estado; alTocar: () => void; icono: any;
}) {
    return (
        <button
            type="button"
            onClick={alTocar}
            className={cn(
                "w-full text-left p-2.5 rounded-[10px] border flex items-center justify-between gap-3 transition-colors",
                elegido ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]"
                    : "border-border bg-card/40 hover:bg-accent",
            )}>
            <span className="flex items-center gap-2.5 min-w-0">
                <span className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                    elegido ? "text-[var(--accion)]" : "text-muted-foreground bg-muted")}>
                    {estado === "enviando" ? <Loader2 size={14} className="animate-spin" />
                        : estado === "falló" ? <AlertCircle size={14} className="text-[var(--mal)]" />
                            : estado === "listo" ? <CheckCircle2 size={14} className="text-[var(--bien)]" />
                                : <Icono size={14} />}
                </span>
                <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-foreground truncate">{equipo.name}</span>
                    <span className="block text-[11.5px] text-muted-foreground tabular-nums truncate">{equipo.ip}</span>
                </span>
            </span>
            {estado === "listo" ? <span className="chip-bien text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0">Enviado</span>
                : estado === "falló" ? <span className="chip-mal text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0">Falló</span>
                    : elegido ? <Check size={15} className="text-[var(--accion)] shrink-0" /> : null}
        </button>
    );
}

export function CajonUsuario({
    user, initialData, units, groups, devices, parkingSlots = [], onSuccess, open, onOpenChange,
}: CajonUsuarioProps) {
    const esAlta = !user;

    const [guardando, setGuardando] = useState(false);
    const [foto, setFoto] = useState<string | null>(null);
    const [archivoFoto, setArchivoFoto] = useState<File | null>(null);
    const [chapa, setChapa] = useState("");
    const [pin, setPin] = useState("");
    const [gruposElegidos, setGruposElegidos] = useState<string[]>([]);
    const [lprElegidos, setLprElegidos] = useState<string[]>([]);
    const [facialesElegidos, setFacialesElegidos] = useState<string[]>([]);
    const [estados, setEstados] = useState<Record<string, Estado>>({});
    const [unidadId, setUnidadId] = useState("none");
    const [progreso, setProgreso] = useState<{ total: number; hecho: number; nombre: string } | null>(null);
    const archivoRef = useRef<HTMLInputElement>(null);

    const unidad = units.find((u) => u.id === unidadId);
    const esEdificio = unidad?.type === "EDIFICIO";
    const camarasLpr = devices.filter((d) => d.deviceType === "LPR_CAMERA");
    const terminalesFaciales = devices.filter((d) => d.deviceType === "FACE_TERMINAL");

    useEffect(() => {
        if (!open) return;
        let ruta = user?.cara || initialData?.cara || null;
        if (ruta && !ruta.startsWith("http") && !ruta.startsWith("/")) ruta = "/" + ruta;
        setFoto(ruta);
        setChapa(user?.credentials?.find((c) => c.type === "PLATE")?.value
            || user?.vehicles?.[0]?.plate || initialData?.plate || "");
        setPin(user?.credentials?.find((c) => c.type === "PIN")?.value || "");
        setArchivoFoto(null);
        setGruposElegidos(user?.accessGroups?.map((g) => g.id) || []);
        setUnidadId(user?.unitId || "none");
        /* Los equipos NO se recuerdan de la vez anterior: mandar una credencial a un equipo
           es un acto, no una propiedad de la persona. Que quedara tildado invitaba a
           reenviar sin querer con cada guardado. */
        setLprElegidos([]);
        setFacialesElegidos([]);
        setEstados({});
        setProgreso(null);
        setGuardando(false);
    }, [open, user, initialData]);

    const alternar = (lista: string[], poner: (v: string[]) => void, id: string) =>
        poner(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

    /** Manda una credencial a cada equipo, de a uno, mostrando en cuál va. */
    const enviarA = async (ids: string[], etiqueta: string, enviar: (id: string) => Promise<boolean>) => {
        setProgreso({ total: ids.length, hecho: 0, nombre: "" });
        setEstados((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, "pendiente" as Estado])) }));
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const equipo = devices.find((d) => d.id === id);
            setProgreso({ total: ids.length, hecho: i, nombre: equipo?.name || etiqueta });
            setEstados((p) => ({ ...p, [id]: "enviando" }));
            let salio = false;
            try { salio = await enviar(id); } catch { salio = false; }
            setEstados((p) => ({ ...p, [id]: salio ? "listo" : "falló" }));
            // Una pausa corta: los equipos son lentos y encimarles pedidos los tira.
            await new Promise((r) => setTimeout(r, 400));
        }
        setProgreso({ total: ids.length, hecho: ids.length, nombre: "" });
    };

    const guardar = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const datos = new FormData(e.currentTarget);

        const nombre = String(datos.get("name") || "").trim();
        if (!nombre) {
            /* Antes esto era un alert() del navegador y, peor, tenía que saltar de pestaña
               para que el campo vacío estuviera a la vista. En una sola columna el campo ya
               está donde se lo dejó. */
            toast.error({ title: "Falta el nombre", description: "Es lo único que no se puede deducir después." });
            return;
        }
        datos.set("unitId", unidadId);
        setGuardando(true);

        try {
            let id = user?.id;
            if (user) await updateUser(user.id, datos);
            else id = (await createUser(datos)).id;

            if (archivoFoto && id) {
                const img = new FormData();
                img.append("faceImage", archivoFoto);
                const r = await fetch(`/api/users/${id}/face`, { method: "POST", body: img });
                if (!r.ok) {
                    /* Que la foto no suba no invalida lo demás, pero callarlo sí: la persona
                       quedaría guardada sin rostro y nadie se enteraría hasta que un
                       terminal no la reconozca. */
                    toast.warning({ title: "Se guardó la persona, pero no la foto", description: await r.text() });
                }
            }

            const chapaLimpia = String(datos.get("plate") || "").toUpperCase().trim();
            if (chapaLimpia && lprElegidos.length) {
                await enviarA(lprElegidos, "Cámara", async (dev) =>
                    !!(await addDevicePlate(dev, chapaLimpia))?.success);
            }
            if (foto && facialesElegidos.length && id) {
                await enviarA(facialesElegidos, "Terminal", async (dev) =>
                    !!(await syncUserToDevice(dev, id!)));
            }
            if (progreso) await new Promise((r) => setTimeout(r, 700));

            toast.success({ title: esAlta ? "Persona registrada" : "Ficha guardada" });
            onOpenChange(false);
            onSuccess();
        } catch (err: any) {
            toast.error({ title: "No se pudo guardar", description: err?.message });
        } finally {
            setGuardando(false);
        }
    };

    return (
        <Cajon open={open} onOpenChange={onOpenChange}>
            <CajonContenido
                ancho="ancho"
                titulo={esAlta ? "Nueva persona" : user?.name || "Ficha de la persona"}
                descripcion="Quién es, dónde vive, con qué entra y a qué equipos se manda."
                onInteractOutside={(e) => e.preventDefault()}
                pie={
                    <>
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button type="submit" form="ficha-persona" disabled={guardando}>
                            {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                            {guardando ? "Guardando…" : esAlta ? "Registrar" : "Guardar cambios"}
                        </Button>
                    </>
                }>

                <form id="ficha-persona" onSubmit={guardar} noValidate>
                    {initialData?.cara && !archivoFoto && (
                        <input type="hidden" name="cara" value={initialData.cara} />
                    )}

                    {/* ── Quién es ── */}
                    <CajonSeccion titulo="Quién es">
                        <div className="flex flex-col sm:flex-row gap-5">
                            {/* La foto al lado de los datos y no ocupando media ventana: es UN
                                dato de la persona, del mismo rango que el teléfono. */}
                            <div className="shrink-0 w-full sm:w-[150px]">
                                <div className="relative aspect-[3/4] w-full rounded-[10px] border border-border bg-muted overflow-hidden">
                                    {foto ? (
                                        <Image src={foto} alt="" fill unoptimized className="object-cover" />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                            <Camera size={26} className="opacity-40" />
                                            <span className="text-[11px]">Sin foto</span>
                                        </div>
                                    )}
                                </div>
                                <Button type="button" variant="outline" className="w-full mt-2"
                                    onClick={() => archivoRef.current?.click()}>
                                    <Upload size={14} /> {foto ? "Cambiar" : "Subir foto"}
                                </Button>
                                {/* Antes decía "Identidad verificada" cuando lo único cierto era
                                    que había una imagen cargada. Nadie verificó nada. */}
                                <p className="text-[11.5px] text-muted-foreground mt-1.5 text-center">
                                    {foto ? "Sirve para los terminales faciales." : "Hace falta para el acceso por rostro."}
                                </p>
                                <input ref={archivoRef} type="file" accept="image/*" className="hidden"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (!f) return;
                                        setArchivoFoto(f);
                                        setFoto(URL.createObjectURL(f));
                                    }} />
                            </div>

                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                <CajonCampo etiqueta="Nombre y apellido" className="sm:col-span-2">
                                    <Input name="name" defaultValue={user?.name || initialData?.name}
                                        placeholder="Cómo figura en la lista" autoFocus />
                                </CajonCampo>
                                <CajonCampo etiqueta="Documento" ayuda="Opcional.">
                                    <Input name="dni" defaultValue={user?.dni || initialData?.dni} placeholder="Sin puntos" />
                                </CajonCampo>
                                <CajonCampo etiqueta="Teléfono">
                                    <Input name="phone" type="tel" defaultValue={user?.phone || ""} placeholder="Con código de país" />
                                </CajonCampo>
                                <CajonCampo etiqueta="Qué es para el barrio" className="sm:col-span-2">
                                    <Select name="role" defaultValue={user?.role || "RESIDENT"}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {ROLES.map((r) => <SelectItem key={r.valor} value={r.valor}>{r.rotulo}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </CajonCampo>
                            </div>
                        </div>
                    </CajonSeccion>

                    {/* ── Dónde vive ── */}
                    <CajonSeccion titulo="Dónde vive">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <CajonCampo etiqueta="Lote o unidad">
                                <Select name="unitId" value={unidadId} onValueChange={setUnidadId}>
                                    <SelectTrigger><SelectValue placeholder="Elegir…" /></SelectTrigger>
                                    <SelectContent className="max-h-[260px]">
                                        <SelectItem value="none">Sin asignar</SelectItem>
                                        {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </CajonCampo>
                            <CajonCampo etiqueta="Cochera">
                                <Select name="parkingSlotId" defaultValue={user?.parkingSlotId || "none"}>
                                    <SelectTrigger><SelectValue placeholder="Elegir…" /></SelectTrigger>
                                    <SelectContent className="max-h-[260px]">
                                        <SelectItem value="none">Sin cochera</SelectItem>
                                        {parkingSlots.map((p) => {
                                            const ocupada = p.user && p.user.id !== user?.id;
                                            return (
                                                <SelectItem key={p.id} value={p.id} disabled={ocupada}>
                                                    {p.label}{ocupada ? ` · ocupada por ${p.user.name}` : ""}
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                            </CajonCampo>
                            {(esEdificio || user?.apartment) && (
                                <CajonCampo etiqueta="Apartamento" className="sm:col-span-2"
                                    ayuda="Aparece porque la unidad elegida es un edificio.">
                                    <Input name="apartment" defaultValue={user?.apartment || ""} placeholder="4B, PB-2…" />
                                </CajonCampo>
                            )}
                        </div>
                    </CajonSeccion>

                    {/* ── Con qué entra ── */}
                    <CajonSeccion titulo="Con qué entra"
                        ayuda="Cada credencial abre por un camino distinto. Se pueden cargar todas o ninguna.">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <CajonCampo etiqueta="Matrícula" ayuda="Es lo que leen las cámaras.">
                                <Input name="plate" value={chapa} placeholder="ABC1234"
                                    onChange={(e) => setChapa(e.target.value.toUpperCase())}
                                    className="font-bold tracking-[0.12em] tabular-nums uppercase" />
                            </CajonCampo>
                            <CajonCampo etiqueta="Qué vehículo es">
                                <Select name="vehicleType" defaultValue={user?.vehicles?.[0]?.type || "SEDAN"}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {CLASES_VEHICULO.map((v) => <SelectItem key={v.valor} value={v.valor}>{v.rotulo}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </CajonCampo>
                            <CajonCampo etiqueta="Tarjetas o llaveros" ayuda="Varios, separados por coma.">
                                <Input name="accessTags"
                                    defaultValue={user?.accessTags?.join(", ")
                                        || user?.credentials?.find((c) => c.type === "TAG")?.value || ""}
                                    placeholder="E20030040506, TAG-9921" className="tabular-nums" />
                            </CajonCampo>
                            <CajonCampo etiqueta="Código PIN" ayuda="Para el teclado de la entrada.">
                                <PasswordInput name="pin" value={pin} onChange={(e) => setPin(e.target.value)}
                                    placeholder="1234" className="tabular-nums" />
                            </CajonCampo>
                        </div>

                        <div>
                            <span className="block text-[12px] font-medium text-foreground/85 mb-1.5">Grupos de acceso</span>
                            <div className="flex flex-wrap gap-1.5">
                                {groups.map((g) => {
                                    const puesto = gruposElegidos.includes(g.id);
                                    return (
                                        /* Píldora porque es una elección que se prende y se apaga,
                                           no un botón que dispara algo. */
                                        <button key={g.id} type="button"
                                            onClick={() => alternar(gruposElegidos, setGruposElegidos, g.id)}
                                            className={cn(
                                                "px-2.5 py-1 rounded-full border text-[12px] font-semibold transition-colors flex items-center gap-1.5",
                                                puesto ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]"
                                                    : "border-border text-muted-foreground hover:bg-accent",
                                            )}>
                                            {puesto && <Check size={11} />}{g.name}
                                        </button>
                                    );
                                })}
                                {!groups.length && <span className="text-[12px] text-muted-foreground">Todavía no hay grupos creados.</span>}
                            </div>
                            {gruposElegidos.map((id) => <input key={id} type="hidden" name="groupId" value={id} />)}
                        </div>
                    </CajonSeccion>

                    {/* ── A qué equipos se manda ── */}
                    <CajonSeccion titulo="A qué equipos se manda"
                        ayuda="Los grupos dan el permiso; esto copia la credencial a la memoria del equipo. Son cosas distintas: sin la copia, el equipo tiene el permiso pero no sabe a quién reconocer.">

                        <EquiposDeLosGrupos groups={groups} elegidos={gruposElegidos} />

                        <div>
                            <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85 mb-1.5">
                                <Camera size={13} /> Cámaras LPR
                            </span>
                            {!chapa.trim() ? (
                                <p className="text-[12px] text-muted-foreground">Cargá una matrícula arriba para poder mandarla.</p>
                            ) : camarasLpr.length ? (
                                <div className="space-y-1.5">
                                    {camarasLpr.map((d) => (
                                        <Equipo key={d.id} equipo={d} icono={Camera} estado={estados[d.id]}
                                            elegido={lprElegidos.includes(d.id)}
                                            alTocar={() => alternar(lprElegidos, setLprElegidos, d.id)} />
                                    ))}
                                </div>
                            ) : (
                                <p className="text-[12px] text-muted-foreground">No hay cámaras LPR dadas de alta.</p>
                            )}
                            {lprElegidos.map((id) => <input key={id} type="hidden" name="syncDeviceId" value={id} />)}
                            {lprElegidos.length > 0 && chapa.trim() && (
                                <p className="text-[12px] text-muted-foreground mt-1.5">
                                    Al guardar, <b className="text-foreground">{chapa.trim().toUpperCase()}</b> se copia
                                    a {lprElegidos.length} {lprElegidos.length === 1 ? "cámara" : "cámaras"}.
                                </p>
                            )}
                        </div>

                        <div>
                            <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85 mb-1.5">
                                <ScanFace size={13} /> Terminales de rostro
                            </span>
                            {!foto ? (
                                <p className="text-[12px] text-muted-foreground">Subí una foto arriba para poder mandarla.</p>
                            ) : terminalesFaciales.length ? (
                                <div className="space-y-1.5">
                                    {terminalesFaciales.map((d) => (
                                        <Equipo key={d.id} equipo={d} icono={ScanFace} estado={estados[d.id]}
                                            elegido={facialesElegidos.includes(d.id)}
                                            alTocar={() => alternar(facialesElegidos, setFacialesElegidos, d.id)} />
                                    ))}
                                </div>
                            ) : (
                                <p className="text-[12px] text-muted-foreground">No hay terminales de rostro dados de alta.</p>
                            )}
                            {facialesElegidos.map((id) => <input key={id} type="hidden" name="syncFaceDeviceId" value={id} />)}
                        </div>

                        {progreso && (
                            <div className="rounded-[10px] border border-border bg-card/60 p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[12.5px] font-semibold text-foreground">
                                        {progreso.hecho === progreso.total ? "Envío terminado" : `Enviando a ${progreso.nombre}`}
                                    </span>
                                    <span className="text-[12px] text-muted-foreground tabular-nums">
                                        {progreso.hecho} de {progreso.total}
                                    </span>
                                </div>
                                <Progress value={(progreso.hecho / progreso.total) * 100} />
                            </div>
                        )}
                    </CajonSeccion>
                </form>
            </CajonContenido>
        </Cajon>
    );
}

/**
 * Qué equipos quedan alcanzados por los grupos elegidos.
 *
 * Distingue tres cosas que antes se veían iguales: que no haya grupos elegidos, que los
 * grupos no tengan equipos, y que la pantalla no haya PEDIDO los equipos al traer los
 * grupos. Este último caso decía "no hay equipos vinculados", que es una afirmación sobre
 * los datos hecha sin haberlos mirado — y dependiendo de qué pantalla abra este cajón, es
 * falsa.
 */
function EquiposDeLosGrupos({ groups, elegidos }: { groups: AccessGroup[]; elegidos: string[] }) {
    const puestos = groups.filter((g) => elegidos.includes(g.id));
    const seCargaron = puestos.some((g) => Array.isArray((g as any).devices));
    const equipos = puestos.flatMap((g) => (g as any).devices || []);

    return (
        <div>
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85 mb-1.5">
                <Server size={13} /> Por los grupos elegidos
            </span>
            {!elegidos.length ? (
                <p className="text-[12px] text-muted-foreground">Sin grupos, no tiene permiso en ningún equipo.</p>
            ) : !seCargaron ? (
                <p className="text-[12px] text-muted-foreground">Esta pantalla no trae los equipos de cada grupo; se ven en Grupos de Acceso.</p>
            ) : equipos.length ? (
                <div className="flex flex-wrap gap-1.5">
                    {equipos.map((d: any, i: number) => (
                        <span key={i} className="px-2 py-0.5 rounded-full border border-border text-[11.5px] text-muted-foreground">
                            {d.name}
                        </span>
                    ))}
                </div>
            ) : (
                <p className="text-[12px] text-muted-foreground">Los grupos elegidos no tienen equipos asociados.</p>
            )}
        </div>
    );
}
