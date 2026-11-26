/**
 * Cómo es el vehículo de una chapa según OmniVision, aprendido de sus propias lecturas (26/11).
 *
 * Nico: «¿con qué datos podés enriquecer nuestro LPR? Podemos hacer más que las cámaras
 * Hikvision». La idea era avisar «la chapa no corresponde al vehículo» comparando contra el
 * padrón, y se midió antes (lab, 30 días): el padrón tiene color en 18 de 442 vehículos, marca en
 * 17, y el tipo es SEDAN por defecto. Contra el padrón no hay con qué comparar.
 *
 * Contra la HISTORIA de la chapa sí: cada lectura LPR pasa por OmniVision (AnalisisFoto: siluetas
 * con color y carrocería). Con cinco lecturas o más, el color agrupado coincide con la mayoría en
 * el 84,6 % y la carrocería agrupada en el 96,7 %. De ahí sale el perfil («blanco · sedán, 18 de
 * 20 veces») y la señal de que una lectura no se parece.
 *
 * Lo que costó medir: en el 39 % de las fotos hay más de un vehículo. Elegir el más grande daba
 * 295 lecturas «distintas» en 30 días y 286 eran fotos con varios autos: se comparaba otro auto.
 * Con el recuadro de la chapa (PlateRect, 0-1000 desde arriba a la izquierda: cae dentro de un
 * vehículo en el 99,6 %) mejora, pero con varios autos en la foto la señal sigue sin ser
 * confiable. Por eso la señal sólo se da con UN vehículo en la foto: 9 en 30 días.
 *
 * Puro: lo usan /api/history/ficha y las pruebas.
 */

export type Atributo = { id: string; valor: string; prob?: number; dudoso?: boolean };
export type ObjetoVisto = { grupo?: string; caja?: number[]; atributos?: Atributo[] };
export type Observacion = { color: string | null; carroceria: string | null; pColor: number; pCarroceria: number; vehiculos: number };
export type Rasgo = { valor: string; veces: number; de: number };
export type PerfilVision = { lecturas: number; color: Rasgo | null; carroceria: Rasgo | null; fuerte: boolean };

/** Lecturas con análisis hacen falta para hablar de «cómo es». Con menos, una foto mala manda. */
export const LECTURAS_MIN = 5;
/** Qué tan clara tiene que ser la mayoría (agrupada) para que una lectura distinta llame la atención. */
export const MAYORIA_MIN = 0.7;
/** Confianza mínima del atributo en la lectura que se compara. */
export const PROB_MIN = 0.6;

/** Los colores que OmniVision confunde entre sí de noche o al sol: blanco/plateado/gris. */
const GRUPO_COLOR: Record<string, string> = { blanco: "claro", plateado: "gris", gris: "gris", negro: "negro" };
/** Las carrocerías que se confunden entre sí: sedán/hatchback/SUV son «un auto». */
const GRUPO_CARROCERIA: Record<string, string> = { "sedán": "auto", sedan: "auto", hatchback: "auto", SUV: "auto", suv: "auto" };
export const grupoColor = (c: string) => GRUPO_COLOR[c] || c;
export const grupoCarroceria = (b: string) => GRUPO_CARROCERIA[b] || b;

const area = (c: number[]) => Math.max(0, c[2] - c[0]) * Math.max(0, c[3] - c[1]);

/** El recuadro de la chapa escrito por el webhook ANPR: «PlateRect: x/y/w/h» en 0-1000. */
export function rectDeDetalles(details: string | null | undefined): { cx: number; cy: number } | null {
    const m = String(details || "").match(/PlateRect:\s*(\d+)\/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return null;
    const [x, y, w, h] = m.slice(1).map(Number);
    return { cx: (x + w / 2) / 1000, cy: (y + h / 2) / 1000 };
}

/**
 * El vehículo de la chapa entre los de la foto: el que la contiene en su mitad de abajo (la chapa
 * va abajo de su vehículo) y, entre esos, el más grande (el de adelante). Sin recuadro, sólo si
 * hay un único vehículo.
 */
export function vehiculoDeLaChapa(objetos: ObjetoVisto[], chapa: { cx: number; cy: number } | null): ObjetoVisto | null {
    const vs = objetos.filter((o) => o.grupo === "vehiculo" && Array.isArray(o.caja) && o.caja.length === 4);
    if (!vs.length) return null;
    if (chapa) {
        const c = vs.filter((o) => { const k = o.caja!; return chapa.cx >= k[0] && chapa.cx <= k[2] && chapa.cy >= k[1] + 0.4 * (k[3] - k[1]) && chapa.cy <= k[3]; });
        if (c.length) return c.sort((a, b) => area(b.caja!) - area(a.caja!))[0];
    }
    return vs.length === 1 ? vs[0] : null;
}

export function observacion(objetos: ObjetoVisto[], chapa: { cx: number; cy: number } | null): Observacion | null {
    const o = vehiculoDeLaChapa(objetos, chapa);
    if (!o) return null;
    const at = (id: string) => (o.atributos || []).find((a) => a.id === id && !a.dudoso && a.valor);
    const c = at("color"), b = at("carroceria");
    if (!c && !b) return null;
    return { color: c?.valor || null, carroceria: b?.valor || null, pColor: c?.prob ?? 0, pCarroceria: b?.prob ?? 0, vehiculos: objetos.filter((x) => x.grupo === "vehiculo").length };
}

function mayoria(valores: string[], grupo: (v: string) => string): { rasgo: Rasgo; fraccionGrupo: number } | null {
    if (!valores.length) return null;
    const cuenta = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const [valor, veces] = cuenta(valores)[0];
    const [, vecesGrupo] = cuenta(valores.map(grupo))[0];
    return { rasgo: { valor, veces, de: valores.length }, fraccionGrupo: vecesGrupo / valores.length };
}

export function perfilDe(obs: Observacion[]): PerfilVision {
    const mc = mayoria(obs.map((o) => o.color).filter((x): x is string => !!x), grupoColor);
    const mb = mayoria(obs.map((o) => o.carroceria).filter((x): x is string => !!x), grupoCarroceria);
    const fuerte = obs.length >= LECTURAS_MIN && !!mc && !!mb && mc.fraccionGrupo >= MAYORIA_MIN && mb.fraccionGrupo >= MAYORIA_MIN;
    return { lecturas: obs.length, color: mc?.rasgo || null, carroceria: mb?.rasgo || null, fuerte };
}

/**
 * ¿Esta lectura no se parece a cómo se ve siempre esa chapa? Color Y carrocería distintos (en sus
 * grupos), con confianza, con un perfil claro y con un solo vehículo en la foto. Puede ser una chapa
 * puesta en otro vehículo o una mala lectura: lo decide una persona mirando la foto.
 */
export function noSeParece(o: Observacion | null, p: PerfilVision): { color: string; carroceria: string } | null {
    if (!o || !p.fuerte || !p.color || !p.carroceria || o.vehiculos !== 1) return null;
    if (!o.color || !o.carroceria || o.pColor < PROB_MIN || o.pCarroceria < PROB_MIN) return null;
    if (grupoColor(o.color) === grupoColor(p.color.valor) || grupoCarroceria(o.carroceria) === grupoCarroceria(p.carroceria.valor)) return null;
    return { color: o.color, carroceria: o.carroceria };
}
