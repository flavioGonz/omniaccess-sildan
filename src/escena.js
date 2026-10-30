/**
 * El barrio de noche, en 3D: la escena que acompaña la historia del principio.
 *
 * Una sola idea fuerte (skill sitio-impresionante): el barrio visto como lo ve OmniAccess. Casas
 * con las ventanas prendidas, el cerco del perímetro, el portón con su barrera y la cámara LPR, y
 * lo que pasa —un auto que llega, alguien que cruza el cerco, una visita— marcado con el mismo
 * recuadro de esquinas que el logo y que las capturas del producto.
 *
 * El scroll mueve una sola variable, `avance` (0 = portada; 1–4 = las cuatro escenas). Todo lo que
 * se mueve con el scroll sale de ahí; lo que se mueve solo (faroles, autos de fondo, el visor de la
 * portada) sale del reloj. Todo es geometría generada: no hay modelos que bajar.
 *
 * three.js r186 (skills threejs-*): Timer en vez de Clock, setAnimationLoop, salida sRGB por
 * defecto, postproceso con OutputPass al final.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/** Los colores de la escena, los mismos tokens que el CSS (estilos.css). */
const C = {
    noche: 0x070b16,
    suelo: 0x111a30,
    calle: 0x1b2742,
    casa: 0x34436b,
    techo: 0x101829,
    ventana: 0xffb547, // luz de sodio: la de los faroles de un barrio uruguayo
    marca: 0x8a6cff,   // el punto del logo
    alarma: 0xff4d5e,
    bien: 0x35d39a,
    farol: 0xffc36b,
};

/** Las paradas de la cámara: dónde está y a qué mira en cada momento de la historia. */
const PARADAS = [
    { pos: [40, 46, 112], mira: [-30, 0, 4] },    // 0 portada: el barrio entero, de lejos y a la derecha del título
    { pos: [13, 5.5, 66], mira: [-6, 1.6, 49] },  // 1 acceso: el portón y la cámara LPR (a la derecha del texto)
    { pos: [62, 11, -2], mira: [36, 1.2, -6] },   // 2 perímetro: el cerco del costado
    { pos: [-11, 4.2, 53], mira: [2.5, 1.6, 42] },// 3 visitas: la garita
    { pos: [0, 118, 40], mira: [0, 0, -4] },      // 4 guardia: todo, desde arriba
];

const lerp = (a, b, t) => a + (b - a) * t;
const suave = (t) => t * t * (3 - 2 * t);
const tramo = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));

