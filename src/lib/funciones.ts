import type { ModuleId } from "@/lib/module-definitions";

/**
 * Las funciones que se prenden y se apagan DENTRO de un módulo.
 *
 * Un módulo es una instalación entera: LPR, rostro, filas. Una función es algo que ese
 * módulo puede hacer o no hacer sin dejar de ser él mismo. Las estadías son el primer
 * caso: un barrio que quiere saber qué autos quedaron estacionados y otro al que sólo le
 * importa quién entró y quién salió usan el mismo módulo LPR, y hasta ahora el primero era
 * el único posible porque estaba escrito en el código.
 *
 * Y no es un detalle de gusto. El seguimiento de estadías hace trabajo real: mantiene una
 * fila abierta por vehículo quieto, la releé, la vigila y la cierra. En una instalación
 * que no lo va a mirar nunca, eso es trabajo que no le sirve a nadie.
 *
 * Se guardan en Setting igual que los módulos, con la misma forma, para que el día que
 * haya una segunda función no haya que inventar un segundo mecanismo.
 */

export type FuncionId = "LPR_ESTADIAS" | "LPR_OCUPACION" | "LPR_MARCAS" | "LPR_PLAZAS" | "LPR_BUSQUEDA" | "LPR_MIN_INTERIOR"
    | "FUNC_INTRUSION" | "FUNC_ALARMAS_RECEPCION" | "FUNC_ALARMAS_GESTION" | "EQUIPOS_USUARIOS";

export interface Funcion {
    id: FuncionId;
    /**
     * «modulo»: cuelga de un modo (Matrículas…) y sin él no existe.
     * «instalacion»: no depende del modo — Intrusión y las alarmas valen igual en Matrículas, Rostro
     * y Filas (23/10, Nico: «no deben estar atadas a un modo de funcionamiento»).
     */
    alcance: "modulo" | "instalacion";
    /** De qué módulo cuelga (sólo las de alcance «modulo»): apagado el módulo, la función no existe. */
    modulo?: ModuleId;
    nombre: string;
    que: string;
    /** Lo que deja de pasar al apagarla. Se dice antes de apagar, no después. */
    siSeApaga: string;
    porDefecto: boolean;
    /**
     * De qué OTRA función depende, si depende de alguna.
     *
     * Hacía falta en cuanto apareció la segunda. El motor de ocupación no es una función
     * hermana de las estadías: es una MANERA de medirlas. Con las estadías apagadas no hay
     * nada que medir, así que prenderlo solo no significaría nada — y una pantalla que
     * ofrece prender algo que no va a hacer nada es exactamente la clase de control que
     * miente.
     *
     * Se declara acá y no se deduce en la pantalla para que el código que la lee (las
     * rutas del seguimiento) y el que la dibuja usen la misma verdad.
     */
    requiere?: FuncionId;
}

