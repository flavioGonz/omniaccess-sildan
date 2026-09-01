const { XMLParser } = require("fast-xml-parser");
const { uploadToS3 } = require("../lib-s3");
const { getVehicleColorName, getVehicleBrandName } = require("../hikvision-codes");
const {
    isDuplicate, addDebugLog, isValidImage,
    formatEventDate, sanitizeName, generateId, parseMultipart,
    debounceCache, DEBOUNCE_TIME,
} = require("./shared");

/**
 * Handle Hikvision LPR and Face webhooks.
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 * @param {string} logPrefix - Log prefix for tracing
 * @param {Object} deps - { prisma, io, sendPushToAll, fetchCameraSnapshot }
 */
const handleWebhook = async (req, res, logPrefix, deps) => {
    const { prisma, io, sendPushToAll, fetchCameraSnapshot, adoptDevice } = deps;
    try {
        const contentType = req.headers['content-type'] || "";

        // Initial placeholder for debug data
        let debugData = {
            id: Date.now().toString(),
            timestamp: new Date(),
            source: 'hikvision',
            method: req.method,
            url: req.url,
            params: { contentType },
            credentialValue: null
        };

        let xmlContent = "";
        let jsonContent = "";
        let images = [];

        if (contentType.includes("multipart/form-data")) {
            const parsed = await parseMultipart(req);
            xmlContent = parsed.xmlContent;
            jsonContent = parsed.jsonContent;
            images = parsed.images;
        } else {
            const buffers = [];
            for await (const chunk of req) {
                buffers.push(chunk);
            }
            const rawBody = Buffer.concat(buffers).toString();
            if (rawBody.trim().startsWith("<")) {
                xmlContent = rawBody;
            } else if (rawBody.trim().startsWith("{")) {
                jsonContent = rawBody;
            }
        }

        if (!xmlContent && !jsonContent) {
            console.error(`${logPrefix} No XML or JSON metadata received`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: "No XML/JSON metadata found" }));
            return;
        }

        // ==========================================
        // PATH A: JSON Content (Likely Face Event)
        // ==========================================
        // Check if it matches FACE event structure
        let jsonData = null;
        let isFaceEvent = false;
        if (jsonContent) {
            try {
                jsonData = JSON.parse(jsonContent);
                // Check if it contains Face Detection data
                const keys = Object.keys(jsonData);
                const hasFaceKeys = jsonData.alarmResult?.[0]?.faces || jsonData.faceMatchResult || jsonData.faces || jsonData.FaceInfo || jsonData.faceInfo;
                // Also check eventType
                const evtType = jsonData.eventType || jsonData.alarmResult?.eventType;

                if (hasFaceKeys || (evtType && evtType.toLowerCase().includes('face'))) {
                    isFaceEvent = true;
                } else {
                }
            } catch (e) {
                console.error(`${logPrefix} [Hik] JSON parse error: ${e.message}. Falling back to XML/LPR.`);
            }
        }

        // ==========================================
        // PATH A: JSON Content (Likely Face Event)
        // ==========================================
        if (isFaceEvent && jsonData) {

            // Normalización de Datos de Rostro
            const alarmData = jsonData.alarmResult?.[0] || jsonData.faceMatchResult || jsonData;
            const faceData = alarmData.faces?.[0] || alarmData.faceInfo || {};
            const identifyData = faceData.identify?.[0] || {};
            const candidate = identifyData.candidate?.[0] || {}; // Mejor coincidencia

            // Determinar Tipo de Evento
            const eventType = jsonData.eventType || alarmData.eventType || "faceCapture";
            // Lógica de Matching
            const isMatch = candidate.similarity && candidate.similarity > 70; // Hard threshold or just existence? 
            // The user said: "Solo debes almacenar los rostros que coinciden con la lista". 
            // Often un-matched faces have no candidate or very low similarity.
            // Hikvision usually sends 'blackList' or 'whiteList' type if matched.

            const personName = (candidate.reserve_field?.name || candidate.name || "").trim();
            const similarity = candidate.similarity ? Math.floor(candidate.similarity * 100) : 0;


            // --- FILTER: Only Store Matches ---
            // Removed filter to allow capturing and displaying all faces including unknown subjects
            if (!personName || personName === "msg.unknown" || personName === "unknown" || personName === "") {
            }

            // Debug Data Enrichment
            // debugData.credentialValue = personName;
            // debugData.status = 200;

            // --- Find Device ---
            const macAddress = jsonData.macAddress || alarmData.macAddress || jsonData.mac || null;
            const ipAddress = jsonData.ipAddress || alarmData.ipAddress || jsonData.ip || null;
            const eventTimestamp = jsonData.dateTime ? new Date(jsonData.dateTime) : new Date();

            const normalizeMac = (m) => m ? m.replace(/[:-\s]/g, "").toUpperCase() : null;
            let device = null;
            const cleanIncomingMac = normalizeMac(macAddress);

            if (cleanIncomingMac) {
                const allDevices = await prisma.device.findMany();
                device = allDevices.find(d => normalizeMac(d.mac) === cleanIncomingMac);
            }
            if (!device && ipAddress) {
                device = await prisma.device.findFirst({ where: { ip: ipAddress } });
            }

            if (!device) {
                device = await adoptDevice(macAddress, ipAddress || req.socket.remoteAddress, 'HIKVISION', 'FACE_TERMINAL');
            }

            // --- Process Images (Full vs Face) ---
            let fullImagePath = null;
            let faceImagePath = null;
            const eventId = generateId();

            if (images.length > 0) {
                // Improved Image Classification based on Field Name
                // Hikvision usually sends 'FaceImage' and 'BackgroundImage'
                let fullImg = images.find(img => img.name && (img.name.toLowerCase().includes('background') || img.name.toLowerCase().includes('scene') || img.name.toLowerCase().includes('full')));
                let faceImg = images.find(img => img.name && (img.name.toLowerCase().includes('face') || img.name.toLowerCase().includes('tracking') || img.name.toLowerCase().includes('capture') || img.name.toLowerCase().includes('snap')));

                // Fallback: Sort by size (Largest = Full, Smallest = Face)
                if (!fullImg || !faceImg) {
                    images.sort((a, b) => b.size - a.size);
                    if (!fullImg) fullImg = images[0];
                    if (!faceImg && images.length > 1) {
                        faceImg = images.find(img => img !== fullImg) || images[1];
                    }
                }

                try {
                    const devName = sanitizeName(device?.name);
                    const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                    const fDate = formatEventDate(eventTimestamp);

                    // Upload Full (Using 'face' bucket for all face recognition events)
                    const fnameFull = `hik-face-${devName}-${direction}-${fDate}-${eventId}-full.jpg`;
                    fullImagePath = await uploadToS3(fullImg.buffer, fnameFull, fullImg.mimeType, "face");

                    // Upload Face Crop (if exists)
                    if (faceImg) {
                        const fnameFace = `hik-face-${devName}-${direction}-${fDate}-${eventId}-crop.jpg`;
                        faceImagePath = await uploadToS3(faceImg.buffer, fnameFace, faceImg.mimeType, "face");
                    }
                } catch (imgError) {
                    console.error(`${logPrefix} [S3] Upload FAILED: ${imgError.message}`);
                }
            }

            // --- Find User (if matched) ---
            let credentialId = null;
            let userId = null;
            // let user = null; // Defined in prisma block below

            // Try to find the user in our DB by name
            const user = await prisma.user.findFirst({ where: { name: personName } });
            if (user) {
                userId = user.id;
                // Find or create a FACE credential placeholder if needed
                const cred = await prisma.credential.findFirst({ where: { userId: user.id, type: 'FACE' } });
                if (cred) credentialId = cred.id;
            }

            // --- Check System Mode for Face ---
            const modeSetting = await prisma.setting.findUnique({ where: { key: 'MODE_FACE' } });
            const mode = modeSetting?.value || 'WHITELIST'; // Default to Whitelist

            let finalDecision = "GRANT";
            if (mode === 'BLACKLIST') {
                finalDecision = "DENY";
            } else {
            }

            // --- Create Event ---
            const event = await prisma.accessEvent.create({
                data: {
                    id: eventId,
                    deviceId: device ? device.id : null,
                    credentialId,
                    userId,
                    timestamp: eventTimestamp,
                    accessType: 'FACE',
                    direction: device?.direction || "ENTRY",
                    decision: finalDecision, // Dynamic Decision
                    snapshotPath: faceImagePath || fullImagePath, // Store FACE crop as main snapshot if available
                    imagePath: fullImagePath || faceImagePath, // Store FULL scene as context
                    plateDetected: null,
                    plateNumber: null,
                    // Store extra details including Face Crop Path
                    details: `Modo: Rostro, Persona: ${personName || "Desconocido"}, CamMatch: ${similarity}% (Local: ${mode})`
                }
            });

            // --- Notify UI ---
            if (global.io) {
                io.emit("access_event", {
                    ...event,
                    device,
                    user: user || { name: personName },
                    direction: event.direction,
                    brand: 'HIKVISION',
                    userName: personName || user?.name || "Desconocido"
                });
                // Emit webhook event for topology animation
                io.emit("webhook-event", {
                    type: "FACE",
                    device: device?.name || "Unknown",
                    timestamp: new Date().toISOString()
                });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: "processed", type: "FACE", decision: finalDecision }));
            return;
        }

        // ==========================================
        // PATH B: XML Content (LPR / ANPR)
        // ==========================================

        // Parse XML
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const xmlData = parser.parse(xmlContent);

        // DEBUG: Log the keys of the parsed XML to see the structure

        // Extract Data
        let eventAlert = xmlData.EventNotificationAlert || xmlData;

        // If it's a nested structure like { EventNotificationAlert: { ... } }
        if (xmlData.EventNotificationAlert) {
            eventAlert = xmlData.EventNotificationAlert;
        }

        const macAddress = xmlData.macAddress || eventAlert.macAddress || eventAlert.ANPR?.macAddress || eventAlert['@_macAddress'];
        const ipAddress = xmlData.ipAddress || eventAlert.ipAddress || eventAlert.ANPR?.ipAddress || eventAlert['@_ipAddress'];

        const plateNumber = xmlData.ANPR?.licensePlate ||
            eventAlert.ANPR?.licensePlate ||
            xmlData.licensePlate ||
            eventAlert.licensePlate ||
            xmlData.EventNotificationAlert?.ANPR?.licensePlate;

        // --- HANDLE HIKVISION NON-EVENT MESSAGES (Heartbeats / Tests / Stun) ---
        const eventType = xmlData.eventType || eventAlert.eventType || "";
        const isHeartbeat = eventType.toLowerCase().includes('heartbeat') ||
            xmlContent.toLowerCase().includes('heartbeat') ||
            xmlContent.toLowerCase().includes('stun');

        // Check for ANPR Data presence to determine if it's a vehicle event despite missing plate
        const hasAnprData = xmlData.ANPR || eventAlert.ANPR || xmlData.EventNotificationAlert?.ANPR || eventAlert.vehicleInfo;

        if (!plateNumber && !hasAnprData) {
            if (isHeartbeat) {
                // UPDATE: Track push connection for heartbeats too
                const cleanIncomingMac = macAddress ? macAddress.replace(/[:-\s]/g, "").toUpperCase() : null;
                if (cleanIncomingMac || ipAddress) {
                    await prisma.device.updateMany({
                        where: {
                            OR: [
                                { mac: { contains: cleanIncomingMac } },
                                { ip: ipAddress }
                            ]
                        },
                        data: { lastOnlinePush: new Date() }
                    }).catch(e => console.error(`${logPrefix} Error updating heartbeat: ${e.message}`));
                }

                // Return silently for heartbeats - no log spam, no socket emission
                res.writeHead(200);
                res.end(JSON.stringify({ status: "ok", type: "heartbeat" }));
                return;
            }

            // If it's a known non-plate message, we don't log or emit debug to avoid spam
            // addDebugLog({ ...debugData, status: 200, credentialValue: "NON-ANPR" });

            console.warn(`${logPrefix} ℹ️ Webhook received without plate (possible test or non-ANPR event)`);
            res.writeHead(200);
            res.end(JSON.stringify({ status: "ok", message: "Ignored: No plate found" }));
            return;
        }

        // Enrich debug data with the plate

        // Extraer Metadatos Adicionales (Color, Tipo, Marca, Decisión de Cámara)
        // Hikvision guarda la info del vehículo en el objeto vehicleInfo
        const vehicleInfo = xmlData.ANPR?.vehicleInfo || eventAlert.ANPR?.vehicleInfo || {};

        // Extraer color - Hikvision envía AMBOS: código numérico Y texto
        const colorCode = vehicleInfo.colorDepth ||
            vehicleInfo.vehicleColor ||
            xmlData.ANPR?.vehicleColor ||
            eventAlert.ANPR?.vehicleColor;

        const colorText = vehicleInfo.color ||
            xmlData.ANPR?.color ||
            eventAlert.ANPR?.color;

        const brandCode = vehicleInfo.vehicleLogoRecog ||
            vehicleInfo.vehicleLogo ||
            vehicleInfo.vehicleBrand ||
            vehicleInfo.brand ||
            xmlData.ANPR?.vehicleLogo ||
            eventAlert.ANPR?.vehicleLogo ||
            xmlData.ANPR?.vehicleBrand ||
            eventAlert.ANPR?.vehicleBrand;

        // Mapeo de colores en inglés a español
        const COLOR_TEXT_MAP = {
            'white': 'Blanco',
            'silver': 'Plateado',
            'gray': 'Gris',
            'grey': 'Gris',
            'black': 'Negro',
            'red': 'Rojo',
            'blue': 'Azul',
            'darkblue': 'Azul Oscuro',
            'yellow': 'Amarillo',
            'green': 'Verde',
            'brown': 'Marrón',
            'pink': 'Rosa',
            'purple': 'Púrpura',
            'cyan': 'Cian',
            'orange': 'Naranja'
        };

        // Priorizar el texto directo sobre el código numérico
        let vehicleColor = "Unknown";
        if (colorText && COLOR_TEXT_MAP[colorText.toLowerCase()]) {
            vehicleColor = COLOR_TEXT_MAP[colorText.toLowerCase()];
        } else if (colorCode) {
            vehicleColor = getVehicleColorName(colorCode);
        }

        const vehicleBrand = brandCode ? getVehicleBrandName(brandCode) : "Unknown";

        const vehicleType = xmlData.ANPR?.vehicleType || eventAlert.ANPR?.vehicleType || "Unknown";

        const vehicleModel = vehicleInfo.vehicleModel ||
            vehicleInfo.vehileModel || // Typo en la API de Hikvision
            vehicleInfo.model ||
            xmlData.ANPR?.vehicleModel ||
            eventAlert.ANPR?.vehicleModel ||
            "Unknown";

        // Guardar TODOS los datos ANPR para futuras implementaciones
        const rawAnprData = {
            ...eventAlert.ANPR,
            vehicleInfo: vehicleInfo,
            codes: {
                colorCode,
                colorText,
                brandCode
            }
        };

        // DEBUG: Log all ANPR fields to identify correct field names

        // Match Info desde la cámara (Si la cámara ya decidió)
        // Estructura usual: eventAlert.ANPR.originalLicensePlate o matches...
        // A veces viene en <ListName> o <ListType> dentro de matchInfo
        // Buscamos en varios lugares posibles según firmware

        let cameraDecision = null;

        // Método 1: Buscar en matches/matchInfo
        const matchList = eventAlert.ANPR?.matches || eventAlert.matches || eventAlert.ANPR?.matchInfo || eventAlert.matchInfo;
        if (matchList) {
            // Puede ser un array o un objeto único
            const matchInfo = Array.isArray(matchList) ? matchList[0] : matchList;

            if (matchInfo) {
                // Verificar diferentes variantes de campo
                const listType = matchInfo.listType || matchInfo.ListType || matchInfo.type;
                const listName = matchInfo.listName || matchInfo.ListName || matchInfo.name;


                if (listType === 'whiteList' || listType === 'WhiteList' || listName === 'whiteList' || listName === 'WhiteList') {
                    cameraDecision = "GRANT";
                } else if (listType === 'blackList' || listType === 'BlackList' || listName === 'blackList' || listName === 'BlackList') {
                    cameraDecision = "DENY";
                }
            }
        }

        // Método 2: Buscar directamente en ANPR
        if (!cameraDecision) {
            const anprListType = eventAlert.ANPR?.listType || eventAlert.ANPR?.ListType;
            const anprListName = eventAlert.ANPR?.listName || eventAlert.ANPR?.ListName;
            const vehicleListName = eventAlert.ANPR?.vehicleListName; // Campo específico de Hikvision

            if (anprListType || anprListName || vehicleListName) {

                // Verificar vehicleListName primero (más específico)
                if (vehicleListName) {
                    const listNameLower = vehicleListName.toLowerCase();
                    if (listNameLower.includes('white') || listNameLower.includes('allow') || listNameLower.includes('blanca') || listNameLower.includes('permitida')) {
                        cameraDecision = "GRANT";
                    } else if (listNameLower.includes('black') || listNameLower.includes('block') || listNameLower.includes('negra') || listNameLower.includes('bloqueada')) {
                        cameraDecision = "DENY";
                    } else if (listNameLower.includes('other')) {
                    }
                }

                // Si no se detectó por vehicleListName, verificar otros campos
                if (!cameraDecision && (anprListType === 'whiteList' || anprListType === 'WhiteList' || anprListName === 'whiteList' || anprListName === 'WhiteList')) {
                    cameraDecision = "GRANT";
                } else if (!cameraDecision && (anprListType === 'blackList' || anprListType === 'BlackList' || anprListName === 'blackList' || anprListName === 'BlackList')) {
                    cameraDecision = "DENY";
                }
            }
        }

        if (!cameraDecision) {
        }

        const cleanPlate = (plateNumber || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
        const isUnknown = cleanPlate === "UNKNOWN" || cleanPlate === "";
        const finalPlate = isUnknown ? "NO_LEIDA" : cleanPlate;

        // Enrich debug data with the plate
        debugData.credentialValue = finalPlate;

        // Timestamp
        let eventTimestamp = new Date();
        const cameraDateTime = xmlData.dateTime || eventAlert.dateTime;
        if (cameraDateTime) {
            try {
                eventTimestamp = new Date(cameraDateTime);
            } catch (e) {
                eventTimestamp = new Date();
            }
        }

        // Debounce
        const now = Date.now();
        const lastSeen = debounceCache.get(finalPlate);
        if (lastSeen && now - lastSeen < DEBOUNCE_TIME) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: "Debounced", plate: finalPlate }));
            return;
        }
        debounceCache.set(finalPlate, now);

        // Helper to normalize MAC (removes colons, dashes, and makes uppercase)
        const normalizeMac = (m) => m ? m.replace(/[:-\s]/g, "").toUpperCase() : m;

        // Find Device - Strategic lookup (MOVED UP)
        let device = null;
        const cleanIncomingMac = normalizeMac(macAddress);

        if (cleanIncomingMac) {
            const allDevices = await prisma.device.findMany();
            device = allDevices.find(d => normalizeMac(d.mac) === cleanIncomingMac);
        }

        if (!device && ipAddress) {
            device = await prisma.device.findFirst({ where: { ip: ipAddress } });
        }

        if (!device) {
            // Last resort: find any Hikvision device if we only have one
            const hikDevices = await prisma.device.findMany({ where: { brand: 'HIKVISION' } });
            if (hikDevices.length === 1) {
                device = hikDevices[0];
            }
        }

        if (!device) {
            device = await adoptDevice(macAddress, ipAddress || req.socket.remoteAddress, 'HIKVISION', 'LPR_CAMERA');
        }

        // UPDATE: Track push connection for actual events
        if (device) {
            await prisma.device.update({
                where: { id: device.id },
                data: { lastOnlinePush: new Date() }
            }).catch(e => { });
        }

        // Save Image to S3 (MinIO)
        let relativeImagePath = null;
        const eventId = generateId();

        // Sort images by size to pick the largest (Full Scene) instead of the crop
        if (images.length > 1) {
            images.sort((a, b) => b.size - a.size);
        }
        const imageFile = images.length > 0 ? images[0] : null;

        if (imageFile) {
            try {
                const devName = sanitizeName(device?.name);
                const direction = (device?.direction === 'EXIT' ? 'salida' : 'entrada');
                const fDate = formatEventDate(eventTimestamp);

                const filename = `hik-lpr-${devName}-${direction}-${fDate}-${eventId}.jpg`;
                relativeImagePath = await uploadToS3(imageFile.buffer, filename, imageFile.mimeType || "image/jpeg", "lpr");
            } catch (imgError) {
                console.error(`${logPrefix} [S3] Upload FAILED: ${imgError.message}`);
            }
        } else {
            console.warn(`${logPrefix} [S3] Skip upload: No image part in webhook. Images length: ${images.length}`);
        }

        // Finalize debug emission for ACTUAL events
        // addDebugLog({
        //     ...debugData,
        //     status: 200,
        //     deviceName: device?.name,
        //     deviceMac: macAddress || device?.mac
        // });

        // Create Event Logic
        // ACCESS LOGIC: Prioritize Camera Decision (allowList/whiteList)
        // Fallback to local DB if camera doesn't provide decision
        let accessDecision = cameraDecision;
        let credentialId = null;
        let userId = null;

        // Search for plate in local database to enrich event and as fallback
        const credential = !isUnknown ? await prisma.credential.findFirst({
            where: {
                type: 'PLATE',
                value: finalPlate
            },
            include: { user: true }
        }) : null;

        if (credential) {
            const user = credential.user;
            credentialId = credential.id;
            userId = user.id;

            // --- Check System Mode for LPR ---
            const modeSetting = await prisma.setting.findUnique({ where: { key: 'MODE_LPR' } });
            const mode = modeSetting?.value || 'WHITELIST';

            if (mode === 'BLACKLIST') {
                accessDecision = "DENY";
            } else {
                if (!accessDecision) {
                    accessDecision = "GRANT";
                }
            }
        } else {
            if (!accessDecision) {
                accessDecision = "DENY";
            } else {
            }
        }


        // Persist Event
        const event = await prisma.accessEvent.create({
            data: {
                id: eventId,
                deviceId: device ? device.id : null,
                credentialId,
                userId,
                timestamp: eventTimestamp,
                accessType: 'PLATE',
                direction: device?.direction || "ENTRY",
                decision: accessDecision || "DENY", // If still null after DB check, default to DENY
                snapshotPath: relativeImagePath,
                plateNumber: finalPlate,
                plateDetected: finalPlate, // Ensure we fill both
                details: `${isUnknown ? 'ALERTA: Matrícula No Reconocida. ' : ''}Marca: ${vehicleBrand}, Modelo: ${vehicleModel}, Color: ${vehicleColor}, Tipo: ${vehicleType}, Source: ${cameraDecision ? 'Camera' : 'Server'}`
            }
        });


        // Notify UI
        if (global.io) {
            io.emit("access_event", {
                ...event,
                device,
                user: credential ? credential.user : null,
                direction: event.direction // Ensure direction is explicitly sent
            });
            // Emit webhook event for topology animation
            io.emit("webhook-event", {
                type: "LPR",
                device: device?.name || "Unknown",
                plate: cleanPlate,
                timestamp: new Date().toISOString()
            });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: "processed", decision: accessDecision }));

    } catch (error) {
        console.error(`${logPrefix} Webhook Error:`, error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
}


module.exports = { handleWebhook };
