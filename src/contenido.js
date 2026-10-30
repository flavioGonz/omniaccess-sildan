/**
 * Todo el texto del sitio en un solo lugar (regla de la casa: nada escrito a mano en el HTML que
 * deba poder cambiar). Las detecciones salen de lo que el producto hace hoy: los tipos de regla de
 * OmniVision (src/lib/vision-reglas.ts), los atípicos de LPR (src/lib/presencia.ts), el diagnóstico
 * de imagen y la salud de equipos, y la app del guardia. Nada de lo que viene se presenta como hecho.
 */

/**
 * Quién lo comercializa. Faltan el correo, el teléfono y la web de Infratec: mientras estén vacíos,
 * el sitio no muestra esos botones (no se inventan datos de contacto).
 */
export const CONTACTO = {
    empresa: "Infratec",
    email: "",
    telefono: "",
    whatsapp: "",
    web: "",
};

export const GRUPOS = [
    { id: "vehiculos", nombre: "Vehículos y matrículas", bajada: "En cada entrada y salida, y en las calles internas." },
    { id: "perimetro", nombre: "Perímetro e intrusión", bajada: "El cerco, los muros y las zonas que de noche nadie debería pisar." },
    { id: "personas", nombre: "Personas", bajada: "Situaciones que piden que alguien vaya a mirar." },
    { id: "objetos", nombre: "Objetos", bajada: "Lo que aparece y lo que desaparece." },
    { id: "flujo", nombre: "Conteo y búsqueda", bajada: "Cuánta gente, cuántos autos, y encontrar lo que pasó." },
    { id: "salud", nombre: "Salud de las cámaras", bajada: "Una cámara que no ve es un hueco en la seguridad: también se detecta." },
    { id: "guardia", nombre: "El guardia", bajada: "Desde la app de la garita y el teléfono del que hace la ronda." },
];

/**
 * `origen` dice quién lo detecta: la cámara (su propia analítica), OmniVision (la inteligencia
 * artificial de OmniAccess, que corre en el servidor del barrio), el sistema (cruzando datos) o la
 * app del guardia.
 */
