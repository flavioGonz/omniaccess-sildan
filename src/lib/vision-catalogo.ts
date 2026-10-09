/**
 * Qué sabe hacer el detector de objetos y qué hace OmniAccess con eso.
 *
 * Tres listas, para no confundir tres cosas que se mezclan al hablar de "YOLO":
 *
 *  · CAPACIDADES: las TAREAS de visión que existen en la familia YOLO (detectar, segmentar,
 *    pose, seguir, clasificar, cajas orientadas, vocabulario abierto) y, para cada una, con
 *    qué pieza LIBRE se hace acá y si ya corre. YOLO26 de Ultralytics es AGPL y servirlo
 *    pide licencia paga; Nico decidió no pagarla (9/10), así que cada tarea dice su
 *    equivalente Apache/MIT o que no hay.
 *  · CLASES: los 80 objetos que el modelo reconoce (las clases COCO, las mismas para YOLO26
 *    y para RF-DETR), con su nombre, su grupo y para qué le sirven a un barrio.
 *  · ANALITICAS: lo que OmniAccess construye encima — la doble verificación de intrusión,
 *    las motos, el vehículo sin lectura… — cada una con su fase del plan
 *    (openspec/changes/detector-objetos-yolo) y su estado REAL.
 *
 * El estado no se adorna: "corre" es que hay código andando hoy; "en desarrollo" es que
 * está en el plan y todavía no corre; "posible" es que la pieza existe y es libre pero no
 * está ni planificada. Prender una analítica que no corre guarda la preferencia y lo dice.
 *
 * No importa nada de servidor: lo usan la pantalla y las rutas.
 */

/** Ajustes donde se guardan los interruptores (Setting.key → JSON {id: boolean}). */
export const CLAVE_ANALITICAS = "VISION_ANALITICAS";
export const CLAVE_CLASES = "VISION_CLASES";

export type EstadoCapacidad = "corre" | "libre" | "pesado" | "no-aplica";

export type Capacidad = {
    id: string;
    nombre: string;
    icono: string;
    /** Qué hace, en una frase. */
    queEs: string;
    /** Para qué le sirve a OmniAccess. */
    paraQue: string;
    /** Con qué se haría acá sin pagar licencia, y su licencia. */
    libre: string;
    estado: EstadoCapacidad;
};

export const CAPACIDADES: Capacidad[] = [
    {
        id: "deteccion", nombre: "Detección de objetos", icono: "ScanSearch",
        queEs: "Encuentra objetos en la imagen y dice qué son, dónde están (una caja) y con cuánta confianza.",
        paraQue: "Todo lo demás se apoya en esto: confirmar que lo que cruzó la línea es una persona, contar motos, saber si pasó un vehículo sin lectura.",
        libre: "RF-DETR Small (Apache-2.0), corriendo en omni-vision. También Nano y Medium, por ajuste.",
        estado: "corre",
    },
    {
        id: "segmentacion", nombre: "Segmentación", icono: "Shapes",
        queEs: "Además de la caja, recorta la silueta exacta del objeto, píxel por píxel.",
        paraQue: "Saber si una persona está DENTRO de una zona dibujada (no sólo su caja), medir cuánto ocupa un vehículo en una plaza, recortes limpios para buscar.",
        libre: "RF-DETR Seg (Apache-2.0), mismo paquete. No instalado todavía.",
        estado: "libre",
    },
    {
        id: "pose", nombre: "Pose (puntos del cuerpo)", icono: "PersonStanding",
        queEs: "Marca 17 puntos del cuerpo de cada persona: cabeza, hombros, codos, cadera, rodillas, tobillos.",
        paraQue: "Persona en el suelo, alguien trepando un cerco, manos en alto. Distinguir caminar de agacharse.",
        libre: "RF-DETR Keypoint (Apache-2.0, versión preliminar). No instalado todavía.",
        estado: "libre",
    },
    {
        id: "seguimiento", nombre: "Seguimiento", icono: "Waypoints",
        queEs: "Le pone un número a cada objeto y lo sigue cuadro a cuadro mientras se mueve.",
        paraQue: "Merodeo (alguien que da vueltas o se queda), objetos dejados, contar sin contar dos veces al mismo, el recorrido de un vehículo dentro de una cámara.",
        libre: "ByteTrack (MIT) sobre las detecciones. No necesita otro modelo, sólo cuadros seguidos.",
        estado: "libre",
    },
    {
        id: "clasificacion", nombre: "Clasificación y atributos", icono: "Tag",
        queEs: "Dice qué es una imagen entera o un recorte: color de un auto, si una persona lleva casco o mochila.",
        paraQue: "\"Camioneta blanca\", \"moto con dos personas\", color del vehículo en las lecturas LPR que no lo traen.",
        libre: "SigLIP (Apache-2.0), compara la imagen con frases. Es también la base de la búsqueda.",
        estado: "libre",
    },
    {
        id: "vocabulario", nombre: "Vocabulario abierto", icono: "Sparkles",
        queEs: "Detectar cosas que no están en las 80 clases, pidiéndolas por texto: \"carretilla\", \"escalera\", \"bolsa de basura\".",
        paraQue: "Objetos propios de una obra o de un barrio que el modelo común no conoce.",
        libre: "OWLv2 o Grounding DINO (Apache-2.0). Son varias veces más lentos: no para cada cuadro, sí para buscar o para una regla puntual. YOLOE-26 hace lo mismo pero es AGPL.",
        estado: "pesado",
    },
    {
        id: "obb", nombre: "Cajas orientadas (OBB)", icono: "Move",
        queEs: "Cajas giradas, para objetos vistos desde arriba en cualquier ángulo.",
        paraQue: "Está pensado para fotos aéreas o de satélite (barcos, contenedores). Las cámaras del barrio miran de costado: no aporta.",
        libre: "No hace falta.",
        estado: "no-aplica",
    },
];

