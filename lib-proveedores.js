/**
 * Los proveedores de un lote que entran por matrícula, en sus días y horario (26/11).
 *
 * Nico: «los proveedores de cada lote hoy se identifican pero no tienen la entrada habilitada:
 * avanzá con dejarlos entrar por matrícula en sus días y horarios». Un servicio del lote
 * (ServicioLote) con la entrada habilitada vale como una credencial, pero sólo dentro de su
 * horario: el jardinero que viene martes y viernes de 8 a 12 entra el martes a las 9, y el
 * domingo a las 23 queda DENEGADO con el aviso de que es del lote X fuera de su horario.
 *
 * Lo usa server.js en el camino de la barrera, así que es CommonJS y recibe el prisma de quien
 * lo llama (un segundo PrismaClient por librería es como se agotan las conexiones). La lista
 * negra se decide antes y manda: esto nunca habilita a una matrícula en lista negra.
 *
 * Por qué no va a la lista blanca de la cámara: la cámara guarda una matrícula con fecha de alta
 * y de vencimiento, pero no días de la semana ni horas. Cargarla ahí sería dejarla entrar
 * siempre. La decide el servidor.
 */

const ZONA = process.env.NEXT_PUBLIC_TZ || process.env.TZ_SITIO || "America/Montevideo";
/** Los días como los guarda ServicioLote, en el orden de getDay() (0 = domingo). */
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
/**
 * Cuánto antes y después de su horario se lo deja pasar. El jardinero de las 8 llega 7:45, y se
 * va 12:20 cuando terminó. Más que esto ya es otro día de trabajo, que se carga como tal.
 */
const MARGEN_MIN = 30;

const limpia = (p) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const minutos = (h) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

function relojDe(fecha, zona) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: zona || ZONA, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(fecha);
    const de = (t) => (p.find((x) => x.type === t) || {}).value;
    return { dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(de("weekday")), minuto: Number(de("hour")) * 60 + Number(de("minute")) };
}

/**
 * ¿Está dentro de su horario?
 *
 * Sin días no hay horario que cumplir: no entra (la pantalla no deja habilitar sin días). Sin
 * horas, vale el día entero. Un horario que cruza la medianoche («de 22:00 a 06:00», el sereno)
 * pertenece al día en que EMPIEZA, como las geocercas: el martes a las 02:00 es la noche del lunes.
 */
function enHorario(sv, fecha, zona) {
    const dias = (Array.isArray(sv && sv.dias) ? sv.dias : []).map(String).map((d) => DIAS.indexOf(d)).filter((d) => d >= 0);
    if (!dias.length) return false;
    const { dia, minuto } = relojDe(fecha || new Date(), zona);
    const d0 = minutos(sv.desde), h0 = minutos(sv.hasta);
    if (d0 == null && h0 == null) return dias.includes(dia);
    const desde = Math.max(0, (d0 ?? 0) - MARGEN_MIN), hasta = Math.min(24 * 60, (h0 ?? 24 * 60) + MARGEN_MIN);
    if ((d0 ?? 0) <= (h0 ?? 24 * 60)) return dias.includes(dia) && minuto >= desde && minuto <= hasta;
    // Cruza la medianoche.
    if (minuto >= (d0 - MARGEN_MIN)) return dias.includes(dia);
    if (minuto <= (h0 + MARGEN_MIN)) return dias.includes((dia + 6) % 7);
    return false;
}

const ROTULO = { JARDINERO: "Jardinero", PISCINERO: "Piscinero", LIMPIEZA: "Limpieza", OTRO: "Servicio" };
function cuandoViene(sv) {
    const orden = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
    const d = orden.filter((x) => (sv.dias || []).includes(x));
    const dias = d.length === 7 ? "todos los días" : d.join(", ");
    return [dias, sv.desde || sv.hasta ? `${sv.desde || "?"} a ${sv.hasta || "?"}` : ""].filter(Boolean).join(" · ");
}

/**
 * El proveedor habilitado que viene con esa matrícula, y si está en su horario. null si la chapa
 * no es de ningún servicio con la entrada habilitada. Si dos lotes tienen al mismo proveedor (el
 * mismo jardinero en tres casas), entra si está en horario para alguno, y se nombra ése.
 */
async function proveedorPorChapa(prisma, plate, fecha) {
    const chapa = limpia(plate);
    if (chapa.length < 5) return null;
    const filas = await prisma.servicioLote.findMany({
        where: { chapa, estado: "ACTIVO", autorizado: true },
        select: { id: true, tipo: true, nombre: true, dias: true, desde: true, hasta: true, unitId: true, unit: { select: { name: true } } },
        take: 10,
    });
    if (!filas.length) return null;
    const ahora = fecha || new Date();
    const enHora = filas.find((f) => enHorario(f, ahora));
    const f = enHora || filas[0];
    const quien = `${ROTULO[f.tipo] || "Servicio"}${f.nombre ? ` ${f.nombre}` : ""}`;
    const lotes = [...new Set(filas.map((x) => x.unit && x.unit.name).filter(Boolean))];
    return {
        servicioId: f.id, unitId: f.unitId, lote: f.unit ? f.unit.name : null, lotes, quien,
        cuando: cuandoViene(f), enHorario: !!enHora,
        detalle: enHora
            ? `Proveedor habilitado: ${quien} del lote ${f.unit ? f.unit.name : "?"} (${cuandoViene(f)}). `
            : `Proveedor del lote ${f.unit ? f.unit.name : "?"} FUERA DE SU HORARIO: ${quien} (${cuandoViene(f)}). `,
    };
}

module.exports = { enHorario, proveedorPorChapa, cuandoViene, MARGEN_MIN, DIAS };