export const DETECCIONES = [
    // Vehículos y matrículas
    { g: "vehiculos", i: "car", n: "Lectura de matrícula", o: "Cámara LPR", d: "Lee la chapa en la entrada y en la salida y la cruza con el padrón: residente, visita, proveedor o desconocido. Si corresponde, abre la barrera." },
    { g: "vehiculos", i: "badge-check", n: "Doble verificación de la chapa", o: "OmniVision", d: "OmniVision vuelve a leer la foto de cada pasada. Si la cámara confundió un carácter, se corrige antes de decidir quién entró." },
    { g: "vehiculos", i: "repeat", n: "Chapas que la cámara no leyó", o: "OmniVision", d: "Cuando la cámara no logra leer la matrícula, OmniVision la rescata de la foto: menos pasadas «sin lectura»." },
    { g: "vehiculos", i: "palette", n: "Marca, color y carrocería", o: "OmniVision", d: "Describe el vehículo: auto plateado, camioneta, moto, camión. Sirve para buscarlo aunque no se vea la chapa." },
    { g: "vehiculos", i: "text-search", n: "Rotulado y empresa", o: "OmniVision", d: "Lee lo que está escrito en el vehículo, como el nombre de la empresa en una camioneta de reparto." },
    { g: "vehiculos", i: "ban", n: "Lista negra", o: "Sistema", d: "Una chapa marcada dispara la alarma en la garita y el aviso por Telegram o WhatsApp, con la foto y la cámara que la vio." },
    { g: "vehiculos", i: "siren", n: "Vehículo en búsqueda", o: "Sistema", d: "Las chapas con pedido de búsqueda avisan al instante y quedan señaladas mientras están adentro." },
    { g: "vehiculos", i: "route", n: "Merodeo de vehículos", o: "Sistema", d: "Un vehículo que pasó varias veces sin entrar, o al que le negaron el acceso en las últimas 24 horas." },
    { g: "vehiculos", i: "sparkles", n: "Primera vez visto", o: "Sistema", d: "Un vehículo que nunca había entrado al barrio queda marcado para que la guardia lo tenga presente." },
    { g: "vehiculos", i: "activity", n: "Alta frecuencia", o: "Sistema", d: "Cuatro entradas o más en un día, sin ser del barrio: algo fuera de lo común." },
    { g: "vehiculos", i: "arrow-left-right", n: "Sentido contrario", o: "OmniVision", d: "Algo cruza una línea en la mano que no corresponde: la salida usada como entrada, la contramano de una calle." },
    { g: "vehiculos", i: "square-parking", n: "Estacionamiento y plazas", o: "OmniVision", d: "Qué plazas están ocupadas y cuánto tiempo lleva cada auto en el mismo lugar." },

    // Perímetro e intrusión
    { g: "perimetro", i: "fence", n: "Cruce de línea", o: "Cámara u OmniVision", d: "Avisa cuando alguien cruza la línea dibujada sobre el perímetro, con la foto. La línea de OmniVision anda en cualquier marca de cámara y puede armarse sólo de noche." },
    { g: "perimetro", i: "shield-alert", n: "Intrusión en zona", o: "Cámara u OmniVision", d: "Alguien entra a una zona prohibida y se queda unos segundos. Una sombra o un paso por el borde no avisan." },
    { g: "perimetro", i: "scan-eye", n: "Doble verificación de la alarma", o: "OmniVision", d: "Antes de sonar, OmniVision mira la foto. Si fue un perro, una rama o un cambio de luz, la alarma no molesta a la guardia." },
    { g: "perimetro", i: "brick-wall", n: "Persona trepando", o: "OmniVision", d: "Junto al cerco o al muro, una persona con las dos manos por encima de los hombros unos segundos seguidos: alguien trepando." },
    { g: "perimetro", i: "footprints", n: "Merodeo", o: "OmniVision", d: "Alguien da vueltas en una zona más tiempo del normal, moviéndose, no esperando parado." },
    { g: "perimetro", i: "dog", n: "Animal en zona", o: "OmniVision", d: "Un perro suelto, un caballo en la calle o un animal en la piscina, sin ninguna persona al lado." },

    // Personas
    { g: "personas", i: "accessibility", n: "Persona en el suelo", o: "OmniVision", d: "Alguien que quedó acostado unos segundos en la calle, la plaza o un espacio común: puede haberse caído." },
    { g: "personas", i: "users", n: "Aglomeración", o: "OmniVision", d: "Más personas juntas de lo indicado en una zona, durante un rato." },
    { g: "personas", i: "hard-hat", n: "Sin casco o sin chaleco", o: "OmniVision", d: "En las obras del barrio, una persona trabajando sin casco o sin chaleco reflectivo." },
    { g: "personas", i: "scan-face", n: "Reconocimiento facial", o: "Terminal facial", d: "En el modo Face, reconoce a residentes y personal registrados y les abre. Un rostro desconocido queda marcado para la guardia." },

    // Objetos
    { g: "objetos", i: "briefcase", n: "Objeto abandonado", o: "OmniVision", d: "Un bolso, una mochila o una valija que aparece y queda quieta varios minutos sin nadie al lado." },
    { g: "objetos", i: "package-x", n: "Objeto retirado", o: "OmniVision", d: "Algo que estaba quieto, como una bicicleta, una moto o una silla, desaparece. Llega con la foto de antes y la de después." },

    // Conteo y búsqueda
    { g: "flujo", i: "hash", n: "Conteo por línea", o: "OmniVision", d: "Cuenta lo que cruza una línea, en cada sentido y por tipo: personas, autos, motos, bicicletas." },
    { g: "flujo", i: "list-ordered", n: "Conteo de fila", o: "OmniVision", d: "Cuenta la fila de una caja o un mostrador. Avisa a la guardia al llegar al límite, y al supervisor si sigue llena." },
    { g: "flujo", i: "layers", n: "Búsqueda y mapa de calor", o: "OmniVision", d: "Registra lo que pasa frente a cada cámara para encontrar después «una persona de rojo» o un auto parecido, y ver por dónde se mueve la gente." },

    // Salud de las cámaras
    { g: "salud", i: "eye-off", n: "Imagen tapada", o: "OmniAccess", d: "Alguien tapó la cámara o algo le quedó delante. Compara con lo que esa cámara ve normalmente, de día y de noche." },
    { g: "salud", i: "cloud-fog", n: "Imagen borrosa", o: "OmniAccess", d: "Lente sucia, empañada o desenfocada: la cámara sigue andando pero ya no sirve para identificar." },
    { g: "salud", i: "move", n: "Cámara movida", o: "OmniAccess", d: "La cámara cambió de encuadre: alguien la giró o se aflojó el soporte." },
    { g: "salud", i: "camera-off", n: "Cámara en silencio", o: "OmniAccess", d: "Una cámara que dejaba eventos y hace horas que no manda ninguno." },
    { g: "salud", i: "server-off", n: "Equipo sin respuesta", o: "OmniAccess", d: "Un grabador, una cámara o un controlador que dejó de contestar en la red." },

    // El guardia
    { g: "guardia", i: "bell-ring", n: "Botón de pánico", o: "App del guardia", d: "Desde la pantalla de la app o con tres toques seguidos a un botón de volumen del teléfono." },
    { g: "guardia", i: "person-standing", n: "Hombre caído", o: "App del guardia", d: "Un golpe fuerte seguido de quietud: el guardia pudo haberse caído durante la ronda." },
    { g: "guardia", i: "nfc", n: "Rondas con NFC", o: "App del guardia", d: "Cada punto de la ronda se marca acercando el teléfono a una etiqueta: se sabe quién pasó, por dónde y a qué hora." },
];