export type Grupo = "persona" | "vehiculo" | "animal" | "objeto" | "calle" | "casa" | "comida" | "deporte";

export const GRUPOS: { id: Grupo; nombre: string; icono: string }[] = [
    { id: "persona", nombre: "Personas", icono: "User" },
    { id: "vehiculo", nombre: "Vehículos", icono: "Car" },
    { id: "animal", nombre: "Animales", icono: "PawPrint" },
    { id: "objeto", nombre: "Bultos y objetos personales", icono: "Backpack" },
    { id: "calle", nombre: "Calle y mobiliario", icono: "TrafficCone" },
    { id: "casa", nombre: "Dentro de una casa", icono: "Sofa" },
    { id: "comida", nombre: "Comida y vajilla", icono: "Utensils" },
    { id: "deporte", nombre: "Deporte y juego", icono: "Volleyball" },
];

/**
 * Cuánto le importa la clase a un barrio. Decide si viene prendida: lo "poco útil" (una
 * banana, un cepillo de dientes) viene apagado para que la prueba no se llene de ruido.
 */
export type Relevancia = "clave" | "util" | "poco";

export type Clase = {
    /** Nombre COCO en inglés: es lo que devuelve omni-vision en `clase`. */
    clase: string;
    nombre: string;
    grupo: Grupo;
    icono: string;
    relevancia: Relevancia;
    /** Por qué importa (o por qué no), cuando hay algo que decir. */
    nota?: string;
};

