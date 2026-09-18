/**
 * El autito del flujo: un auto visto desde arriba, apuntando hacia donde va.
 *
 * Una sola definición para las dos vistas del mapa. La plana usa Leaflet y la 3D usa
 * MapLibre, que no comparten nada — pero el vehículo tiene que verse idéntico en las dos,
 * o son dos productos distintos mirando el mismo barrio.
 *
 * Por qué un auto y no un punto: un círculo es igual para los dos sentidos de la calle,
 * así que el rumbo —que es la mitad de lo que se quiere saber de un vehículo en
 * movimiento— no estaba en ningún lado. Un auto visto de arriba se entiende sin leyenda.
 *
 * Y por qué oscuro y no amarillo: en amarillo era un taxi. El color no es decoración,
 * dice algo — acá el vehículo es uno cualquiera del barrio, así que va en el gris oscuro
 * de la interfaz, con el acento reservado para lo que sí lo necesita (el halo y el camino
 * ya recorrido).
 *
 * El dibujo mira al NORTE (grados 0). Quien lo use lo rota por el rumbo.
 */

/** Los keyframes van aparte: el marcador de la 3D vive fuera de React. */
export const CSS_AUTO = `
@keyframes omniPulsoAuto{0%,100%{transform:scale(.72);opacity:.85}50%{transform:scale(1.25);opacity:.18}}
@keyframes omniFaros{0%,100%{opacity:.95}50%{opacity:.5}}
.omni-auto-halo{animation:omniPulsoAuto 1.9s ease-in-out infinite}
.omni-auto-faro{animation:omniFaros 1.9s ease-in-out infinite}
/* La rotación se interpola sola: sin esto el auto salta de ángulo en cada lectura. */
.omni-auto-giro{transition:transform .28s cubic-bezier(.22,1,.36,1)}
`;

export const TAM_AUTO = 32;

/**
 * El marcador completo. `grados` es el rumbo (0 = norte).
 *
 * El halo late en un elemento aparte del que gira, a propósito: si compartieran nodo,
 * cada cambio de rumbo reiniciaría la animación del pulso y latiría a los saltos.
 */
export function svgAuto(grados = 0) {
    return `
<div style="position:relative;width:${TAM_AUTO}px;height:${TAM_AUTO}px">
  <span class="omni-auto-halo" style="position:absolute;inset:-6px;border-radius:50%;
        background:radial-gradient(circle,rgba(251,191,36,.4) 0%,rgba(251,191,36,.1) 45%,rgba(251,191,36,0) 70%)"></span>
  <div class="omni-auto-giro" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        transform:rotate(${Math.round(grados)}deg)">
    <svg width="${TAM_AUTO}" height="${TAM_AUTO}" viewBox="0 0 48 48"
         style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.75))">
      <!-- Ruedas, asomando a los costados -->
      <rect x="11" y="14" width="4.2" height="7.6" rx="2" fill="#07080a"/>
      <rect x="32.8" y="14" width="4.2" height="7.6" rx="2" fill="#07080a"/>
      <rect x="11" y="27.4" width="4.2" height="7.6" rx="2" fill="#07080a"/>
      <rect x="32.8" y="27.4" width="4.2" height="7.6" rx="2" fill="#07080a"/>

      <!-- Carrocería: la trompa más angosta que la cola es lo que hace que se lea
           hacia dónde apunta sin necesidad de flecha. -->
      <path d="M24 5.4c-4.1 0-7 2.6-7.8 7l-.95 9.3c-.3 3-.3 8.8 0 11.8l.95 5.4
               c.6 3.2 3.3 4.5 7.8 4.5s7.2-1.3 7.8-4.5l.95-5.4c.3-3 .3-8.8 0-11.8l-.95-9.3
               C31 8 28.1 5.4 24 5.4z"
            fill="#20242d" stroke="#e7ebf2" stroke-width="1.5" stroke-linejoin="round"/>

      <!-- Parabrisas y luneta, apenas más claros que la chapa -->
      <path d="M18 16.2c1.8-1 3.8-1.5 6-1.5s4.2.5 6 1.5l-.85 4c-1.65-.65-3.4-.98-5.15-.98
               s-3.5.33-5.15.98z" fill="#5b667a" opacity=".85"/>
      <rect x="17.6" y="21.6" width="12.8" height="8.6" rx="2.4" fill="#2b313c"/>
      <path d="M18.2 33.2c1.7-.58 3.5-.86 5.8-.86s4.1.28 5.8.86l.45 2.4
               c-1.8-.55-3.85-.83-6.25-.83s-4.45.28-6.25.83z" fill="#5b667a" opacity=".7"/>

      <!-- Espejos -->
      <rect x="13.4" y="21.8" width="3" height="2" rx="1" fill="#20242d" stroke="#e7ebf2" stroke-width=".6"/>
      <rect x="31.6" y="21.8" width="3" height="2" rx="1" fill="#20242d" stroke="#e7ebf2" stroke-width=".6"/>

      <!-- Faros y luces de cola -->
      <circle class="omni-auto-faro" cx="19.4" cy="9" r="1.5" fill="#fef3c7"/>
      <circle class="omni-auto-faro" cx="28.6" cy="9" r="1.5" fill="#fef3c7"/>
      <rect x="18.6" y="38.6" width="3" height="1.5" rx=".75" fill="#f43f5e" opacity=".9"/>
      <rect x="26.4" y="38.6" width="3" height="1.5" rx=".75" fill="#f43f5e" opacity=".9"/>
    </svg>
  </div>
</div>`;
}
