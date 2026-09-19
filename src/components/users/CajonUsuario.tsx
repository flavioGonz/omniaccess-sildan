"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { User, Unit, AccessGroup, Credential } from "@prisma/client";
import {
    Camera, Car, Check, CreditCard, DoorOpen,
    KeyRound, MapPin, ParkingSquare, Phone, Save, ScanFace, Server,
    Shield, Upload, User as UserIcon, HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { createUser, updateUser } from "@/app/actions/users";
import { addDevicePlate } from "@/app/actions/devices";
import { syncUserToDevice } from "@/app/actions/deviceMemory";
import { Pista } from "@/components/ui/pista";
import { PasosEnvio, type Paso } from "@/components/users/PasosEnvio";
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
function Equipo({ equipo, elegido, alTocar, icono: Icono }: {
    equipo: any; elegido: boolean; alTocar: () => void; icono: any;
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
                    <Icono size={14} />
                </span>
                <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-foreground truncate">{equipo.name}</span>
                    <span className="block text-[11.5px] text-muted-foreground tabular-nums truncate">{equipo.ip}</span>
                </span>
            </span>
            {elegido && <Check size={15} className="text-[var(--accion)] shrink-0" />}
        </button>
    );
}

export function CajonUsuario({
    user, initialData, units, groups, devices, parkingSlots = [], onSuccess, open, onOpenChange,
}: CajonUsuarioProps) {
    const esAlta = !user;
    const [foto, setFoto] = useState<string | null>(null);
    const [archivoFoto, setArchivoFoto] = useState<File | null>(null);
    const [chapa, setChapa] = useState("");
    const [pin, setPin] = useState("");
    const [gruposElegidos, setGruposElegidos] = useState<string[]>([]);
    const [lprElegidos, setLprElegidos] = useState<string[]>([]);
    const [facialesElegidos, setFacialesElegidos] = useState<string[]>([]);
    const [unidadId, setUnidadId] = useState("none");
    /* El envío toma la pantalla en vez de ser un renglón debajo del formulario. Null
       mientras se edita; una lista de pasos desde que se aprieta Registrar. */
    const [pasos, setPasos] = useState<Paso[] | null>(null);
    const [terminado, setTerminado] = useState(false);
    const [idGuardado, setIdGuardado] = useState<string | undefined>(undefined);
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
        setPasos(null);
        setTerminado(false);
        setIdGuardado(undefined);
    }, [open, user, initialData]);

    const alternar = (lista: string[], poner: (v: string[]) => void, id: string) =>
        poner(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

    const tocar = (id: string, cambio: Partial<Paso>) =>
        setPasos((p) => p?.map((x) => (x.id === id ? { ...x, ...cambio } : x)) || p);

    /**
     * Corre la lista de pasos de arriba abajo.
     *
     * De a uno y no todos a la vez: los equipos son lentos y encimarles pedidos los tira.
     * Y `soloFallados` existe para el reintento — volver a mandar lo que ya entró no sólo
     * es al pedo, es una escritura más en la memoria de un equipo que no la necesita.
     */
    const correr = async (lista: Paso[], soloFallados = false) => {
        setTerminado(false);
        let falló = false;
        const aCorrer = soloFallados ? lista.filter((p) => p.estado === "falló") : lista;
        setPasos(lista.map((p) => (aCorrer.some((q) => q.id === p.id)
            ? { ...p, estado: "espera", error: undefined } : p)));

        let id = idGuardado;
        for (const paso of aCorrer) {
            tocar(paso.id, { estado: "curso", error: undefined });
            try {
                const r = await (paso as any).hacer(id);
                if (typeof r === "string") { id = r; setIdGuardado(r); }
                tocar(paso.id, { estado: "listo" });
            } catch (e: any) {
                falló = true;
                tocar(paso.id, { estado: "falló", error: e?.message || "No contestó." });
                // Si no se pudo guardar la ficha, lo de abajo no tiene sentido: no hay a
                // quién ponerle la credencial. Se marca y se corta.
                if (paso.id === "ficha") {
                    setPasos((p) => p?.map((x) => x.id === "ficha" ? x
                        : { ...x, estado: "espera", detalle: "No se intentó: la ficha no se guardó." }) || p);
                    break;
                }
            }
            await new Promise((r) => setTimeout(r, 350));
        }
        setTerminado(true);
        return !falló;
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
        const chapaLimpia = String(datos.get("plate") || "").toUpperCase().trim();

        const lista: Paso[] = [{
            id: "ficha",
            titulo: esAlta ? "Crear la ficha" : "Guardar los cambios",
            detalle: nombre,
            estado: "espera",
            hacer: async () => {
                if (user) { await updateUser(user.id, datos); return user.id; }
                return (await createUser(datos)).id;
            },
        } as any];

        if (archivoFoto) lista.push({
            id: "foto", titulo: "Subir la foto", detalle: archivoFoto.name, estado: "espera",
            hacer: async (id: string) => {
                const img = new FormData();
                img.append("faceImage", archivoFoto);
                const r = await fetch(`/api/users/${id}/face`, { method: "POST", body: img });
                if (!r.ok) throw new Error((await r.text()).slice(0, 120) || "El servidor no la aceptó.");
            },
        } as any);

        if (chapaLimpia) for (const id of lprElegidos) {
            const eq = devices.find((d) => d.id === id);
            lista.push({
                id: `lpr:${id}`, titulo: `Copiar ${chapaLimpia} a ${eq?.name || "la cámara"}`,
                detalle: eq?.ip, estado: "espera",
                hacer: async () => {
                    const r = await addDevicePlate(id, chapaLimpia);
                    if (!r?.success) throw new Error((r as any)?.error || "La cámara rechazó la matrícula.");
                },
            } as any);
        }

        if (foto) for (const id of facialesElegidos) {
            const eq = devices.find((d) => d.id === id);
            lista.push({
                id: `face:${id}`, titulo: `Enviar el rostro a ${eq?.name || "el terminal"}`,
                detalle: eq?.ip, estado: "espera",
                hacer: async (uid: string) => {
                    if (!(await syncUserToDevice(id, uid))) throw new Error("El terminal no aceptó el rostro.");
                },
            } as any);
        }
        setPasos(lista);
        const hechos = await correr(lista);
        onSuccess();
        /* Si salió todo, quedarse mirando una lista de tildes verdes no le sirve a nadie.
           Si algo falló, el cajón se queda: cerrarlo igual era el error de antes --la
           persona guardada, la cámara sin la matrícula, y nadie enterado. */
        if (hechos) {
            await new Promise((r) => setTimeout(r, 900));
            onOpenChange(false);
        }
    };

    return (
        <Cajon open={open} onOpenChange={onOpenChange}>
            <CajonContenido
                ancho="medio"
                titulo={esAlta ? "Nueva persona" : user?.name || "Ficha de la persona"}
                descripcion="Quién es, dónde vive, con qué entra y a qué equipos se manda."
                onInteractOutside={(e) => e.preventDefault()}
                /* Durante el envío no hay pie: los botones que corresponden --reintentar o
                   cerrar-- salen abajo de los pasos, y sólo cuando terminó. Dejar un
                   "Cancelar" mientras se escribe en la memoria de una cámara invita a
                   cortar por la mitad algo que ya está a mitad de camino. */
                pie={pasos ? undefined : (
                    <>
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button type="submit" form="ficha-persona">
                            <Save size={15} />{esAlta ? "Registrar" : "Guardar cambios"}
                        </Button>
                    </>
                )}>

                {pasos ? (
                    <PasosEnvio
                        pasos={pasos}
                        terminado={terminado}
                        alReintentar={() => correr(pasos, true)}
                        alCerrar={() => { onOpenChange(false); onSuccess(); }}
                    />
                ) : (
                <form id="ficha-persona" onSubmit={guardar} noValidate>
                    {initialData?.cara && !archivoFoto && (
                        <input type="hidden" name="cara" value={initialData.cara} />
                    )}

                    {/* ── Quién es ── */}
                    <CajonSeccion titulo="Quién es" icono={UserIcon}>
                        <div className="flex flex-col sm:flex-row gap-5">
                            {/* La foto al lado de los datos y no ocupando media ventana: es UN
                                dato de la persona, del mismo rango que el teléfono. */}
                            <div className="shrink-0 w-full sm:w-[124px]">
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

                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <CajonCampo etiqueta="Nombre y apellido" className="sm:col-span-2"
                                    pista="Es el nombre con el que va a aparecer en el historial, en la bitácora y en el aviso que le llega al guardia cuando entra. Conviene el nombre por el que lo conocen en la entrada, no el del documento.">
                                    <Input name="name" defaultValue={user?.name || initialData?.name}
                                        placeholder="Cómo figura en la lista" autoFocus />
                                </CajonCampo>
                                <CajonCampo etiqueta="Documento"
                                    pista="Sólo sirve para distinguir a dos personas que se llaman igual. No abre ninguna puerta ni se le manda a ningún equipo.">
                                    <Input name="dni" defaultValue={user?.dni || initialData?.dni} placeholder="Opcional, sin puntos" />
                                </CajonCampo>
                                <CajonCampo etiqueta="Teléfono"
                                    pista="Por acá salen los avisos de WhatsApp: que llegó una visita, que quedó un vehículo estacionado. Sin código de país no sale nada.">
                                    <Input name="phone" type="tel" defaultValue={user?.phone || ""} placeholder="Con código de país" />
                                </CajonCampo>
                                <CajonCampo etiqueta="Qué es para el barrio" className="sm:col-span-2"
                                    pista="Decide qué ve y qué puede hacer, y cómo lo trata el historial. Una visita temporal caduca sola; un residente no. Administrador y Personal además entran al panel.">
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
                    <CajonSeccion titulo="Dónde vive" icono={DoorOpen}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <CajonCampo etiqueta="Lote o unidad"
                                    pista="El lote que tiene dibujado en el plano del barrio. Es lo que hace que, al leerse su matrícula, el sistema sepa a qué casa avisar.">
                                <Select name="unitId" value={unidadId} onValueChange={setUnidadId}>
                                    <SelectTrigger><SelectValue placeholder="Elegir…" /></SelectTrigger>
                                    <SelectContent className="max-h-[260px]">
                                        <SelectItem value="none">Sin asignar</SelectItem>
                                        {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </CajonCampo>
                            <CajonCampo etiqueta="Cochera"
                                    pista="Las que están ocupadas por otra persona aparecen apagadas: una cochera es de uno solo, y dejar elegir una tomada crea un conflicto que después nadie sabe de dónde salió.">
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
                    <CajonSeccion titulo="Con qué entra" icono={KeyRound}
                        ayuda="Cada credencial abre por un camino distinto. Se pueden cargar todas o ninguna.">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <CajonCampo etiqueta="Matrícula"
                                pista="Se escribe sin espacios ni guiones, como la lee la cámara. Cargarla acá no alcanza para que abra la barrera: hay que mandarla además a los equipos, abajo.">
                                <Input name="plate" value={chapa} placeholder="ABC1234"
                                    onChange={(e) => setChapa(e.target.value.toUpperCase())}
                                    className="font-bold tracking-[0.12em] tabular-nums uppercase" />
                            </CajonCampo>
                            <CajonCampo etiqueta="Qué vehículo es"
                                pista="No cambia si abre o no. Sirve para reconocerlo en el historial cuando la foto no se ve bien, y para los informes por tipo de vehículo.">
                                <Select name="vehicleType" defaultValue={user?.vehicles?.[0]?.type || "SEDAN"}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {CLASES_VEHICULO.map((v) => <SelectItem key={v.valor} value={v.valor}>{v.rotulo}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </CajonCampo>
                            <CajonCampo etiqueta="Tarjetas o llaveros"
                                pista="El número grabado en la tarjeta o el llavero RFID. Una persona puede tener varios: el del auto, el de la bicicleta, el de la casa."
                                pistaTitulo="Tarjetas y llaveros RFID">
                                <Input name="accessTags"
                                    defaultValue={user?.accessTags?.join(", ")
                                        || user?.credentials?.find((c) => c.type === "TAG")?.value || ""}
                                    placeholder="Varios, separados por coma" className="tabular-nums" />
                            </CajonCampo>
                            <CajonCampo etiqueta="Código PIN"
                                pista="Queda oculto al escribirlo, pero se guarda tal cual: cualquiera con acceso al panel puede verlo. No sirve como contraseña de nada más.">
                                <PasswordInput name="pin" value={pin} onChange={(e) => setPin(e.target.value)}
                                    placeholder="Para el teclado de la entrada" className="tabular-nums" />
                            </CajonCampo>
                        </div>

                        <div>
                            <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85 mb-1.5">
                                Grupos de acceso
                                <Pista titulo="Grupos de acceso" ancho={280}
                                    texto="El grupo dice POR DÓNDE y CUÁNDO puede pasar: qué equipos y en qué horarios. Sin ningún grupo, la persona queda cargada pero no abre nada.">
                                    <HelpCircle size={12.5} className="text-muted-foreground/50 hover:text-[var(--accion)] transition-colors cursor-help" />
                                </Pista>
                            </span>
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
                    <CajonSeccion titulo="A qué equipos se manda" icono={Server}
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
                                        <Equipo key={d.id} equipo={d} icono={Camera}
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
                                        <Equipo key={d.id} equipo={d} icono={ScanFace}
                                            elegido={facialesElegidos.includes(d.id)}
                                            alTocar={() => alternar(facialesElegidos, setFacialesElegidos, d.id)} />
                                    ))}
                                </div>
                            ) : (
                                <p className="text-[12px] text-muted-foreground">No hay terminales de rostro dados de alta.</p>
                            )}
                            {facialesElegidos.map((id) => <input key={id} type="hidden" name="syncFaceDeviceId" value={id} />)}
                        </div>

                    </CajonSeccion>
                </form>
                )}
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