export const CLASES: Clase[] = [
    { clase: "person", nombre: "Persona", grupo: "persona", icono: "User", relevancia: "clave", nota: "La clase más importante: confirma un cruce de línea, cuenta gente en una fila, detecta a alguien en una zona de noche. Es también la que el modelo mejor conoce." },

    { clase: "car", nombre: "Auto", grupo: "vehiculo", icono: "Car", relevancia: "clave", nota: "Confirma que pasó un vehículo aunque ninguna lectora lea la matrícula. Con \"camioneta\" suele aparecer como alternativa en la misma caja." },
    { clase: "truck", nombre: "Camión o camioneta", grupo: "vehiculo", icono: "Truck", relevancia: "clave", nota: "COCO junta pickups, furgones y camiones. Para separarlos hace falta atributos (SigLIP)." },
    { clase: "motorcycle", nombre: "Moto", grupo: "vehiculo", icono: "Bike", relevancia: "clave", nota: "Las cámaras de acceso cuentan \"Motorbike 0\": las motos sólo existen si paran. El detector las ve pasar." },
    { clase: "bicycle", nombre: "Bicicleta", grupo: "vehiculo", icono: "Bike", relevancia: "util" },
    { clase: "bus", nombre: "Ómnibus", grupo: "vehiculo", icono: "Bus", relevancia: "util", nota: "Transporte de personal o escolar." },
    { clase: "train", nombre: "Tren", grupo: "vehiculo", icono: "TrainFront", relevancia: "poco" },
    { clase: "boat", nombre: "Bote", grupo: "vehiculo", icono: "Sailboat", relevancia: "poco", nota: "Útil sólo si hay un trailer con lancha entrando." },
    { clase: "airplane", nombre: "Avión", grupo: "vehiculo", icono: "Plane", relevancia: "poco" },

    { clase: "dog", nombre: "Perro", grupo: "animal", icono: "Dog", relevancia: "clave", nota: "La causa más común de falsas alarmas perimetrales después de la gente que camina. Que el detector diga \"perro\" es lo que permite descartarla con fundamento." },
    { clase: "cat", nombre: "Gato", grupo: "animal", icono: "Cat", relevancia: "clave", nota: "Igual que el perro: explica una alarma que la cámara llamó \"persona\"." },
    { clase: "bird", nombre: "Pájaro", grupo: "animal", icono: "Bird", relevancia: "util", nota: "Un pájaro cerca del lente dispara detecciones de movimiento." },
    { clase: "horse", nombre: "Caballo", grupo: "animal", icono: "PawPrint", relevancia: "util", nota: "En zonas rurales o de chacras." },
    { clase: "cow", nombre: "Vaca", grupo: "animal", icono: "PawPrint", relevancia: "util" },
    { clase: "sheep", nombre: "Oveja", grupo: "animal", icono: "PawPrint", relevancia: "util" },
    { clase: "bear", nombre: "Oso", grupo: "animal", icono: "PawPrint", relevancia: "poco" },
    { clase: "elephant", nombre: "Elefante", grupo: "animal", icono: "PawPrint", relevancia: "poco" },
    { clase: "zebra", nombre: "Cebra", grupo: "animal", icono: "PawPrint", relevancia: "poco" },
    { clase: "giraffe", nombre: "Jirafa", grupo: "animal", icono: "PawPrint", relevancia: "poco" },

    { clase: "backpack", nombre: "Mochila", grupo: "objeto", icono: "Backpack", relevancia: "clave", nota: "Objetos dejados y búsqueda (\"persona con mochila\")." },
    { clase: "handbag", nombre: "Bolso", grupo: "objeto", icono: "Briefcase", relevancia: "clave" },
    { clase: "suitcase", nombre: "Valija", grupo: "objeto", icono: "Luggage", relevancia: "clave", nota: "Un bulto quieto en una zona marcada es la alarma de objeto dejado." },
    { clase: "umbrella", nombre: "Paraguas", grupo: "objeto", icono: "Umbrella", relevancia: "util", nota: "Explica siluetas raras en días de lluvia." },
    { clase: "cell phone", nombre: "Celular", grupo: "objeto", icono: "Smartphone", relevancia: "util", nota: "Chico: sólo se ve de cerca (consola, puesto de guardia)." },
    { clase: "tie", nombre: "Corbata", grupo: "objeto", icono: "Shirt", relevancia: "poco", nota: "Aparece como falso en franjas finas (un cable, un cordón). Apagada por eso." },
    { clase: "laptop", nombre: "Notebook", grupo: "objeto", icono: "Laptop", relevancia: "poco" },
    { clase: "book", nombre: "Libro", grupo: "objeto", icono: "Book", relevancia: "poco" },
    { clase: "scissors", nombre: "Tijera", grupo: "objeto", icono: "Scissors", relevancia: "poco" },
    { clase: "teddy bear", nombre: "Peluche", grupo: "objeto", icono: "Baby", relevancia: "poco" },
    { clase: "hair drier", nombre: "Secador de pelo", grupo: "objeto", icono: "Fan", relevancia: "poco" },
    { clase: "toothbrush", nombre: "Cepillo de dientes", grupo: "objeto", icono: "Brush", relevancia: "poco" },

    { clase: "traffic light", nombre: "Semáforo", grupo: "calle", icono: "TrafficCone", relevancia: "poco" },
    { clase: "stop sign", nombre: "Cartel de PARE", grupo: "calle", icono: "Octagon", relevancia: "poco" },
    { clase: "fire hydrant", nombre: "Hidrante", grupo: "calle", icono: "FireExtinguisher", relevancia: "poco" },
    { clase: "parking meter", nombre: "Parquímetro", grupo: "calle", icono: "ParkingMeter", relevancia: "poco" },
    { clase: "bench", nombre: "Banco", grupo: "calle", icono: "Armchair", relevancia: "util", nota: "Sirve de referencia fija: si deja de verse, algo lo tapa." },
    { clase: "potted plant", nombre: "Maceta", grupo: "calle", icono: "Flower2", relevancia: "poco" },

    { clase: "chair", nombre: "Silla", grupo: "casa", icono: "Armchair", relevancia: "poco" },
    { clase: "couch", nombre: "Sillón", grupo: "casa", icono: "Sofa", relevancia: "poco" },
    { clase: "bed", nombre: "Cama", grupo: "casa", icono: "Bed", relevancia: "poco" },
    { clase: "dining table", nombre: "Mesa", grupo: "casa", icono: "Table", relevancia: "poco" },
    { clase: "toilet", nombre: "Inodoro", grupo: "casa", icono: "Toilet", relevancia: "poco" },
    { clase: "tv", nombre: "Televisor", grupo: "casa", icono: "Tv", relevancia: "poco" },
    { clase: "mouse", nombre: "Mouse", grupo: "casa", icono: "Mouse", relevancia: "poco" },
    { clase: "remote", nombre: "Control remoto", grupo: "casa", icono: "TvMinimal", relevancia: "poco" },
    { clase: "keyboard", nombre: "Teclado", grupo: "casa", icono: "Keyboard", relevancia: "poco" },
    { clase: "microwave", nombre: "Microondas", grupo: "casa", icono: "Microwave", relevancia: "poco" },
    { clase: "oven", nombre: "Horno", grupo: "casa", icono: "CookingPot", relevancia: "poco" },
    { clase: "toaster", nombre: "Tostadora", grupo: "casa", icono: "CookingPot", relevancia: "poco" },
    { clase: "sink", nombre: "Pileta", grupo: "casa", icono: "Bath", relevancia: "poco" },
    { clase: "refrigerator", nombre: "Heladera", grupo: "casa", icono: "Refrigerator", relevancia: "poco" },
    { clase: "clock", nombre: "Reloj", grupo: "casa", icono: "Clock", relevancia: "poco" },
    { clase: "vase", nombre: "Florero", grupo: "casa", icono: "Flower", relevancia: "poco" },

    { clase: "bottle", nombre: "Botella", grupo: "comida", icono: "Milk", relevancia: "util", nota: "Botellas en la calle de noche: reuniones en zonas no permitidas." },
    { clase: "wine glass", nombre: "Copa", grupo: "comida", icono: "Wine", relevancia: "poco" },
    { clase: "cup", nombre: "Taza o vaso", grupo: "comida", icono: "Coffee", relevancia: "poco" },
    { clase: "fork", nombre: "Tenedor", grupo: "comida", icono: "Utensils", relevancia: "poco" },
    { clase: "knife", nombre: "Cuchillo", grupo: "comida", icono: "UtensilsCrossed", relevancia: "poco", nota: "No es un detector de armas: a la distancia de una cámara de calle no se ve. No usar para eso." },
    { clase: "spoon", nombre: "Cuchara", grupo: "comida", icono: "Utensils", relevancia: "poco" },
    { clase: "bowl", nombre: "Bol", grupo: "comida", icono: "Soup", relevancia: "poco" },
    { clase: "banana", nombre: "Banana", grupo: "comida", icono: "Banana", relevancia: "poco" },
    { clase: "apple", nombre: "Manzana", grupo: "comida", icono: "Apple", relevancia: "poco" },
    { clase: "sandwich", nombre: "Sándwich", grupo: "comida", icono: "Sandwich", relevancia: "poco" },
    { clase: "orange", nombre: "Naranja", grupo: "comida", icono: "Citrus", relevancia: "poco" },
    { clase: "broccoli", nombre: "Brócoli", grupo: "comida", icono: "Salad", relevancia: "poco" },
    { clase: "carrot", nombre: "Zanahoria", grupo: "comida", icono: "Carrot", relevancia: "poco" },
    { clase: "hot dog", nombre: "Pancho", grupo: "comida", icono: "Sandwich", relevancia: "poco" },
    { clase: "pizza", nombre: "Pizza", grupo: "comida", icono: "Pizza", relevancia: "poco" },
    { clase: "donut", nombre: "Dona", grupo: "comida", icono: "Donut", relevancia: "poco" },
    { clase: "cake", nombre: "Torta", grupo: "comida", icono: "Cake", relevancia: "poco" },

    { clase: "sports ball", nombre: "Pelota", grupo: "deporte", icono: "Volleyball", relevancia: "util", nota: "Niños jugando en la calle: explica movimiento en zonas perimetrales de día." },
    { clase: "skateboard", nombre: "Patineta", grupo: "deporte", icono: "Footprints", relevancia: "util" },
    { clase: "frisbee", nombre: "Frisbee", grupo: "deporte", icono: "Volleyball", relevancia: "poco" },
    { clase: "skis", nombre: "Esquíes", grupo: "deporte", icono: "MountainSnow", relevancia: "poco" },
    { clase: "snowboard", nombre: "Snowboard", grupo: "deporte", icono: "MountainSnow", relevancia: "poco" },
    { clase: "kite", nombre: "Cometa", grupo: "deporte", icono: "Wind", relevancia: "poco" },
    { clase: "baseball bat", nombre: "Bate", grupo: "deporte", icono: "Trophy", relevancia: "poco" },
    { clase: "baseball glove", nombre: "Guante de béisbol", grupo: "deporte", icono: "Hand", relevancia: "poco" },
    { clase: "surfboard", nombre: "Tabla de surf", grupo: "deporte", icono: "Waves", relevancia: "poco" },
    { clase: "tennis racket", nombre: "Raqueta", grupo: "deporte", icono: "Trophy", relevancia: "poco" },
];

