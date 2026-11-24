import test from "node:test";
import assert from "node:assert/strict";
import { coordenadasDeTexto, latLngAPlano, leerPlanoLotes, planoALatLng, type Georef } from "@/lib/plano-lotes";

/* La calibración de San Nicolás (25/11): escala libre que dio 1,0028 y giro de 6,66°. */
const G: Georef = {
    s: 1.0027570023064731, R: [[0.9932578435321127, -0.1159260810255277], [0.11592608102552773, 0.9932578435321128]], t: [507.3969015463591, -265.77659932661663],
    lat0: -34.856, lon0: -56.074, KX: 91348.1912868114, KY: 110574, S: 25.4 / 150,
};

test("plano: ida y vuelta entre el croquis y la Tierra sin perder nada", () => {
    for (const [x, y] of [[2394, 4076], [0, 0], [5374, 7654], [3100.5, 1888.25]]) {
        const p = planoALatLng(x, y, G), q = latLngAPlano(p.lat, p.lng, G);
        assert.ok(Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6, `${x},${y} → ${q.x},${q.y}`);
    }
});
test("plano: cae en San Nicolás, y un píxel son 17 cm", () => {
    const a = planoALatLng(2394, 4076, G);
    assert.ok(a.lat < -34.84 && a.lat > -34.88 && a.lng < -56.05 && a.lng > -56.10, JSON.stringify(a));
    const b = planoALatLng(2394 + 1000, 4076, G);            // mil píxeles a la derecha
    const m = Math.hypot((b.lat - a.lat) * G.KY, (b.lng - a.lng) * G.KX);
    assert.ok(Math.abs(m - 169.3 / G.s) < 0.5, `${m} m`);
    // A la derecha en el croquis no es exactamente al este: el croquis está girado 6,66°.
    const rumbo = (Math.atan2((b.lat - a.lat) * G.KY, (b.lng - a.lng) * G.KX) * 180) / Math.PI;
    assert.ok(Math.abs(Math.abs(rumbo) - 6.66) < 0.05, `${rumbo}°`);
});
test("plano: la Setting se lee entera o no se lee", () => {
    const bueno = { titulo: "Croquis comercial unificado", archivo: "plano-lotes.jpg", ancho: 5374, alto: 7654, georef: G };
    assert.deepEqual(leerPlanoLotes(JSON.stringify(bueno))?.georef, G);
    assert.equal(leerPlanoLotes(JSON.stringify({ ...bueno, archivo: "../../etc/passwd" })), null, "el archivo no sale de la carpeta de planos");
    assert.equal(leerPlanoLotes(JSON.stringify({ ...bueno, ancho: 0 })), null);
    assert.equal(leerPlanoLotes(JSON.stringify({ ...bueno, georef: { ...G, R: [[1, 0]] } }))?.georef, null, "sin calibración sana, el croquis sirve igual pero no se lleva al mapa");
    assert.equal(leerPlanoLotes("no es json"), null);
});
test("plano: las coordenadas se guardan como las leen las invitaciones", () => {
    assert.equal(coordenadasDeTexto({ lat: -34.8558113, lng: -56.0742455 }), "-34.855811, -56.074246");
});
