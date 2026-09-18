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
 * El dibujo mira al NORTE (grados 0). Quien lo use lo rota por el rumbo.
 */

/** Los keyframes van aparte: el marcador de la 3D vive fuera de React. */
export const CSS_AUTO = `
@keyframes omniPulsoAuto{0%,100%{transform:scale(.7);opacity:.9}50%{transform:scale(1.3);opacity:.2}}
@keyframes omniFaros{0%,100%{opacity:.95}50%{opacity:.45}}
.omni-auto-halo{animation:omniPulsoAuto 1.8s ease-in-out infinite}
.omni-auto-faro{animation:omniFaros 1.8s ease-in-out infinite}
/* La rotación se interpola sola: sin esto el auto salta de ángulo en cada lectura. */
.omni-auto-giro{transition:transform .28s cubic-bezier(.22,1,.36,1)}
`;

export const TAM_AUTO = 46;

/**
 * El marcador completo. `grados` es el rumbo (0 = norte).
 *
 * El halo late en un elemento aparte del que gira, a propósito: si compartieran nodo,
 * cada cambio de rumbo reiniciaría la animación del pulso y latiría a los saltos.
 */
export function svgAuto(grados = 0) {
    return `
<div style="position:relative;width:${TAM_AUTO}px;height:${TAM_AUTO}px">
  <span class="omni-auto-halo" style="position:absolute;inset:0;border-radius:50%;
        background:radial-gradient(circle,rgba(251,191,36,.45) 0%,rgba(251,191,36,.12) 45%,rgba(251,191,36,0) 70%)"></span>
  <div class="omni-auto-giro" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        transform:rotate(${Math.round(grados)}deg)">
    <svg width="${TAM_AUTO}" height="${TAM_AUTO}" viewBox="0 0 48 48"
         style="filter:drop-shadow(0 3px 5px rgba(0,0,0,.7))">
      <!-- Cono de luz: ayuda a leer el sentido cuando el mapa está muy alejado y el
           auto queda de pocos píxeles. -->
      <path d="M24 6 14 -6h20z" fill="url(#omniCono)" opacity=".5"/>
      <defs>
        <linearGradient id="omniCono" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="#fde68a" stop-opacity=".55"/>
          <stop offset="100%" stop-color="#fde68a" stop-opacity="0"/>
        </linearGradient>
      </defs>

      <!-- Ruedas, asomando a los costados -->
      <rect x="10.2" y="13" width="4.6" height="8" rx="2.1" fill="#12141a"/>
      <rect x="33.2" y="13" width="4.6" height="8" rx="2.1" fill="#12141a"/>
      <rect x="10.2" y="28" width="4.6" height="8" rx="2.1" fill="#12141a"/>
      <rect x="33.2" y="28" width="4.6" height="8" rx="2.1" fill="#12141a"/>

      <!-- Carrocería: trompa más angosta que la cola, que es lo que hace que se lea
           hacia dónde apunta sin necesidad de flecha. -->
      <path d="M24 4.6c-4.3 0-7.3 2.7-8.1 7.2l-1 9.6c-.32 3.1-.32 9.1 0 12.2l1 5.6
               c.62 3.3 3.5 4.6 8.1 4.6s7.48-1.3 8.1-4.6l1-5.6c.32-3.1.32-9.1 0-12.2l-1-9.6
               C31.3 7.3 28.3 4.6 24 4.6z"
            fill="#fbbf24" stroke="#fff7ed" stroke-width="1.7" stroke-linejoin="round"/>

      <!-- Parabrisas -->
      <path d="M17.5 15.6c1.9-1.1 4.1-1.7 6.5-1.7s4.6.6 6.5 1.7l-.95 4.3
               c-1.75-.72-3.6-1.05-5.55-1.05s-3.8.33-5.55 1.05z" fill="#0a0d12" opacity=".82"/>
      <!-- Techo -->
      <rect x="16.9" y="21.2" width="14.2" height="9.2" rx="2.6" fill="#0a0d12" opacity=".42"/>
      <!-- Luneta -->
      <path d="M17.7 33.6c1.8-.62 3.75-.92 6.3-.92s4.5.3 6.3.92l.5 2.7
               c-1.95-.6-4.1-.9-6.8-.9s-4.85.3-6.8.9z" fill="#0a0d12" opacity=".68"/>

      <!-- Espejos -->
      <rect x="12.4" y="21.4" width="3.4" height="2.3" rx="1.15" fill="#fbbf24" stroke="#fff7ed" stroke-width=".7"/>
      <rect x="32.2" y="21.4" width="3.4" height="2.3" rx="1.15" fill="#fbbf24" stroke="#fff7ed" stroke-width=".7"/>

      <!-- Faros -->
      <circle class="omni-auto-faro" cx="19.1" cy="8.4" r="1.6" fill="#fff7ed"/>
      <circle class="omni-auto-faro" cx="28.9" cy="8.4" r="1.6" fill="#fff7ed"/>
      <!-- Luces de cola -->
      <rect x="18.2" y="39.4" width="3.2" height="1.5" rx=".75" fill="#f43f5e" opacity=".9"/>
      <rect x="26.6" y="39.4" width="3.2" height="1.5" rx=".75" fill="#f43f5e" opacity=".9"/>
    </svg>
  </div>
</div>`;
}