export function crearEscena({ lienzo, capa, bajo }) {
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: !bajo, powerPreference: "high-performance" });
    } catch {
        return null; // sin WebGL: el sitio sigue, con el fondo estático (ver sitio.js)
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, bajo ? 1.25 : 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;

    const escena = new THREE.Scene();
    escena.background = new THREE.Color(C.noche);
    escena.fog = new THREE.FogExp2(C.noche, 0.0048);

    const camara = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
    const mira = new THREE.Vector3();

    // Luz: una luna fría muy tenue y el resplandor cálido del barrio.
    escena.add(new THREE.HemisphereLight(0x7d93cc, 0x141b2e, 1.6));
    const luna = new THREE.DirectionalLight(0xa9bdff, 1.4);
    luna.position.set(-60, 90, 40);
    escena.add(luna);

    // ── Suelo, calles y grilla ───────────────────────────────────────────────────────────────
    const suelo = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: C.suelo, roughness: 1 }));
    suelo.rotation.x = -Math.PI / 2;
    escena.add(suelo);

    const matCalle = new THREE.MeshStandardMaterial({ color: C.calle, roughness: 0.9 });
    const calle = (x, z, w, d) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), matCalle);
        m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); escena.add(m);
    };
    calle(0, 10, 7, 120);   // la avenida que entra por el portón
    calle(0, 12, 84, 6);    // las dos transversales
    calle(0, -22, 84, 6);
    calle(0, 70, 7, 40);    // el acceso desde la ruta

    // Líneas de los lotes: la grilla del plano del barrio, apenas visible.
    const lineas = [];
    for (let x = -42; x <= 42; x += 12) lineas.push(x, 0.03, -52, x, 0.03, 42);
    for (let z = -52; z <= 42; z += 12) lineas.push(-42, 0.03, z, 42, 0.03, z);
    const grilla = new THREE.BufferGeometry();
    grilla.setAttribute("position", new THREE.Float32BufferAttribute(lineas, 3));
    escena.add(new THREE.LineSegments(grilla, new THREE.LineBasicMaterial({ color: 0x1d2a47, transparent: true, opacity: 0.55 })));

    // ── Casas, con sus ventanas encendidas ───────────────────────────────────────────────────
    const azar = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const lotes = [];
    for (let x = -36; x <= 36; x += 12) {
        for (let z = -46; z <= 34; z += 12) {
            if (Math.abs(x) < 7 || Math.abs(z - 12) < 6 || Math.abs(z + 22) < 6) continue; // calles
            if (bajo && azar() < 0.35) continue;
            lotes.push([x + (azar() - 0.5) * 2, z + (azar() - 0.5) * 2]);
        }
    }
    const casaGeo = new THREE.BoxGeometry(1, 1, 1);
    casaGeo.translate(0, 0.5, 0);
    const casas = new THREE.InstancedMesh(casaGeo, new THREE.MeshStandardMaterial({ color: C.casa, roughness: 0.85 }), lotes.length);
    const ventanas = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: C.ventana, toneMapped: false }), lotes.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3();
    let iv = 0;
    lotes.forEach(([x, z], i) => {
        const w = 6 + azar() * 2.5, h = 2.8 + azar() * 2.6, d = 5.5 + azar() * 2;
        const giro = Math.round(azar() * 3) * (Math.PI / 2);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), giro);
        casas.setMatrixAt(i, m4.compose(v.set(x, 0, z), q, s3.set(w, h, d)));
        // Dos ventanas por casa, una de cada lado; algunas apagadas (es de noche).
        for (const lado of [1, -1]) {
            const prendida = azar() > 0.3;
            const off = new THREE.Vector3(lado * w * 0.22, h * 0.45, d / 2 + 0.02).applyQuaternion(q);
            const qv = q.clone();
            ventanas.setMatrixAt(iv++, m4.compose(v.set(x + off.x, off.y, z + off.z), qv, s3.set(prendida ? 1.3 : 0.001, prendida ? 0.9 : 0.001, 1)));
        }
    });
    ventanas.count = iv;
    escena.add(casas, ventanas);

    // ── Faroles: un punto de luz cálida y su halo ────────────────────────────────────────────
    const halo = (() => {
        const c = document.createElement("canvas"); c.width = c.height = 128;
        const g = c.getContext("2d"); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,0.45)"); r.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = r; g.fillRect(0, 0, 128, 128);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const sprite = (color, escala, opacidad = 0.8) => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color, transparent: true, opacity: opacidad, depthWrite: false, blending: THREE.AdditiveBlending }));
        sp.scale.setScalar(escala); return sp;
    };
    const faroles = [];
    const posteGeo = new THREE.CylinderGeometry(0.08, 0.1, 5, 6); posteGeo.translate(0, 2.5, 0);
    const matPoste = new THREE.MeshStandardMaterial({ color: 0x1e2944 });
    const bombilla = new THREE.MeshBasicMaterial({ color: C.farol, toneMapped: false });
    for (let z = -46; z <= 66; z += 14) for (const x of [-4.6, 4.6]) {
        if (bajo && z % 28 !== 0) continue;
        const poste = new THREE.Mesh(posteGeo, matPoste); poste.position.set(x, 0, z);
        const luz = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bombilla); luz.position.set(x, 5, z);
        const h = sprite(C.farol, 6.5, 0.55); h.position.set(x, 5, z);
        escena.add(poste, luz, h); faroles.push(h);
    }

    // ── El perímetro: postes y una línea que brilla ──────────────────────────────────────────
    const cerco = [[-42, -52], [42, -52], [42, 42], [6, 42], [-6, 42], [-42, 42], [-42, -52]];
    const matCerco = new THREE.MeshBasicMaterial({ color: C.marca, transparent: true, opacity: 0.55, toneMapped: false });
    const tramosCerco = [];
    for (let i = 0; i < cerco.length - 1; i++) {
        if (i === 3) continue; // el hueco del portón
        const [x1, z1] = cerco[i], [x2, z2] = cerco[i + 1];
        const largo = Math.hypot(x2 - x1, z2 - z1);
        const linea = new THREE.Mesh(new THREE.BoxGeometry(largo, 0.08, 0.08), matCerco.clone());
        linea.position.set((x1 + x2) / 2, 1.7, (z1 + z2) / 2);
        linea.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        escena.add(linea); tramosCerco.push(linea);
        const n = Math.floor(largo / 3);
        const postes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.8, 0.12), matPoste, n);
        for (let k = 0; k < n; k++) postes.setMatrixAt(k, m4.makeTranslation(lerp(x1, x2, k / n), 0.9, lerp(z1, z2, k / n)));
        escena.add(postes);
    }
    const tramoAlarma = tramosCerco[1]; // el lado este (x = 42), donde cruza la persona

    // La luz de los faroles sí ilumina donde pasa la historia: el portón y el cerco del este.
    // (Luces físicas de r155+: la intensidad va en candelas y cae con la distancia.)
    for (const [x, y, z, i] of [[-4.6, 5, 52, 90], [4.6, 5, 38, 70], [9, 4, 47, 40], [38, 5, -13, 70], [0, 5, 24, 50], [0, 5, -6, 50]]) {
        const l = new THREE.PointLight(C.farol, i, 34, 1.6); l.position.set(x, y, z); escena.add(l);
    }

    // ── El portón: garita, barrera y cámara LPR ──────────────────────────────────────────────
    const garita = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 4), new THREE.MeshStandardMaterial({ color: 0x223050, roughness: 0.7 }));
    garita.position.set(9, 1.6, 44); escena.add(garita);
    const vidrio = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.2), new THREE.MeshBasicMaterial({ color: 0x7fb2ff, toneMapped: false, transparent: true, opacity: 0.85 }));
    vidrio.position.set(6.48, 2.1, 44); vidrio.rotation.y = -Math.PI / 2; escena.add(vidrio);
    const luzGarita = sprite(0x7fb2ff, 9, 0.35); luzGarita.position.set(6, 2.2, 44); escena.add(luzGarita);

    const barrera = new THREE.Group(); barrera.position.set(-3.6, 1.05, 41.2);
    const brazo = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.14, 0.14), new THREE.MeshStandardMaterial({ color: 0xe8ecf4, emissive: 0x222222 }));
    brazo.position.x = 3.6; barrera.add(brazo);
    for (let k = 0; k < 4; k++) {
        const franja = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.15), new THREE.MeshBasicMaterial({ color: C.alarma }));
        franja.position.x = 1 + k * 1.7; barrera.add(franja);
    }
    const pie = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.5), matPoste); pie.position.set(-3.6, 0.55, 41.2);
    escena.add(barrera, pie);

    const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.4, 8), matPoste); poste.position.set(5.2, 2.2, 49); escena.add(poste);
    const camLpr = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1), new THREE.MeshStandardMaterial({ color: 0xdfe5f0 }));
    camLpr.position.set(5.2, 4.4, 49); camLpr.lookAt(0, 0.6, 56); escena.add(camLpr);
    const ledCam = sprite(C.marca, 1.6, 0.9); ledCam.position.set(5.2, 4.4, 49.6); escena.add(ledCam);

    // El haz de lectura: un cono que sale de la cámara hacia la chapa del auto.
    const haz = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1, 24, 1, true), new THREE.MeshBasicMaterial({ color: C.marca, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    haz.geometry.translate(0, -0.5, 0); haz.geometry.rotateX(-Math.PI / 2);
    escena.add(haz);

    // ── Vehículos ────────────────────────────────────────────────────────────────────────────
    const crearAuto = (color) => {
        const g = new THREE.Group();
        const carroceria = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.3), new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.6 }));
        carroceria.position.y = 0.6;
        const cabina = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.1), new THREE.MeshStandardMaterial({ color: 0x0d1424, roughness: 0.2, metalness: 0.8 }));
        cabina.position.set(0, 1.2, -0.2);
        const faro = new THREE.MeshBasicMaterial({ color: 0xfff3d6, toneMapped: false });
        const trasera = new THREE.MeshBasicMaterial({ color: 0xff3344, toneMapped: false });
        for (const x of [-0.65, 0.65]) {
            const f = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), faro); f.position.set(x, 0.7, -2.16); g.add(f);
            const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), trasera); t.position.set(x, 0.75, 2.16); g.add(t);
        }
        const luces = sprite(0xfff3d6, 5, 0.45); luces.position.set(0, 0.8, -3); g.add(luces);
        g.add(carroceria, cabina);
        escena.add(g);
        return g;
    };
    const auto = crearAuto(0xaab4c4); // el que llega: plateado
    const fondo = [crearAuto(0x2a4f9a), crearAuto(0x7a1f2a)]; // dos que andan solos por adentro

    // ── Personas: un cuerpo simple y su recuadro ─────────────────────────────────────────────
    const crearPersona = (color) => {
        const g = new THREE.Group();
        const cuerpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1, 4, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
        cuerpo.position.y = 0.95;
        const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: 0xc9a58a }));
        cabeza.position.y = 1.85;
        g.add(cuerpo, cabeza); escena.add(g); return g;
    };
    const intruso = crearPersona(0x2b2f3a);
    const visita = crearPersona(0x3d6fd6);

    // ── El visor de la portada: las cuatro esquinas y el aro del logo, en 3D ────────────────
    const visor = new THREE.Group();
    const matVisor = new THREE.MeshBasicMaterial({ color: 0xf2f4f8, toneMapped: false, transparent: true });
    const esquina = () => {
        const e = new THREE.Group();
        const a = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 0.5), matVisor); a.position.set(1.6, 0, 0);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 0.5), matVisor); b.position.set(0, -1.6, 0);
        e.add(a, b); return e;
    };
    [[-1, 1], [1, 1], [1, -1], [-1, -1]].forEach(([sx, sy], k) => {
        const e = esquina(); e.position.set(sx * 8, sy * 8, 0); e.rotation.z = -k * Math.PI / 2; visor.add(e);
    });
    const aro = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.42, 16, 72), matVisor); visor.add(aro);
    const nucleo = new THREE.Mesh(new THREE.SphereGeometry(1.7, 32, 24), new THREE.MeshBasicMaterial({ color: C.marca, toneMapped: false }));
    visor.add(nucleo);
    const brilloNucleo = sprite(C.marca, 16, 0.65); visor.add(brilloNucleo);
    visor.position.set(0, 22, 18);
    escena.add(visor);

    // ── Marcas sobre la escena (HTML, para que se lean y se puedan seleccionar) ─────────────
    const marcas = [];
    const marca = (clase, html, seguir) => {
        const el = document.createElement("div");
        el.className = `marca ${clase}`; el.innerHTML = html; el.setAttribute("aria-hidden", "true");
        capa.appendChild(el);
        const m = { el, seguir, visible: 0 }; marcas.push(m); return m;
    };
    const marcaAuto = marca("marca-auto", '<span class="marca-caja"></span><span class="marca-texto"><b>SBF 4417</b> leída por la cámara · confirmada por OmniVision</span>', () => v.copy(auto.position).setY(1.1));
    const marcaIntruso = marca("marca-alarma", '<span class="marca-caja"></span><span class="marca-texto"><b>Cruce de línea</b> persona confirmada · 03:12</span>', () => v.copy(intruso.position).setY(1.2));
    const marcaVisita = marca("marca-visita", '<span class="marca-caja"></span><span class="marca-texto"><b>Visita · QR válido</b> a Lote 45 · hasta 22:00</span>', () => v.copy(visita.position).setY(1.2));
    const marcaGarita = marca("marca-garita", '<span class="marca-punto"></span><span class="marca-texto"><b>Garita</b> 3 alertas atendidas hoy</span>', () => v.set(9, 3.6, 44));

    // ── Postproceso: sólo el brillo (bloom) de las luces, y no en equipos modestos ──────────
    let composer = null;
    if (!bajo) {
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(escena, camara));
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.62));
        composer.addPass(new OutputPass());
    }

    // ── Estado y cuadro a cuadro ─────────────────────────────────────────────────────────────
    let avance = 0, avanceVisto = 0, quieto = false;
    const timer = new THREE.Timer(); timer.connect(document);
    const ancho = { w: 1, h: 1 };

    function medir() {
        const r = lienzo.getBoundingClientRect();
        ancho.w = Math.max(1, r.width); ancho.h = Math.max(1, r.height);
        renderer.setSize(ancho.w, ancho.h, false);
        composer?.setSize(ancho.w, ancho.h);
        camara.aspect = ancho.w / ancho.h;
        // En pantallas angostas se abre el ángulo: el barrio entra igual.
        camara.fov = ancho.w / ancho.h < 0.8 ? 52 : 38;
        camara.updateProjectionMatrix();
    }

    function ubicarCamara(p) {
        const i = Math.min(PARADAS.length - 2, Math.floor(p)), t = suave(p - i);
        const a = PARADAS[i], b = PARADAS[i + 1];
        // Entre parada y parada la cámara sube en arco: así no atraviesa las casas.
        const salto = Math.sin(Math.PI * t) * Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]) * 0.22;
        camara.position.set(lerp(a.pos[0], b.pos[0], t), lerp(a.pos[1], b.pos[1], t) + salto, lerp(a.pos[2], b.pos[2], t));
        mira.set(lerp(a.mira[0], b.mira[0], t), lerp(a.mira[1], b.mira[1], t), lerp(a.mira[2], b.mira[2], t));
    }

    function cuadro() {
        timer.update();
        const tiempo = timer.getElapsed();
        // El scroll manda, pero la cámara lo sigue con un poco de inercia: se siente filmada.
        avanceVisto += (avance - avanceVisto) * (quieto ? 1 : 0.08);
        const p = avanceVisto;
        ubicarCamara(p);
        // Un balanceo mínimo, como una cámara en mano. No con «menos movimiento».
        if (!quieto) camara.position.y += Math.sin(tiempo * 0.5) * 0.25;
        camara.lookAt(mira);

        // Portada: el visor gira despacio y se va cuando empieza la historia.
        const vis = 1 - tramo(p, 0.15, 0.6);
        visor.visible = vis > 0.01;
        // El visor flota a la derecha del título, siempre de frente a la cámara.
        camara.updateMatrixWorld();
        derecha.setFromMatrixColumn(camara.matrixWorld, 0);
        arriba.setFromMatrixColumn(camara.matrixWorld, 1);
        frente.setFromMatrixColumn(camara.matrixWorld, 2).negate();
        visor.position.copy(camara.position).addScaledVector(frente, 70).addScaledVector(derecha, ancho.w / ancho.h < 0.8 ? 0 : 17).addScaledVector(arriba, ancho.w / ancho.h < 0.8 ? 24 : 4);
        matVisor.opacity = vis;
        visor.quaternion.copy(camara.quaternion);
        if (!quieto) { visor.rotateY(Math.sin(tiempo * 0.35) * 0.45); visor.rotateZ(tiempo * 0.12); }
        nucleo.scale.setScalar(1 + Math.sin(tiempo * 2.2) * 0.06);
        brilloNucleo.material.opacity = 0.55 * vis;

        // 1 · Acceso: el auto llega, la cámara lo lee, la barrera sube y sigue.
        const llega = tramo(p, 0.35, 0.9), pasa = tramo(p, 1.1, 1.6);
        auto.position.set(-1.7, 0, lerp(lerp(96, 50.5, suave(llega)), 18, suave(pasa)));
        const leyendo = tramo(p, 0.75, 0.95) * (1 - tramo(p, 1.25, 1.45));
        haz.material.opacity = leyendo * (0.16 + Math.sin(tiempo * 8) * 0.04);
        haz.position.copy(camLpr.position);
        haz.lookAt(auto.position.x, 0.8, auto.position.z - 2.2);
        haz.scale.set(1, 1, camLpr.position.distanceTo(v.set(auto.position.x, 0.8, auto.position.z - 2.2)));
        barrera.rotation.z = suave(tramo(p, 0.95, 1.2)) * (Math.PI / 2.2) * (1 - tramo(p, 1.6, 1.8));
        marcaAuto.visible = tramo(p, 0.8, 0.95) * (1 - tramo(p, 1.35, 1.5));

        // 2 · Perímetro: alguien cruza el cerco; la línea se pone roja y late.
        const cruza = tramo(p, 1.55, 2.1);
        intruso.position.set(lerp(50, 37, suave(cruza)), 0, -13 + Math.sin(cruza * 6) * 0.2);
        intruso.rotation.y = -Math.PI / 2;
        intruso.visible = p > 1.3 && p < 3.2;
        const alarma = tramo(p, 1.85, 1.95) * (1 - tramo(p, 2.6, 2.8));
        tramoAlarma.material.color.setHex(alarma > 0 ? C.alarma : C.marca);
        tramoAlarma.material.opacity = 0.55 + alarma * (0.35 + Math.sin(tiempo * 9) * 0.1);
        marcaIntruso.visible = alarma;

        // 3 · Visitas: la visita llega caminando a la garita con su QR.
        const camina = tramo(p, 2.45, 2.95);
        visita.position.set(lerp(-1, 4.6, suave(camina)), 0, lerp(56, 46.5, suave(camina)));
        visita.lookAt(6.5, 0, 44);
        visita.visible = p > 2.2;
        marcaVisita.visible = tramo(p, 2.85, 3.0) * (1 - tramo(p, 3.45, 3.6));

        // 4 · Guardia: desde arriba, la garita resume lo que pasó.
        marcaGarita.visible = tramo(p, 3.6, 3.9);

        // Lo que se mueve solo: dos autos dando la vuelta, los faroles que titilan apenas.
        if (!quieto) {
            fondo.forEach((a, k) => {
                const u = ((tiempo * 0.035 + k * 0.5) % 1);
                const x = u < 0.5 ? lerp(-38, 38, u * 2) : lerp(38, -38, (u - 0.5) * 2);
                a.position.set(x, 0, k === 0 ? 10.3 : -23.7);
                a.rotation.y = u < 0.5 ? -Math.PI / 2 : Math.PI / 2; // el frente del auto mira a -z
            });
            faroles.forEach((f, k) => { f.material.opacity = 0.5 + Math.sin(tiempo * 3 + k * 1.7) * 0.03; });
            ledCam.material.opacity = 0.6 + Math.sin(tiempo * 4) * 0.3;
        }

        if (composer) composer.render(); else renderer.render(escena, camara);
        proyectarMarcas();
    }

    const pantalla = new THREE.Vector3();
    const derecha = new THREE.Vector3(), arriba = new THREE.Vector3(), frente = new THREE.Vector3();
    function proyectarMarcas() {
        for (const m of marcas) {
            if (m.visible <= 0.01) { if (m.el.style.opacity !== "0") m.el.style.opacity = "0"; continue; }
            pantalla.copy(m.seguir()).project(camara);
            if (pantalla.z > 1) { m.el.style.opacity = "0"; continue; }
            const x = (pantalla.x * 0.5 + 0.5) * ancho.w, y = (-pantalla.y * 0.5 + 0.5) * ancho.h;
            m.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
            m.el.style.opacity = String(m.visible);
        }
    }

    medir();
    window.addEventListener("resize", medir);

    let andando = false;
    return {
        /** 0 = portada; 1 a 4 = las escenas de la historia. */
        setAvance(p) { avance = p; },
        /** Con «menos movimiento»: la cámara salta a cada parada, sin vuelo ni balanceo. */
        setQuieto(q) { quieto = q; },
        prender() { if (!andando) { andando = true; renderer.setAnimationLoop(cuadro); } },
        apagar() { if (andando) { andando = false; renderer.setAnimationLoop(null); } },
        medir,
        cuadroUnico: cuadro,
    };
}