export const FUNCIONES: Funcion[] = [
    {
        id: "LPR_ESTADIAS",
        alcance: "modulo",
        modulo: "MODULE_LPR",
        nombre: "Estadías y estacionamiento",
        que: "Sigue a los vehículos que quedan quietos frente a una cámara interior: cuánto llevan ahí, dónde están en el plano, y avisa cuando estacionan y cuando se retiran.",
        siSeApaga: "Las cámaras interiores siguen leyendo matrículas y el recorrido se sigue dibujando, pero ningún vehículo queda marcado como estacionado y el plano deja de mostrar autos parados.",
        porDefecto: true,
    },
    {
        id: "LPR_OCUPACION",
        alcance: "modulo",
        modulo: "MODULE_LPR",
        requiere: "LPR_ESTADIAS",
        nombre: "Motor de ocupación por franja (sin OmniVision)",
        que: "El criterio viejo de la franja: compara cada lugar contra su aspecto vacío aprendido. Desde el 18/10 el estacionamiento es una analítica de OmniVision (Visión → Estacionamiento) que ve los vehículos y no necesita aprender la calle vacía; este motor sólo corre en las cámaras con franja que OmniVision no mira, o con esa analítica apagada.",
        siSeApaga: "Las cámaras con franja vuelven al criterio por matrícula: la permanencia se calcula releyendo la chapa, que es lo que hacen las cámaras sin franja. Se dejan de abrir y cerrar ocupaciones por lugar, y el plano deja de decir qué lugar ocupa cada vehículo.",
        porDefecto: true,
    },
    {
        id: "LPR_MARCAS",
        alcance: "modulo",
        modulo: "MODULE_LPR",
        nombre: "Marca del vehículo según la cámara",
        que: "Muestra la marca (en texto) que reconoce la cámara en cada lectura: en el monitor LPR, en la ficha del evento y en el visor. La marca del padrón se muestra siempre.",
        siSeApaga: "Se dejan de mostrar las marcas que adivina la cámara, que fallan seguido y pueden confundir una búsqueda. Se siguen guardando con la lectura: prenderla otra vez las muestra también en lo ya leído.",
        porDefecto: false,
    },
    {
        id: "LPR_PLAZAS",
        alcance: "modulo",
        modulo: "MODULE_LPR",
        nombre: "Plazas de parking (cocheras)",
        que: "Las cocheras del barrio: la pantalla Plazas de Parking, la cochera asignada a cada residente, el botón de plaza en el Monitor LPR y en la consola de la guardia, y la cochera en la ficha del evento.",
        siSeApaga: "Desaparecen del menú y de las pantallas todo lo de plazas y cocheras (20/10: San Nicolás no las usa). Las cocheras ya cargadas no se borran: prenderla otra vez las muestra como estaban. Los lotes del mapa siguen vinculados.",
        porDefecto: true,
    },
    {
        id: "LPR_BUSQUEDA",
        alcance: "modulo",
        modulo: "MODULE_LPR",
        nombre: "Matrículas «En búsqueda»",
        que: "Un segundo nivel de la lista negra: la matrícula pasa, pero al leerla se avisa con el motivo (ámbar en el monitor y en los avisos).",
        siSeApaga: "Queda sólo la lista negra (alerta máxima): se deja de ofrecer «En búsqueda» al cargar, desaparece de las listas y de los filtros, y no salta ningún aviso de búsqueda (20/10: San Nicolás no la usa). Las cargadas no se borran.",
        porDefecto: true,
    },
    {
        id: "LPR_MIN_INTERIOR",
        alcance: "modulo",
        modulo: "MODULE_LPR",
        nombre: "Consulta de Matrículas Requeridas (Min. del Interior)",
        que: "El botón «Min. Interior» del Monitor LPR: consulta la matrícula en el sitio público de Matrículas Requeridas, con el código de seguridad que escribe el guardia.",
        siSeApaga: "Desaparece el botón del Monitor LPR y la consulta deja de responder. Apagada por defecto desde el 26/10: el sitio del Ministerio dejó de contestar a la consulta y el botón sólo daba error.",
        porDefecto: false,
    },

    // ── Funciones de la instalación (openspec/changes/alarmas-como-funciones) ──
    {
        id: "FUNC_INTRUSION",
        alcance: "instalacion",
        nombre: "Intrusión",
        que: "Las analíticas de línea y zona de las cámaras: el Monitor Intrusión, la alerta que se abre en cualquier pantalla del panel, la vista de pared Intrusión y los avisos de intrusión por las reglas de notificación. En cualquier modo.",
        siSeApaga: "Desaparecen el Monitor Intrusión del menú, la alerta global de intrusión, la vista de pared Intrusión y los avisos de cruces e intrusiones. Lo que mandan las cámaras se sigue guardando: al prenderla otra vez se ve también lo que pasó mientras estuvo apagada. Las alarmas de las centrales no dependen de esto.",
        porDefecto: true,
    },
    {
        id: "FUNC_ALARMAS_RECEPCION",
        alcance: "instalacion",
        nombre: "Recepción de alarmas",
        que: "El receptor de centrales de alarma (SIA DC-09, Contact ID y la salida IPC10 de receptores): escucha sus puertos, registra cada mensaje, controla la supervisión de cada central y avisa por las reglas. Las centrales se dan de alta en Dispositivos y su registro está en Gestión de alarmas › Centrales.",
        siSeApaga: "El receptor deja de aceptar conexiones (en menos de 30 s) y cada central va a registrar falla de comunicación. No se pueden dar de alta centrales y se oculta la pestaña Centrales. Las centrales y su registro no se borran. También deja sin efecto la Gestión de alarmas de central.",
        porDefecto: false,
    },
    {
        id: "FUNC_ALARMAS_GESTION",
        alcance: "instalacion",
        requiere: "FUNC_ALARMAS_RECEPCION",
        nombre: "Gestión de alarmas de central",
        que: "Cada alarma de una central se vuelve un evento para tratar: la cola por prioridad, tomar y tratar con cierre y texto, el procedimiento de actuación con sus pasos, la video verificación (vivo y grabación del momento), el escalado, la ventana que se abre en cualquier pantalla y la vista de pared Alarmas.",
        siSeApaga: "Los mensajes se siguen recibiendo, registrando y avisando por las reglas, pero no se crea ninguna alarma para tratar: no hay cola, no se abre ninguna ventana, no se escala y la vista de pared Alarmas se apaga.",
        porDefecto: false,
    },
    {
        id: "EQUIPOS_USUARIOS",
        alcance: "instalacion",
        nombre: "Usuarios de los equipos",
        que: "Lee las cuentas locales de cada equipo compatible (hoy, Hikvision) y quién está conectado y desde dónde. Avisa cuando aparece una cuenta que no creó OmniAccess o una sesión desde una IP desconocida. Las cuentas se ven en la ficha de cada equipo y por área en Dispositivos.",
        siSeApaga: "Se deja de leer a los equipos y desaparecen el bloque de usuarios y el panel de cuentas de las áreas. Lo ya leído no se borra: al prenderla otra vez se ve como estaba y se actualiza en la próxima vuelta.",
        porDefecto: false,
    },
];

