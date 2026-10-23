/** Con qué cámaras se verifica un evento de central: zona → área → abonado (lib-centrales-camaras.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cc = require("../lib-centrales-camaras.js");

test("la zona con cámaras elegidas usa las suyas, hasta 4", () => {
    const r = cc.elegir({ zona: ["a", "b", "c", "d", "e"], area: ["x"], abonado: ["y"] });
    assert.deepEqual(r, { ids: ["a", "b", "c", "d"], origen: "zona", area: null });
});

test("sin elegidas, las del área (con su nombre)", () => {
    const r = cc.elegir({ zona: [], area: ["x1", "x2"], abonado: ["y"], areaNombre: "Perímetro norte" });
    assert.deepEqual(r, { ids: ["x1", "x2"], origen: "area", area: "Perímetro norte" });
});

test("sin elegidas ni área, las del abonado", () => {
    assert.deepEqual(cc.elegir({ zona: [], area: [], abonado: ["y1", "y1", " ", "y2"] }), { ids: ["y1", "y2"], origen: "abonado", area: null });
});

test("sin nada, ninguna", () => {
    assert.deepEqual(cc.elegir({}), { ids: [], origen: "ninguna", area: null });
});

test("canal de NVR: nvrch-<nvr>-<ch>, y su stream", () => {
    assert.deepEqual(cc.canalDe("nvrch-cmabc123-5"), { nvrId: "cmabc123", ch: 5 });
    assert.equal(cc.canalDe("cmdevice1"), null);
    assert.equal(cc.streamDe("nvrch-cmabc123-5"), "lpr_nvrch-cmabc123-5");
});

test("sub-áreas: el área incluye las que cuelgan de ella", () => {
    const areas = [{ id: "a", padre: null }, { id: "b", padre: "a" }, { id: "c", padre: "b" }, { id: "d", padre: null }];
    assert.deepEqual([...cc.conSubareas(areas, "a")].sort(), ["a", "b", "c"]);
});

test("cámaras de una zona con la base: elegidas, área y abonado", async () => {
    const base = {
        centralAlarma: { findUnique: async () => ({ camaras: ["ab1"], deviceId: "dev" }) },
        zonaCentral: { findUnique: async ({ where }: any) => (where.centralId_zona.zona === 3 ? { camaras: [], areaId: "per" } : { camaras: ["z1"], areaId: null }) },
        setting: { findUnique: async () => ({ value: JSON.stringify({ areas: [{ id: "per", nombre: "Perímetro norte", padre: null }], equipos: { cam1: "per", cam2: "per", nvr9: "per" } }) }) },
        device: { findMany: async ({ where }: any) => [{ id: "cam1", name: "A" }, { id: "cam2", name: "B" }].filter((d) => where.id.in.includes(d.id)) },
    };
    assert.deepEqual(await cc.camarasDeZona(base, "c", 3), { ids: ["cam1", "cam2"], origen: "area", area: "Perímetro norte", abonado: ["ab1"] });
    assert.deepEqual(await cc.camarasDeZona(base, "c", 7), { ids: ["z1"], origen: "zona", area: null, abonado: ["ab1"] });
    assert.deepEqual(await cc.camarasDeZona(base, "c", null), { ids: ["ab1"], origen: "abonado", area: null, abonado: ["ab1"] });
});
