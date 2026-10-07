/**
 * La lista negra para los procesos CommonJS (server.js, waha-handler.js).
 *
 * Es el espejo de src/lib/lista-negra.ts: LA MISMA consulta SQL, textual, para que la barrera
 * (server.js) y la aplicación (Next) contesten lo mismo ante la misma matrícula. Si se toca la
 * consulta de un lado hay que tocarla del otro; tasks del cambio lista-negra-unificada lo
 * verifican con tres matrículas.
 *
 * Recibe el prisma del proceso que lo llama en vez de crear otro cliente: server.js ya tiene
 * uno con su pool, y un segundo PrismaClient por librería es como se agotan las conexiones.
 */

const normalizarMatricula = (p) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const CATEGORIAS = { NEGRA: "BLACKLISTED", BLACKLIST: "BLACKLISTED", BLACKLISTED: "BLACKLISTED", VIP: "WHITELISTED", WHITELIST: "WHITELISTED", WHITELISTED: "WHITELISTED", BUSCA: "SEARCH", SEARCH: "SEARCH" };
const normalizarCategoria = (x) => CATEGORIAS[String(x || "").trim().toUpperCase()] || null;

const CONSULTA_VIGILANCIA = `
SELECT * FROM (
  SELECT 1 AS prio, w.plate, w.category, w.label, w.motivo, w.color, w.notify, w."userId",
         u.name AS "userName", CASE WHEN w."userId" IS NULL THEN 'manual' ELSE 'persona' END AS origen
    FROM "PlateWatch" w LEFT JOIN "User" u ON u.id = w."userId"
   WHERE w.active = true AND upper(regexp_replace(w.plate, '[^A-Za-z0-9]', '', 'g')) = $1
  UNION ALL
  SELECT 2 AS prio, c.value AS plate, 'BLACKLISTED' AS category, u.name AS label, NULL AS motivo,
         NULL AS color, true AS notify, u.id AS "userId", u.name AS "userName", 'rol' AS origen
    FROM "Credential" c JOIN "User" u ON u.id = c."userId"
   WHERE c.type = 'PLATE' AND u.role = 'BLACKLISTED'
     AND upper(regexp_replace(c.value, '[^A-Za-z0-9]', '', 'g')) = $1
) v ORDER BY prio LIMIT 1`;

async function vigilanciaDe(prisma, plate) {
    const p = normalizarMatricula(plate);
    if (!p) return null;
    const filas = await prisma.$queryRawUnsafe(CONSULTA_VIGILANCIA, p);
    const f = filas && filas[0];
    if (!f) return null;
    const category = normalizarCategoria(f.category);
    if (!category) return null;
    return {
        plate: p, category, label: f.label || "", motivo: f.motivo == null ? null : f.motivo, color: f.color == null ? null : f.color,
        notify: f.notify !== false, origen: f.origen, userId: f.userId == null ? null : f.userId, userName: f.userName == null ? null : f.userName,
        // Lo que el monitor y el socket esperan de un "watch" (misma forma que getWatchMap).
        source: f.origen === "rol" ? "role" : "manual",
    };
}

async function estaEnListaNegra(prisma, plate) {
    try {
        const w = await vigilanciaDe(prisma, plate);
        if (!w || w.category !== "BLACKLISTED") return { negra: false, motivo: null, origen: null, watch: w };
        const motivo = w.motivo || (w.origen === "rol" ? `usuario en lista negra${w.userName ? ` (${w.userName})` : ""}` : w.label || null);
        return { negra: true, motivo, origen: w.origen, watch: w };
    } catch (e) {
        console.error("[lista-negra] no se pudo consultar:", (e && e.message) || e);
        return { negra: false, motivo: null, origen: null, watch: null };
    }
}

const detalleListaNegra = (motivo) => `Lista negra: ${motivo || "sin motivo cargado"}`;

module.exports = { CONSULTA_VIGILANCIA, normalizarMatricula, normalizarCategoria, vigilanciaDe, estaEnListaNegra, detalleListaNegra };