export const CLASE_POR_NOMBRE: Record<string, Clase> = Object.fromEntries(CLASES.map((c) => [c.clase, c]));

export type EstadoAnalitica = "corre" | "desarrollo" | "posible";

export type Analitica = {
    id: string;
    nombre: string;
    icono: string;
    /** El modo de OmniAccess donde vive. */
    modo: "Intrusión" | "LPR" | "Face" | "Filas" | "Búsqueda" | "Prueba";
    queHace: string;
    /** Qué capacidades necesita (ids de CAPACIDADES). */
    necesita: string[];
    /** Qué clases mira (nombres COCO). */
    clases: string[];
    estado: EstadoAnalitica;
    /** La fase del plan OpenSpec, si está planificada. */
    fase?: number;
    /** Lo que nunca va a hacer, para que nadie lo espere. */
    limite?: string;
    /** Si viene prendida cuando nadie la tocó. */
    porDefecto: boolean;
};

export const ANALITICAS: Analitica[] = [
    {
        id: "prueba", nombre: "Prueba en vivo", icono: "ScanEye", modo: "Prueba",
        queHace: "Analiza el cuadro actual de una cámara y dibuja lo que ve, en esta misma pantalla. Es lo único que corre hoy.",
        necesita: ["deteccion"], clases: [], estado: "corre", porDefecto: true,
    },
    {
        id: "verif-intrusion", nombre: "Doble verificación de intrusión", icono: "ShieldCheck", modo: "Intrusión",
        queHace: "Cada cruce de línea o zona que manda la cámara se mira con el detector en ese instante: queda \"confirmada\", \"no confirmada\" o \"animal\", con las cajas dibujadas en la ficha.",
        necesita: ["deteccion"], clases: ["person", "car", "truck", "motorcycle", "bicycle", "dog", "cat", "bird"],
        estado: "desarrollo", fase: 1, porDefecto: true,
        limite: "Nunca acepta ni descarta una alarma sola: decide una persona.",
    },
    {
        id: "animal", nombre: "Animal en zona", icono: "Dog", modo: "Intrusión",
        queHace: "Avisa cuando en una zona dibujada hay un perro, gato o caballo y ninguna persona: perro suelto, animal en la piscina, caballo en la calle.",
        necesita: ["deteccion"], clases: ["dog", "cat", "horse", "cow", "sheep"], estado: "posible", porDefecto: false,
    },
    {
        id: "merodeo", nombre: "Merodeo", icono: "Footprints", modo: "Intrusión",
        queHace: "Una persona que se queda más de N minutos frente a un lote o que pasa varias veces por la misma cámara.",
        necesita: ["deteccion", "seguimiento"], clases: ["person"], estado: "posible", porDefecto: false,
    },
    {
        id: "persona-suelo", nombre: "Persona en el suelo", icono: "PersonStanding", modo: "Intrusión",
        queHace: "Alguien caído en la calle o en un espacio común, por la posición del cuerpo.",
        necesita: ["deteccion", "pose"], clases: ["person"], estado: "posible", porDefecto: false,
    },
    {
        id: "tipo-vehiculo", nombre: "Tipo de vehículo en lecturas", icono: "Car", modo: "LPR",
        queHace: "Cuando la lectora no trae el tipo, el detector dice auto, camioneta, moto u ómnibus en la foto de la lectura.",
        necesita: ["deteccion"], clases: ["car", "truck", "motorcycle", "bus", "bicycle"], estado: "desarrollo", fase: 2, porDefecto: true,
    },
    {
        id: "color-vehiculo", nombre: "Color del vehículo", icono: "Tag", modo: "LPR",
        queHace: "El color estimado del vehículo en cada lectura, para buscar \"el auto blanco que entró a las 3\".",
        necesita: ["deteccion", "clasificacion"], clases: ["car", "truck", "motorcycle"], estado: "desarrollo", fase: 2, porDefecto: true,
    },
    {
        id: "motos", nombre: "Conteo de motos", icono: "Bike", modo: "LPR",
        queHace: "Cuenta las motos que pasan por los accesos aunque no paren ni se lea su chapa.",
        necesita: ["deteccion"], clases: ["motorcycle"], estado: "desarrollo", fase: 2, porDefecto: true,
    },
    {
        id: "sin-lectura", nombre: "Vehículo sin lectura", icono: "ScanLine", modo: "LPR",
        queHace: "Pasó un vehículo por un acceso y ninguna lectora leyó su matrícula en ±10 s: queda registrado con foto.",
        necesita: ["deteccion"], clases: ["car", "truck", "motorcycle", "bus"], estado: "desarrollo", fase: 2, porDefecto: true,
    },
    {
        id: "colado", nombre: "Posible colado", icono: "Layers", modo: "LPR",
        queHace: "Dos vehículos pegados y una sola lectura: el segundo entró detrás del primero.",
        necesita: ["deteccion"], clases: ["car", "truck", "motorcycle"], estado: "desarrollo", fase: 2, porDefecto: true,
        limite: "Es un aviso para mirar la grabación, no una prueba.",
    },
    {
        id: "acompanado", nombre: "Persona acompañada", icono: "Users", modo: "Face",
        queHace: "Cuántas personas había en el punto de acceso cuando se reconoció una cara: alguien que pasa detrás.",
        necesita: ["deteccion"], clases: ["person"], estado: "desarrollo", fase: 2, porDefecto: true,
        limite: "No reconoce a nadie: el reconocimiento facial sigue siendo el de siempre.",
    },
    {
        id: "fila", nombre: "Conteo de fila", icono: "Users", modo: "Filas",
        queHace: "Personas dentro de una zona dibujada, para cámaras que no traen analítica de filas.",
        necesita: ["deteccion"], clases: ["person"], estado: "desarrollo", fase: 2, porDefecto: true,
    },
    {
        id: "busqueda", nombre: "Búsqueda de objetos", icono: "ScanSearch", modo: "Búsqueda",
        queHace: "Buscar en lo que vieron las cámaras por texto (\"camioneta blanca\", \"persona con mochila roja\") o por una foto, y abrir la grabación en ese instante. Como AcuSeek, sin depender del NVR.",
        necesita: ["deteccion", "clasificacion"], clases: ["person", "car", "truck", "motorcycle", "bicycle", "backpack", "handbag", "suitcase", "dog"],
        estado: "desarrollo", fase: 3, porDefecto: true,
    },
    {
        id: "dejados", nombre: "Objetos dejados", icono: "Luggage", modo: "Búsqueda",
        queHace: "Un bolso, mochila o valija que apareció en una zona marcada y quedó quieto más de N minutos.",
        necesita: ["deteccion", "seguimiento"], clases: ["backpack", "handbag", "suitcase"], estado: "desarrollo", fase: 3, porDefecto: false,
    },
];

/** Cómo viene cada interruptor cuando nadie lo tocó. */
export function analiticasPorDefecto(): Record<string, boolean> {
    return Object.fromEntries(ANALITICAS.map((a) => [a.id, a.porDefecto]));
}
export function clasesPorDefecto(): Record<string, boolean> {
    return Object.fromEntries(CLASES.map((c) => [c.clase, c.relevancia !== "poco"]));
}

/** Lo guardado encima de los valores por defecto; ignora claves que ya no existen. */
export function mezclar(defecto: Record<string, boolean>, guardado: unknown): Record<string, boolean> {
    const out = { ...defecto };
    if (guardado && typeof guardado === "object") {
        for (const [k, v] of Object.entries(guardado as Record<string, unknown>)) if (k in out && typeof v === "boolean") out[k] = v;
    }
    return out;
}
