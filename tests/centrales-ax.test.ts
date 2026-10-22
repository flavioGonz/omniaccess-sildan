/**
 * El driver de la AX PRO contra una central simulada con respuestas con la forma de las reales
 * (openspec alarm-hub-sia-dc09, tarea 4.2). La sesión, el armado y el estado siguen lo que usa la
 * integración de Home Assistant (hikaxpro) con equipos reales; el centro receptor es la parte que
 * sigue sin una respuesta real y por eso el driver lo lee antes de escribir.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { leerCap, passwordSesion, olvidarSesiones } from "@/lib/centrales/isapi-ax";
import { axPro } from "@/lib/centrales/hikvision-ax";

const EQUIPO = { id: "ax1", name: "AX de prueba", ip: "10.9.9.9", httpPort: 80, username: "admin", password: "Clave123", authType: "DIGEST" };
const DESTINO = { direccion: "alarmas.ies.com.uy", puerto: 10010, cuenta: "1234", clave: "00112233445566778899AABBCCDDEEFF", protocolo: "SIA-DCS" as const, supervisionSeg: 600, transporte: "udp" as const };

test("clave de sesión: los tres algoritmos de la AX (contra SHA-256 de Python)", () => {
    const base = { sessionID: "S", challenge: "CHALL", salt: "SALTX", salt2: "SALT2Y", iterations: 100 };
    assert.equal(passwordSesion("admin", "Clave123", { ...base, isIrreversible: true, sessionIDVersion: "2" }), "e0b024c0e2b28768397711a07cf9a84af760bf694293e452acfbe6ce7466945c");
    assert.equal(passwordSesion("admin", "Clave123", { ...base, isIrreversible: true, sessionIDVersion: "2.1" }), "b7dcf64b517b6b638a61954088475254d3e4191552a7b8f04eae1761d48d693b");
    assert.equal(passwordSesion("admin", "Clave123", { ...base, isIrreversible: false, sessionIDVersion: null }), "98de8da00d952bf651140a275b96146c1ad5e822e8b69e35441a6a8778b2ea03");
});

test("capacidades de sesión: se leen del XML", () => {
    const c = leerCap(`<?xml version="1.0"?><SessionLoginCap xmlns="http://www.hikvision.com/ver20/XMLSchema"><sessionID>abc</sessionID><challenge>ch</challenge><iterations>100</iterations><isIrreversible>true</isIrreversible><salt>s1</salt><salt2>s2</salt2><sessionIDVersion>2</sessionIDVersion></SessionLoginCap>`);
    assert.deepEqual(c, { sessionID: "abc", challenge: "ch", salt: "s1", salt2: "s2", isIrreversible: true, iterations: 100, sessionIDVersion: "2" });
});

// ── Una AX simulada ─────────────────────────────────────────────────────────────────────────
type Pedido = { metodo: string; ruta: string; cuerpo: any; cookie: string | null };
let pedidos: Pedido[] = [];
let centro: Record<string, any>;
let sesionesEmitidas = 0;
const CAP = `<SessionLoginCap><sessionID>sid1</sessionID><challenge>CHALL</challenge><iterations>100</iterations><isIrreversible>true</isIrreversible><salt>SALTX</salt><salt2>SALT2Y</salt2><sessionIDVersion>2</sessionIDVersion></SessionLoginCap>`;
const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
    olvidarSesiones(); pedidos = []; sesionesEmitidas = 0;
    centro = { id: 1, enabled: false, addressType: "ipaddress", ipAddress: "", port: 7200, protocolType: "ADM-CID", accountCode: "", transmissionProtocol: "TCP", encryptionKey: "", pollingRate: 60 };
    (globalThis as any).fetch = async (url: string, init: any = {}) => {
        const u = new URL(url); const ruta = u.pathname + u.search; const metodo = init.method || "GET";
        const cookie = init.headers?.Cookie || null;
        pedidos.push({ metodo, ruta, cuerpo: init.body ? (String(init.body).startsWith("{") ? JSON.parse(init.body) : init.body) : null, cookie });
        if (u.pathname === "/ISAPI/Security/sessionLogin/capabilities") return new Response(CAP, { status: 200 });
        if (u.pathname === "/ISAPI/Security/sessionLogin") {
            const ok = String(init.body).includes(passwordSesion("admin", "Clave123", leerCap(CAP)));
            if (!ok) return new Response("<ResponseStatus><statusCode>4</statusCode></ResponseStatus>", { status: 401 });
            sesionesEmitidas++;
            return new Response("<SessionLogin/>", { status: 200, headers: { "set-cookie": `WebSession=w${sesionesEmitidas}; path=/` } });
        }
        if (cookie !== `WebSession=w${sesionesEmitidas}`) return json({ statusCode: 4, subStatusCode: "notLogin" }, 401);
        if (u.pathname === "/ISAPI/SecurityCP/ReportCenterCfg" ) return json({ ReportCenterCfgList: [{ ReportCenterCfg: { id: 1 } }] });
        if (u.pathname === "/ISAPI/SecurityCP/ReportCenterCfg/1" && metodo === "GET") return json({ ReportCenterCfg: centro });
        if (u.pathname === "/ISAPI/SecurityCP/ReportCenterCfg/1" && metodo === "PUT") { centro = JSON.parse(init.body).ReportCenterCfg; return json({ statusCode: 1, statusString: "OK" }); }
        if (u.pathname === "/ISAPI/SecurityCP/status/subSystems") return json({ SubSysList: [{ SubSys: { id: 1, arming: "disarm", alarm: false, enabled: true, name: "Casa" } }, { SubSys: { id: 2, arming: "stay", alarm: true, enabled: true, name: "Galpón" } }] });
        if (u.pathname === "/ISAPI/SecurityCP/status/zones") return json({ ZoneList: [{ Zone: { id: 3, name: "Puerta cocina", status: "online", sensorStatus: "normal", alarm: false, bypassed: false, subSystemNo: 1, zoneType: "Delay" } }, { Zone: { id: 7, name: "PIR living", alarm: true, linkageSubSystem: [2], zoneType: "Instant" } }] });
        if (u.pathname.startsWith("/ISAPI/SecurityCP/control/")) return json({ statusCode: 1, statusString: "OK" });
        return json({ statusCode: 4, subStatusCode: "notSupport" }, 404);
    };
});

test("estado: particiones y zonas, con sesión y X-Userlevel de administrador", async () => {
    const e = await axPro.estado!(EQUIPO);
    assert.deepEqual(e.particiones.map((p) => [p.id, p.estado]), [[1, "desarmada"], [2, "alarma"]]);
    assert.deepEqual(e.zonas.map((z) => [z.zona, z.nombre, z.particion, z.estado]), [[3, "Puerta cocina", 1, "normal"], [7, "PIR living", 2, "alarma"]]);
    assert.equal(sesionesEmitidas, 1, "una sola sesión para todos los pedidos");
    assert.ok(pedidos.filter((p) => p.ruta.startsWith("/ISAPI/SecurityCP")).every((p) => p.ruta.includes("format=json")));
});

test("armar ausente / presente y desarmar: las rutas de la AX", async () => {
    assert.deepEqual(await axPro.armar!(EQUIPO, 1, "ausente"), { ok: true });
    assert.deepEqual(await axPro.armar!(EQUIPO, 2, "presente"), { ok: true });
    assert.deepEqual(await axPro.desarmar!(EQUIPO, 1), { ok: true });
    const control = pedidos.filter((p) => p.ruta.includes("/control/")).map((p) => `${p.metodo} ${p.ruta}`);
    assert.deepEqual(control, ["PUT /ISAPI/SecurityCP/control/arm/1?ways=away&format=json", "PUT /ISAPI/SecurityCP/control/arm/2?ways=stay&format=json", "PUT /ISAPI/SecurityCP/control/disarm/1?format=json"]);
});

test("sesión vencida: se abre otra y se repite el pedido una vez", async () => {
    await axPro.estado!(EQUIPO);
    sesionesEmitidas++; // la central «olvida» la sesión: la cookie vieja deja de valer
    const e = await axPro.estado!(EQUIPO);
    assert.equal(e.particiones.length, 2);
});

test("vincular: probar no escribe; vincular cambia sólo los campos que la central tiene", async () => {
    const p = await axPro.vincular!(EQUIPO, DESTINO, true);
    assert.ok(p.ok);
    assert.ok(!pedidos.some((x) => x.metodo === "PUT"), "probar no escribe nada");
    assert.equal((p as any).actual.encryptionKey, "••••", "la clave no viaja a la pantalla");
    const r = await axPro.vincular!(EQUIPO, DESTINO);
    assert.ok(r.ok, (r as any).error);
    assert.equal(centro.enabled, true); assert.equal(centro.addressType, "domain");
    assert.equal(centro.port, 10010); assert.equal(centro.protocolType, "*SIA-DCS"); assert.equal(centro.accountCode, "1234");
    assert.equal(centro.transmissionProtocol, "UDP"); assert.equal(centro.encryptionKey, DESTINO.clave); assert.equal(centro.pollingRate, 600);
    assert.equal(centro.domain, "alarmas.ies.com.uy", "el dominio va en su campo"); assert.equal(centro.ipAddress, "", "la IP no se toca");
});

test("vincular: si falta un campo con los nombres esperados, no se escribe y se dice cuál", async () => {
    delete centro.accountCode;
    const r = await axPro.vincular!(EQUIPO, DESTINO);
    assert.ok(!r.ok); assert.match((r as any).error, /cuenta/);
    assert.ok(!pedidos.some((x) => x.metodo === "PUT"));
});

test("clave equivocada: la central no deja entrar y el error lo dice", async () => {
    const r = await axPro.armar!({ ...EQUIPO, password: "otra" }, 1, "ausente");
    assert.ok(!r.ok); assert.match((r as any).error, /Administrador/);
});