/** La historia del principio, escena por escena. `momento` es la parada de la cámara 3D (escena.js). */
export const ESCENAS = [
    { momento: "acceso", hora: "21:40", titulo: "Llega un auto al portón", texto: "La cámara lee la matrícula y OmniVision la vuelve a leer en la foto. Si es un residente, la barrera sube sola; si es una visita, la guardia ya sabe a quién viene a ver." },
    { momento: "perimetro", hora: "03:12", titulo: "Alguien cruza el cerco a las tres de la mañana", texto: "La línea del perímetro avisa, y antes de sonar OmniVision confirma que es una persona y no un perro. La guardia recibe la foto, el lugar en el mapa y el video de ese momento." },
    { momento: "visitas", hora: "Sábado, 18:05", titulo: "Llega una visita", texto: "El residente la invitó desde su teléfono. Muestra el QR en la garita, el guardia lo escanea con la app y queda registrado quién entró, cuándo y a ver a quién." },
    { momento: "guardia", hora: "Las 24 horas", titulo: "Todo llega a la guardia", texto: "Las alertas aparecen en la consola de la garita, en la pared de monitores y en el teléfono por Telegram o WhatsApp, con la foto y el botón para ver la grabación." },
];

export const MODULOS = [
    { i: "car", n: "LPR", d: "Control de acceso vehicular con doble verificación, padrón de residentes, visitas y proveedores, y barreras." },
    { i: "shield-check", n: "Intrusión", d: "Líneas y zonas sobre el perímetro, con la alarma confirmada por OmniVision antes de llegar a la guardia." },
    { i: "ticket", n: "Visitas", d: "Invitaciones con QR desde el teléfono del residente, tiempos por tipo de visita y registro de cada ingreso." },
    { i: "scan-face", n: "Face", d: "Acceso con reconocimiento facial en terminales, con las mismas visitas e intrusión." },
    { i: "list-ordered", n: "Filas", d: "Conteo de personas en cajas y mostradores, con avisos y tableros por hora." },
    { i: "cctv", n: "Cámaras y grabación", d: "Todas las cámaras en vivo, la grabación de cada grabador y la búsqueda de parecidos, en el mismo panel." },
    { i: "monitor", n: "Pared de monitoreo", d: "Monitores que muestran el vivo, se tiñen con quien pasa y se detienen ante una alarma." },
    { i: "send", n: "Avisos por Telegram y WhatsApp", d: "Cada alerta llega con la foto y el enlace a la grabación; el bot también responde consultas." },
    { i: "tablet-smartphone", n: "App de la garita", d: "OmniAccess Guard para Android: consola, pánico, rondas NFC, escaneo de QR y aviso de hombre caído." },
    { i: "gauge", n: "Administración de equipos", d: "Salud de cada equipo, horarios centralizados, auditoría de usuarios locales, áreas y avisos de imagen." },
];

/**
 * Los folletos (Brochure) todavía dicen IES: quedan afuera hasta rehacerlos con Infratec.
 */
export const DESCARGAS = [
    { n: "Presentación general", a: "OmniAccess-Funciones.pdf" },
    { n: "OmniAccess LPR", a: "OmniAccess-LPR-Funciones.pdf" },
    { n: "OmniAccess Face", a: "OmniAccess-Face-Funciones.pdf" },
    { n: "OmniAccess Filas", a: "OmniAccess-Filas-Funciones.pdf" },
    { n: "Intrusión con doble verificación", a: "OmniAccess-Intrusion-Funciones.pdf" },
];
