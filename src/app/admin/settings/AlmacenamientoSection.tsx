"use client";

/**
 * Dónde viven las capturas.
 *
 * ── EL ENFOQUE ANTERIOR, Y POR QUÉ NO SERVÍA ──────────────────────────────────────────
 *
 * La pantalla se llamaba «Almacenamiento (Lifecycle & S3)» y estaba organizada alrededor
 * de la TECNOLOGÍA: a la izquierda las políticas de S3, a la derecha las credenciales de
 * S3. La pregunta que contestaba era "¿cómo está configurado el object storage?".
 *
 * La pregunta que alguien tiene de verdad al entrar acá es otra: **¿dónde están las fotos
 * y cuánto ocupan?** Y contestada así, la pantalla anterior era falsa por omisión.
 *
 * Medido el 23 de setiembre de 2026: el bucket `lpr-prod` tenía una sola carpeta de mapas
 * y ninguna captura, mientras `/datos/track` tenía **368 MB en 1.214 archivos**. La
 * pasarela de seguimiento escribe con `fs.writeFileSync` al disco del contenedor y
 * devuelve una ruta que lee ese mismo disco; en `tracking-worker.js` y en toda
 * `api/tracking/` no aparece la palabra S3 una sola vez. Y como este barrio todavía no
 * tiene cámaras de barrera, el seguimiento es lo único que genera capturas.
 *
 * O sea: la pantalla ofrecía configurar «días de retención antes de borrar» sobre un
 * bucket que nadie escribe, mientras el disco crecía sin control y sin que eso apareciera
 * en ningún lado. Otro control que se puede tocar y no gobierna nada.
 *
 * Tres defectos más que tenía, chicos y del mismo tipo:
 *
 * - `fecha(stats.lpr.count)` le pasaba un CONTEO a un formateador de FECHAS. Por eso el
 *   panel decía «31 dic. 1969 archivos»: es la época Unix con cero adentro.
 * - Mostraba y dejaba reconfigurar el **bucket de FACE** en una instalación que corre en
 *   modo matrículas. Ahora el bucket sale de `bucketKey` del módulo activo, así que un
 *   modo no ve los de los otros.
 * - Un color por bucket (azul para LPR, violeta para FACE), sombra sobre paneles que no
 *   flotan, `rounded-2xl`, `font-mono` donde va `tabular-nums` y una animación de entrada.
 *
 * ── EL ENFOQUE NUEVO ──────────────────────────────────────────────────────────────────
 *
 * Primero **dónde están las capturas** — los dos lugares, con lo que cada uno tiene de
 * verdad y qué retención lo gobierna. Después la conexión, que es plomería y va abajo.
 *
 * Que el número del disco esté a la vista es lo que convierte "hay que decidir la
 * retención" en algo que se ve en vez de algo que hay que acordarse.
 */

import { useCallback, useEffect, useState } from "react";
import { sileo as toast } from "sileo";
import { HardDrive, Cloud, RefreshCcw, Save, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MODULE_DEFINITIONS, type ModuleInfo } from "@/lib/module-definitions";
import { getEnabledModules } from "@/app/actions/modules";
import {
    getSetting, updateSetting, testS3Connection,
    getBucketLifecycle, updateBucketLifecycle, getBucketStats, estadoCapturasLocales,
} from "@/app/actions/settings";