/** Las funciones que no dependen del modo. */
export const FUNCIONES_INSTALACION = () => FUNCIONES.filter((f) => f.alcance === "instalacion");

/** ¿Está esta función habilitada por aquella de la que cuelga? */
export const dependenciaCumplida = (f: Funcion, estado: Record<string, boolean>) =>
    !f.requiere || (estado[f.requiere] ?? funcionPorId(f.requiere)?.porDefecto ?? true);

export const funcionPorId = (id: string) => FUNCIONES.find((f) => f.id === id);

/**
 * El estado EFECTIVO de una función dado lo guardado: prendida y con toda la cadena de la que
 * depende prendida. Sin dato guardado vale su defecto. Lo usan el navegador y las pruebas; el
 * servidor hace lo mismo en `funcionActiva`.
 */
export function estadoEfectivo(id: FuncionId, guardado: Partial<Record<string, boolean>>): boolean {
    const f = funcionPorId(id);
    if (!f) return false;
    const v = guardado[id] ?? f.porDefecto;
    return v && (!f.requiere || estadoEfectivo(f.requiere, guardado));
}

/**
 * ¿Este aviso es de una analítica de cámara (cruce, zona, entrada a región…) y no de una central de
 * alarma? Los de central (`CENTRAL`, `CENTRAL_ESCALADO`) viajan con el módulo INTRUSION por historia,
 * pero dependen de la Recepción y la Gestión de alarmas, no de la función Intrusión.
 */
export const esAvisoDeCamara = (e: { modulo?: string | null; evento?: string | null }) =>
    e.modulo === "INTRUSION" && !String(e.evento || "").startsWith("CENTRAL");
