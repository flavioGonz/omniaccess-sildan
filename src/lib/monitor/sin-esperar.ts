/**
 * Lo lento de la pared (leer los canales de cada grabador, las líneas de cada cámara) sin que la
 * pantalla lo espere.
 *
 * Medido el 30/10 en el lab: la primera carga de /api/monitor/camaras tardaba 36,5 s y las
 * siguientes 0,03 s. Con Server-Timing se vio que no eran los grabadores (63 ms) sino las líneas y
 * zonas de intrusión de cada cámara, leídas por ISAPI de a seis, con reintentos. Mientras tanto la
 * pared mostraba sólo una rueda girando.
 *
 * Ahora: si hay un valor anterior se devuelve al instante y, si está viejo, se renueva de fondo.
 * Sólo cuando no hay ninguno (el primer pedido después de reiniciar) se espera, y como mucho
 * `esperaMaxMs`. Si no llegó, se responde con lo que hay, marcado incompleto, y el cliente vuelve a
 * pedir enseguida. Además, un grabador caído no se vuelve a consultar en cada vuelta: su error
 * también queda guardado hasta que venza.
 */

type Entrada<T> = { valor: T | undefined; t: number; enCurso: Promise<T> | null };
const memo = new Map<string, Entrada<unknown>>();

/** Lo último que se calculó para esta clave (para quedarse con lo bueno si la renovación falla). */
export function ultimoDe<T>(clave: string): T | undefined {
    return memo.get(clave)?.valor as T | undefined;
}

export async function sinEsperar<T>(clave: string, vigenteMs: number, esperaMaxMs: number, calcular: () => Promise<T>, porDefecto: T): Promise<{ valor: T; completo: boolean }> {
    let e = memo.get(clave) as Entrada<T> | undefined;
    if (!e) { e = { valor: undefined, t: 0, enCurso: null }; memo.set(clave, e); }
    const entrada = e;
    const renovar = () => {
        if (entrada.enCurso) return entrada.enCurso;
        entrada.enCurso = calcular()
            .then((v) => { entrada.valor = v; entrada.t = Date.now(); return v; })
            .finally(() => { entrada.enCurso = null; });
        // Nadie más espera esta promesa cuando hay valor viejo: el error no puede quedar suelto.
        entrada.enCurso.catch(() => {});
        return entrada.enCurso;
    };
    if (entrada.valor !== undefined) {
        if (Date.now() - entrada.t > vigenteMs) void renovar();
        return { valor: entrada.valor, completo: true };
    }
    // Si ya hay una lectura en curso, el que espera es el primer pedido: los siguientes (la misma
    // pared que repregunta, u otra pantalla) responden al instante con lo que hay. Medido: las
    // líneas de las cámaras tardan más de 30 s en el primer arranque, y cada vuelta esperaba 1,5 s.
    const espera = entrada.enCurso ? 0 : esperaMaxMs;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const tope = new Promise<null>((r) => { reloj = setTimeout(() => r(null), espera); });
    try {
        const v = await Promise.race([renovar(), tope]);
        return v === null ? { valor: porDefecto, completo: false } : { valor: v as T, completo: true };
    } catch {
        return { valor: porDefecto, completo: false };
    } finally { clearTimeout(reloj); }
}
