import test from "node:test";
import assert from "node:assert/strict";
import { clasificar, convieneProbarClave, fabricantePorMac, fabricantePorObjectId, nombrePropuesto, normalizarMac } from "@/lib/descubrir-inteligente";
import { armarGet, leerRespuesta, OID } from "@/lib/snmp-mini";
import { OUI_POR_MARCA } from "@/lib/oui-tabla";

const prefijo = (marca: string) => OUI_POR_MARCA[marca].slice(0, 6);
const mac = (marca: string) => `${prefijo(marca).match(/../g)!.join(":")}:12:34:56`;

test("descubrir: la MAC dice el fabricante, en cualquier formato; una MAC inventada no es de nadie", () => {
    assert.equal(normalizarMac("aa-bb-cc-dd-ee-ff"), "AABBCCDDEEFF");
    assert.equal(normalizarMac("0000.0000.0000"), null);
    assert.equal(fabricantePorMac(mac("HIKVISION")), "HIKVISION");
    assert.equal(fabricantePorMac(mac("MIKROTIK").replace(/:/g, "-")), "MIKROTIK");
    assert.equal(fabricantePorMac("02:00:00:12:34:56"), null, "bit de MAC local prendido");
    assert.equal(fabricantePorMac(null), null);
});
test("descubrir: el sysObjectID de SNMP dice el fabricante por su número de empresa", () => {
    assert.equal(fabricantePorObjectId("1.3.6.1.4.1.14988.1"), "MIKROTIK");
    assert.equal(fabricantePorObjectId(".1.3.6.1.4.1.39165.1.1"), "HIKVISION");
    assert.equal(fabricantePorObjectId("1.3.6.1.2.1.1"), null);
});
test("descubrir: lo que el equipo dice de sí mismo manda sobre las pistas flojas", () => {
    const nvr = clasificar({ puertos: [80, 554, 8000], habla: ["ISAPI"], reino: "IP Camera(GB828)", ficha: { protocolo: "ISAPI", clase: "NVR", modelo: "DS-7616NI-K2" } });
    assert.equal(nvr.categoria, "nvr"); assert.equal(nvr.confianza, "alta"); assert.equal(nvr.marca, "HIKVISION"); assert.equal(nvr.tipo, "NVR");
    assert.equal(clasificar({ puertos: [80], ficha: { protocolo: "ISAPI", modelo: "DS-K1T341AMF" } }).categoria, "terminal-facial");
    assert.equal(clasificar({ puertos: [80], ficha: { protocolo: "ISAPI", modelo: "DS-KV6113-WPE1" } }).categoria, "portero");
    assert.equal(clasificar({ puertos: [80], ficha: { protocolo: "ISAPI", modelo: "DS-K2604T" } }).categoria, "control-acceso");
    assert.equal(clasificar({ puertos: [80], ficha: { protocolo: "ISAPI", modelo: "iDS-TCM403-BI" } }).categoria, "camara-lpr");
    assert.equal(clasificar({ puertos: [80], ficha: { protocolo: "DAHUA", modelo: "DHI-NVR4208-8P" } }).categoria, "nvr");
    assert.equal(clasificar({ puertos: [80], ficha: { protocolo: "DAHUA", modelo: "VTO2202F-P" } }).categoria, "portero");
});
test("descubrir: una cámara que dice tener ANPR es LPR aunque el modelo no lo diga", () => {
    const c = clasificar({ puertos: [80, 554], ficha: { protocolo: "ISAPI", clase: "IPCamera", modelo: "iDS-2CD7A46G0/P-IZHS" }, anpr: true });
    assert.equal(c.categoria, "camara-lpr"); assert.equal(c.tipo, "LPR_CAMERA");
});
test("descubrir: SNMP y la MAC separan la red de lo que es de OmniAccess", () => {
    assert.equal(clasificar({ puertos: [22, 80, 8291], snmp: { descr: "RouterOS RB4011iGS+" } }).categoria, "router");
    assert.equal(clasificar({ puertos: [22, 443], snmp: { descr: "USW-24-PoE, 6.6.55", objectId: "1.3.6.1.4.1.41112.1.6" } }).categoria, "switch");
    const mk = clasificar({ puertos: [22, 80], mac: mac("MIKROTIK") });
    assert.equal(mk.categoria, "router"); assert.equal(mk.tipo, null, "un router no se da de alta en OmniAccess");
    assert.equal(clasificar({ puertos: [80, 554], mac: mac("AKUVOX") }).categoria, "portero");
    assert.equal(clasificar({ puertos: [22, 8006], mac: "BC:24:11:aa:bb:cc" }).categoria, "computadora", "una máquina virtual de Proxmox");
});
test("descubrir: con pocas pistas se dice poco, y sin pistas «no se sabe»", () => {
    const c = clasificar({ puertos: [554] });
    assert.equal(c.categoria, "camara"); assert.equal(c.confianza, "baja");
    assert.equal(clasificar({ puertos: [] }).categoria, "otro");
    assert.equal(clasificar({ puertos: [80], reino: "Embedded Net DVR" }).categoria, "nvr");
});
test("descubrir: la clave se prueba sólo con quien habla un protocolo que sabemos leer", () => {
    assert.ok(convieneProbarClave({ puertos: [80], habla: ["ISAPI"] }));
    assert.ok(convieneProbarClave({ puertos: [80], mac: mac("DAHUA") }));
    assert.ok(!convieneProbarClave({ puertos: [80, 22] }));
});
test("descubrir: el nombre propuesto usa el del equipo salvo que sea de fábrica", () => {
    const c = clasificar({ puertos: [554] });
    assert.equal(nombrePropuesto(c, "192.168.1.45", "Portón norte"), "Portón norte");
    assert.equal(nombrePropuesto(c, "192.168.1.45", "IP CAMERA"), "Cámara 45");
});
test("snmp: el GetRequest se arma bien y una respuesta se lee", () => {
    const req = armarGet("public", [OID.sysDescr], 7);
    assert.equal(req[0], 0x30);
    assert.ok(req.includes(Buffer.from("public")));
    // Una respuesta armada a mano (BER): versión, comunidad, GetResponse con sysDescr y sysObjectID.
    const tlv = (tag: number, c: number[]) => [tag, c.length, ...c];
    const oidDescr = [0x2b, 6, 1, 2, 1, 1, 1, 0], oidObj = [0x2b, 6, 1, 2, 1, 1, 2, 0];
    const valorObj = [0x2b, 6, 1, 4, 1, 0xf5, 0x0c, 1]; // 1.3.6.1.4.1.14988.1 (14988 = 0xF5 0x0C en base 128)
    const vb = [...tlv(0x30, [...tlv(0x06, oidDescr), ...tlv(0x04, [...Buffer.from("RouterOS RB4011")])]), ...tlv(0x30, [...tlv(0x06, oidObj), ...tlv(0x06, valorObj)])];
    const pdu = tlv(0xa2, [...tlv(0x02, [7]), ...tlv(0x02, [0]), ...tlv(0x02, [0]), ...tlv(0x30, vb)]);
    const r = leerRespuesta(Buffer.from(tlv(0x30, [...tlv(0x02, [1]), ...tlv(0x04, [...Buffer.from("public")]), ...pdu])));
    assert.equal(r.requestId, 7);
    assert.equal(r.valores[OID.sysDescr], "RouterOS RB4011");
    assert.equal(r.valores[OID.sysObjectID], "1.3.6.1.4.1.14988.1");
    assert.equal(fabricantePorObjectId(r.valores[OID.sysObjectID]), "MIKROTIK");
});