/** Bytes en algo que se lee. `tabular-nums` en quien lo muestre, para que no baile. */
function tamaño(bytes: number): string {
    if (!bytes) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1))} ${u[i]}`;
}

/** Un conteo con separador de miles. NO `fecha()`, que es lo que estaba. */
const cuenta = (n: number) => n.toLocaleString("es-UY");

/* ── Un lugar donde hay capturas ────────────────────────────────────────────────── */
function Lugar({ icono: Icono, nombre, donde, archivos, bytes, cargando, nota, retencion, problema }: {
    icono: typeof Cloud; nombre: string; donde: string;
    archivos: number; bytes: number; cargando: boolean;
    nota?: string; retencion: React.ReactNode; problema?: string;
}) {
    return (
        <div className="rounded-[var(--radius)] border border-border bg-card p-4">
            <div className="flex items-start gap-3">
                <Icono size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold leading-snug text-foreground">{nombre}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{donde}</div>
                </div>
                <div className="shrink-0 text-right">
                    <div className="text-[13px] font-bold tabular-nums text-foreground">
                        {cargando ? "—" : tamaño(bytes)}
                    </div>
                    <div className="text-[11px] tabular-nums text-muted-foreground">
                        {cargando ? "—" : `${cuenta(archivos)} archivo${archivos === 1 ? "" : "s"}`}
                    </div>
                </div>
            </div>

            {problema && (
                <p className="mt-3 border-t border-border pt-3 text-[11px] leading-[1.45] text-[var(--mal-texto)]">
                    {problema}
                </p>
            )}

            {nota && !problema && (
                <p className="mt-3 border-t border-border pt-3 text-[11px] leading-[1.45] text-[var(--aviso-texto)]">
                    {nota}
                </p>
            )}

            <div className="mt-3 border-t border-border pt-3">{retencion}</div>
        </div>
    );
}

/* ── La pantalla ────────────────────────────────────────────────────────────────── */
export default function AlmacenamientoSection() {
    const [modulo, setModulo] = useState<ModuleInfo | null>(null);
    const [bucket, setBucket] = useState("");
    const [conexion, setConexion] = useState({ endpoint: "", accessKey: "", secretKey: "" });
    const [enBucket, setEnBucket] = useState({ archivos: 0, bytes: 0, cargando: true });
    const [enDisco, setEnDisco] = useState<{ archivos: number; bytes: number; carpeta: string; cargando: boolean; motivo?: string }>(
        { archivos: 0, bytes: 0, carpeta: "", cargando: true });
    const [dias, setDias] = useState(0);
    const [cargando, setCargando] = useState(true);
    const [ocupado, setOcupado] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const mods = await getEnabledModules();
            /* El módulo que manda es el modo puesto. Si ninguno lo está, no hay bucket que
               mostrar — y eso se dice, no se rellena con el primero de la lista. */
            const activo = MODULE_DEFINITIONS.find((m) => m.exclusive && mods[m.id] && m.bucket) || null;
            setModulo(activo);

            const [e, ak, sk] = await Promise.all([
                getSetting("S3_ENDPOINT"), getSetting("S3_ACCESS_KEY"), getSetting("S3_SECRET_KEY"),
            ]);
            setConexion({ endpoint: e?.value || "", accessKey: ak?.value || "", secretKey: sk?.value || "" });

            const local = await estadoCapturasLocales();
            setEnDisco({
                archivos: local.archivos, bytes: local.bytes, carpeta: local.carpeta,
                cargando: false, motivo: local.ok ? undefined : local.motivo,
            });

            if (!activo?.bucket) { setCargando(false); return; }
            const b = await getSetting(activo.bucket.key);
            const nombre = b?.value || "";
            setBucket(nombre);

            if (nombre) {
                const [st, lc] = await Promise.all([getBucketStats(nombre), getBucketLifecycle(nombre)]);
                setEnBucket({
                    archivos: st.success ? (st.count ?? 0) : 0,
                    bytes: st.success ? (st.size ?? 0) : 0,
                    cargando: false,
                });
                setDias(lc.success ? (lc.days || 0) : 0);
            } else {
                setEnBucket({ archivos: 0, bytes: 0, cargando: false });
            }
        } catch {
            toast.error({ title: "No se pudo leer la configuración de almacenamiento" });
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const guardarConexion = async () => {
        setOcupado("conexion");
        try {
            await Promise.all([
                updateSetting("S3_ENDPOINT", conexion.endpoint),
                updateSetting("S3_ACCESS_KEY", conexion.accessKey),
                updateSetting("S3_SECRET_KEY", conexion.secretKey),
                ...(modulo?.bucket ? [updateSetting(modulo.bucket.key, bucket)] : []),
            ]);
            toast.success({ title: "Conexión guardada" });
            cargar();
        } catch {
            toast.error({ title: "No se pudo guardar" });
        } finally { setOcupado(null); }
    };

    const probar = async () => {
        setOcupado("probar");
        try {
            const r = await testS3Connection(modulo?.bucket?.tipo ?? "lpr");
            if (r.success) toast.success({ title: `El bucket «${bucket}» responde` });
            else toast.error({ title: r.message || "El bucket no responde" });
        } catch {
            toast.error({ title: "No se pudo conectar con el servidor" });
        } finally { setOcupado(null); }
    };

    const guardarRetencion = async () => {
        if (!bucket) return;
        setOcupado("retencion");
        try {
            const r = await updateBucketLifecycle(bucket, dias);
            if (r.success) toast.success({ title: dias === 0 ? "Sin borrado automático" : `Se borra a los ${dias} días` });
            else toast.error({ title: "No se pudo cambiar la retención" });
        } catch {
            toast.error({ title: "Error hablando con el servidor de objetos" });
        } finally { setOcupado(null); }
    };

    if (cargando) {
        return (
            <div className="space-y-4">
                <div className="h-5 w-60 rounded-[var(--radius-sm)] bg-muted" />
                <div className="h-28 rounded-[var(--radius)] border border-border bg-card" />
                <div className="h-28 rounded-[var(--radius)] border border-border bg-card" />
            </div>
        );
    }

    /* Las capturas del seguimiento no pasan por S3. Mientras eso sea cierto, decirlo acá
       es lo único honesto: si no, el panel de retención parece gobernar algo que no
       gobierna. El día que la pasarela suba a S3, esta nota sobra y se saca. */
    const seguimientoEnDisco = enDisco.archivos > 0;

    return (
        <div className="space-y-8">
            <header>
                <h2 className="text-[20px] font-bold leading-tight tracking-[-0.015em] text-foreground">
                    Dónde viven las capturas
                </h2>
                <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                    Las fotos de matrículas y rostros se guardan en dos lugares distintos, y cada uno
                    se limpia por su cuenta. Acá están los dos, con lo que ocupan ahora.
                </p>
            </header>

            <section className="space-y-3">
                {modulo ? (
                    <Lugar
                        icono={Cloud}
                        nombre={`Object storage · ${bucket || "sin bucket configurado"}`}
                        donde={conexion.endpoint || "sin endpoint configurado"}
                        archivos={enBucket.archivos}
                        bytes={enBucket.bytes}
                        cargando={enBucket.cargando}
                        nota={seguimientoEnDisco
                            ? "Las capturas del seguimiento NO llegan acá: la pasarela las escribe en el disco del servidor. Esta retención gobierna sólo lo que sí se sube."
                            : undefined}
                        retencion={
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="text-[11px] text-muted-foreground">Borrar después de</span>
                                <Input
                                    type="number" min={0} value={dias}
                                    onChange={(e) => setDias(Math.max(0, parseInt(e.target.value) || 0))}
                                    className="h-8 w-20 text-center text-[13px] font-semibold tabular-nums"
                                />
                                <span className="text-[11px] text-muted-foreground">
                                    días {dias === 0 && <b className="font-semibold text-foreground">· 0 = nunca se borra</b>}
                                </span>
                                <button
                                    type="button" onClick={guardarRetencion}
                                    disabled={!bucket || ocupado === "retencion"}
                                    className="ml-auto rounded-[var(--radius-sm)] bg-[var(--accion)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--accion-texto)] transition-colors hover:bg-[var(--accion-sobre)] disabled:opacity-50">
                                    {ocupado === "retencion" ? "Guardando…" : "Aplicar"}
                                </button>
                            </div>
                        }
                    />
                ) : (
                    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
                        <div className="text-[13px] font-semibold text-foreground">No hay ningún modo puesto</div>
                        <p className="mt-1 max-w-xl text-[11px] leading-[1.45] text-muted-foreground">
                            El bucket que se muestra acá es el del modo activo. Elegí uno en Modos.
                        </p>
                    </div>
                )}

                <Lugar
                    icono={HardDrive}
                    nombre="Disco del servidor · capturas del seguimiento"
                    donde={enDisco.carpeta}
                    archivos={enDisco.archivos}
                    bytes={enDisco.bytes}
                    cargando={enDisco.cargando}
                    problema={enDisco.motivo ? `No se pudo leer la carpeta: ${enDisco.motivo}` : undefined}
                    retencion={
                        <p className="text-[11px] leading-[1.45] text-[var(--aviso-texto)]">
                            <b className="font-semibold">Sin retención.</b> Nada borra estos archivos: crecen hasta
                            llenar el disco. Hay que decidir cuántos días conservarlos.
                        </p>
                    }
                />
            </section>

            {/* La plomería, abajo, que es donde va: se toca una vez por instalación. */}
            <section className="space-y-2.5">
                <h3 className="text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-muted-foreground">
                    Conexión con el object storage
                </h3>

                <div className="space-y-4 rounded-[var(--radius)] border border-border bg-card p-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label className="space-y-1.5">
                            <span className="block text-[11px] font-semibold text-muted-foreground">Endpoint</span>
                            <Input value={conexion.endpoint} placeholder="http://127.0.0.1:9000"
                                onChange={(e) => setConexion({ ...conexion, endpoint: e.target.value })}
                                className="h-9 text-[13px]" />
                        </label>
                        <label className="space-y-1.5">
                            <span className="block text-[11px] font-semibold text-muted-foreground">
                                Bucket de {modulo?.name ?? "este modo"}
                            </span>
                            <Input value={bucket} disabled={!modulo} placeholder="lpr-prod"
                                onChange={(e) => setBucket(e.target.value)}
                                className="h-9 text-[13px]" />
                        </label>
                        <label className="space-y-1.5">
                            <span className="block text-[11px] font-semibold text-muted-foreground">Access key</span>
                            <Input value={conexion.accessKey}
                                onChange={(e) => setConexion({ ...conexion, accessKey: e.target.value })}
                                className="h-9 text-[13px]" />
                        </label>
                        <label className="space-y-1.5">
                            <span className="block text-[11px] font-semibold text-muted-foreground">Secret key</span>
                            <Input type="password" value={conexion.secretKey} placeholder="••••••••"
                                onChange={(e) => setConexion({ ...conexion, secretKey: e.target.value })}
                                className="h-9 text-[13px]" />
                        </label>
                    </div>

                    {/* Sólo el bucket del modo puesto.
                        Antes esta pantalla mostraba el de LPR y el de Face siempre, en las dos
                        instalaciones: un barrio en modo matrículas veía —y podía reconfigurar— el
                        bucket de un módulo que ni siquiera tiene prendido. */}
                    <p className="flex items-start gap-2 text-[11px] leading-[1.45] text-muted-foreground">
                        <Info size={13} className="mt-px shrink-0" />
                        Se muestra sólo el bucket del modo que está puesto. Los de los demás modos se
                        configuran cambiando de modo.
                    </p>

                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                        <button
                            type="button" onClick={probar} disabled={!bucket || ocupado === "probar"}
                            className="rounded-[var(--radius-sm)] border border-border px-3.5 py-2 text-[12px] font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-50">
                            {ocupado === "probar" ? "Probando…" : "Probar conexión"}
                        </button>
                        <button
                            type="button" onClick={cargar}
                            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-3.5 py-2 text-[12px] font-semibold text-foreground transition-colors hover:bg-accent">
                            <RefreshCcw size={13} /> Volver a medir
                        </button>
                        <button
                            type="button" onClick={guardarConexion} disabled={ocupado === "conexion"}
                            className={cn(
                                "ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-4 py-2 text-[12px] font-semibold transition-colors",
                                "bg-[var(--accion)] text-[var(--accion-texto)] hover:bg-[var(--accion-sobre)] disabled:opacity-50")}>
                            <Save size={13} /> {ocupado === "conexion" ? "Guardando…" : "Guardar"}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}
