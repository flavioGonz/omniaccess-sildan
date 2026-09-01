"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Code,
    Database,
    Webhook,
    GitBranch,
    Zap,
    FileCode,
    Server,
    Lock,
    RefreshCw,
    Upload,
    Download,
    Trash2,
    Play,
    Users,
    ScanFace,
    Search
} from "lucide-react";

export default function HikvisionDocsPage() {
    const [selectedTab, setSelectedTab] = useState("overview");

    return (
        <div className="min-h-screen bg-background p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-foreground uppercase tracking-tight mb-2">
                        Hikvision LPR Driver
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Documentación técnica completa del driver ISAPI para cámaras Hikvision LPR
                    </p>
                </div>

                <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
                    <TabsList className="bg-card border border-border">
                        <TabsTrigger value="overview" className="data-[state=active]:bg-blue-600">
                            <Server className="mr-2" size={16} />
                            Overview
                        </TabsTrigger>
                        <TabsTrigger value="apis" className="data-[state=active]:bg-blue-600">
                            <Code className="mr-2" size={16} />
                            APIs ISAPI
                        </TabsTrigger>
                        <TabsTrigger value="webhook" className="data-[state=active]:bg-blue-600">
                            <Webhook className="mr-2" size={16} />
                            Webhook Events
                        </TabsTrigger>
                        <TabsTrigger value="sync" className="data-[state=active]:bg-blue-600">
                            <RefreshCw className="mr-2" size={16} />
                            Sincronización
                        </TabsTrigger>
                        <TabsTrigger value="auth" className="data-[state=active]:bg-blue-600">
                            <Lock className="mr-2" size={16} />
                            Autenticación
                        </TabsTrigger>
                    </TabsList>

                    {/* OVERVIEW TAB */}
                    <TabsContent value="overview" className="space-y-6">
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-foreground flex items-center gap-2">
                                    <GitBranch size={20} />
                                    Arquitectura del Driver
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3">Componentes Principales</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <div className="flex items-start gap-3">
                                                <FileCode className="text-emerald-400 mt-1" size={16} />
                                                <div>
                                                    <p className="text-xs font-bold text-foreground">HikvisionDriver.ts</p>
                                                    <p className="text-[10px] text-muted-foreground">Driver principal ISAPI</p>
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-3">
                                                <Webhook className="text-orange-400 mt-1" size={16} />
                                                <div>
                                                    <p className="text-xs font-bold text-foreground">route.ts (webhook)</p>
                                                    <p className="text-[10px] text-muted-foreground">Receptor de eventos LPR</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex items-start gap-3">
                                                <Database className="text-purple-400 mt-1" size={16} />
                                                <div>
                                                    <p className="text-xs font-bold text-foreground">Prisma ORM</p>
                                                    <p className="text-[10px] text-muted-foreground">Persistencia de datos</p>
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-3">
                                                <Code className="text-blue-400 mt-1" size={16} />
                                                <div>
                                                    <p className="text-xs font-bold text-foreground">hikvision-codes.ts</p>
                                                    <p className="text-[10px] text-muted-foreground">Mapeo de códigos de vehículos</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3">Flujo de Datos</h3>
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-blue-600 text-foreground">1</Badge>
                                            <p className="text-xs text-muted-foreground">Cámara detecta matrícula → Genera evento ANPR</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-blue-600 text-foreground">2</Badge>
                                            <p className="text-xs text-muted-foreground">Cámara envía POST multipart/form-data al webhook</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-blue-600 text-foreground">3</Badge>
                                            <p className="text-xs text-muted-foreground">Webhook parsea XML + imagen, extrae metadatos</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-blue-600 text-foreground">4</Badge>
                                            <p className="text-xs text-muted-foreground">Busca credencial en DB → Decide GRANT/DENY</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-blue-600 text-foreground">5</Badge>
                                            <p className="text-xs text-muted-foreground">Guarda evento en DB + emite Socket.IO</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-blue-600 text-foreground">6</Badge>
                                            <p className="text-xs text-muted-foreground">Responde XML de confirmación a cámara</p>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* APIS TAB */}
                    <TabsContent value="apis" className="space-y-6">
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-foreground">Endpoints ISAPI Utilizados</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Add Plate */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Upload className="text-emerald-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Agregar Matrícula</h3>
                                        </div>
                                        <Badge className="bg-emerald-600 text-foreground">PUT</Badge>
                                    </div>
                                    <code className="text-[10px] text-blue-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        /ISAPI/Traffic/channels/1/licensePlateAuditData/record?format=json
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Agrega una matrícula a la lista blanca de la cámara</p>
                                    <details className="text-xs">
                                        <summary className="text-blue-400 cursor-pointer mb-2">Ver Payload</summary>
                                        <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                            {`{
  "LicensePlateInfoList": [{
    "LicensePlate": "ABC123",
    "listType": "whiteList",
    "createTime": "2024-01-01T10:00:00",
    "effectiveStartDate": "2024-01-01",
    "effectiveTime": "2034-01-01",
    "id": ""
  }]
}`}
                                        </pre>
                                    </details>
                                </div>

                                {/* Search Plates */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Download className="text-blue-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Buscar Matrículas</h3>
                                        </div>
                                        <Badge className="bg-blue-600 text-foreground">POST</Badge>
                                    </div>
                                    <code className="text-[10px] text-blue-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        /ISAPI/Traffic/channels/1/searchLPListAudit
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Obtiene matrículas de la lista blanca (paginado)</p>
                                    <details className="text-xs">
                                        <summary className="text-blue-400 cursor-pointer mb-2">Ver XML Request</summary>
                                        <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                            {`<?xml version="1.0" encoding="UTF-8"?>
<LPSearchCond>
  <searchID>abc123def456</searchID>
  <maxResult>400</maxResult>
  <searchResultPosition>0</searchResultPosition>
</LPSearchCond>`}
                                        </pre>
                                    </details>
                                    <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded">
                                        <p className="text-[10px] text-yellow-400">
                                            <strong>Nota:</strong> La cámara pagina resultados de 400 en 400. El driver itera automáticamente hasta obtener todas las matrículas.
                                        </p>
                                    </div>
                                </div>

                                {/* Delete Plate */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Trash2 className="text-red-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Eliminar Matrícula</h3>
                                        </div>
                                        <Badge className="bg-orange-600 text-foreground">PUT</Badge>
                                    </div>
                                    <code className="text-[10px] text-blue-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        /ISAPI/Traffic/channels/1/DelLicensePlateAuditData?format=json
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Elimina una o todas las matrículas</p>
                                    <details className="text-xs">
                                        <summary className="text-blue-400 cursor-pointer mb-2">Ver Payload</summary>
                                        <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                            {`// Eliminar una matrícula específica
{
  "id": ["ABC123"],
  "deleteAllEnabled": false
}

// Eliminar TODAS las matrículas
{
  "id": [],
  "deleteAllEnabled": true
}`}
                                        </pre>
                                    </details>
                                </div>

                                {/* Trigger Relay */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Play className="text-purple-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Activar Relé (Abrir Barrera)</h3>
                                        </div>
                                        <Badge className="bg-purple-600 text-foreground">PUT</Badge>
                                    </div>
                                    <code className="text-[10px] text-blue-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        /ISAPI/System/IO/outputs/1/trigger?format=json
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Activa el relé de salida para abrir barrera</p>
                                    <details className="text-xs">
                                        <summary className="text-blue-400 cursor-pointer mb-2">Ver Payload</summary>
                                        <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                            {`{
  "IOPortData": {
    "outputState": "high"
  }
}`}
                                        </pre>
                                    </details>
                                </div>

                                {/* Face Management (MinMoe) */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-4 block border-b border-border pb-2">Gestión Facial (MinMoe / Face Terminal)</h3>

                                    {/* 1. Add User */}
                                    <div className="mb-6">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Users className="text-emerald-400" size={16} />
                                                <h4 className="text-xs font-bold text-foreground">Crear Usuario</h4>
                                            </div>
                                            <Badge className="bg-emerald-600 text-foreground">POST</Badge>
                                        </div>
                                        <code className="text-[10px] text-blue-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                            /ISAPI/AccessControl/UserInfo/Record?format=json
                                        </code>
                                        <p className="text-[10px] text-muted-foreground mb-2">Crea el perfil base del usuario (Nombre, ID, Permisos) necesario antes de agregar el rostro.</p>
                                    </div>

                                    {/* 2. Add Face */}
                                    <div className="mb-6">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <ScanFace className="text-blue-400" size={16} />
                                                <h4 className="text-xs font-bold text-foreground">Agregar Rostro</h4>
                                            </div>
                                            <Badge className="bg-blue-600 text-foreground">POST</Badge>
                                        </div>
                                        <code className="text-[10px] text-blue-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                            /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json
                                        </code>
                                        <p className="text-[10px] text-muted-foreground mb-2">Asocia una imagen facial (URL externa o Binary Data) a un usuario existente mediante <code className="text-muted-foreground">FDID</code> (ID de librería facial).</p>
                                    </div>

                                    {/* 3. Search Face */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Search className="text-purple-400" size={16} />
                                                <h4 className="text-xs font-bold text-foreground">Buscar Rostros</h4>
                                            </div>
                                            <Badge className="bg-purple-600 text-foreground">POST</Badge>
                                        </div>
                                        <code className="text-[10px] text-blue-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                            /ISAPI/Intelligent/FDLib/FDSearch?format=json
                                        </code>
                                        <p className="text-[10px] text-muted-foreground">Busca en la librería facial del dispositivo para sincronización o validación.</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* WEBHOOK TAB */}
                    <TabsContent value="webhook" className="space-y-6">
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-foreground">Eventos Webhook ANPR</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3">Configuración del Webhook</h3>
                                    <div className="space-y-3">
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">URL del Webhook:</p>
                                            <code className="text-xs text-emerald-400 bg-black/40 px-2 py-1 rounded block">
                                                https://tu-servidor.com/api/webhooks/hikvision
                                            </code>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">Método:</p>
                                            <Badge className="bg-blue-600">POST</Badge>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">Content-Type:</p>
                                            <Badge className="bg-muted">multipart/form-data</Badge>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3">Estructura del Evento (XML)</h3>
                                    <details className="text-xs" open>
                                        <summary className="text-blue-400 cursor-pointer mb-3">Ver XML Completo</summary>
                                        <pre className="bg-black/60 p-4 rounded text-[10px] text-neutral-300 overflow-x-auto max-h-96">
                                            {`<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert>
  <ipAddress>192.168.1.100</ipAddress>
  <macAddress>01:17:24:45:D9:F4</macAddress>
  <dateTime>2024-12-30T10:21:53-03:00</dateTime>
  <eventType>ANPR</eventType>
  
  <ANPR>
    <licensePlate>AC725PX</licensePlate>
    <confidenceLevel>97</confidenceLevel>
    <direction>forward</direction>
    <vehicleType>SUVMPV</vehicleType>
    
    <vehicleInfo>
      <index>4295</index>
      <colorDepth>2</colorDepth>
      <color>blue</color>
      <vehicleLogoRecog>1037</vehicleLogoRecog>
      <vehileSubLogoRecog>0</vehileSubLogoRecog>
      <vehileModel>0</vehileModel>
    </vehicleInfo>
    
    <pictureInfoList>
      <pictureInfo>
        <fileName>licensePlatePicture.jpg</fileName>
        <type>licensePlatePicture</type>
      </pictureInfo>
      <pictureInfo>
        <fileName>vehiclePicture.jpg</fileName>
        <type>vehiclePicture</type>
      </pictureInfo>
    </pictureInfoList>
  </ANPR>
</EventNotificationAlert>`}
                                        </pre>
                                    </details>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3">Campos Importantes</h3>
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div className="font-bold text-muted-foreground">Campo</div>
                                            <div className="font-bold text-muted-foreground">Tipo</div>
                                            <div className="font-bold text-muted-foreground">Descripción</div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-xs border-t border-border pt-2">
                                            <code className="text-blue-400">licensePlate</code>
                                            <span className="text-muted-foreground">string</span>
                                            <span className="text-muted-foreground">Matrícula detectada</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-xs border-t border-border pt-2">
                                            <code className="text-blue-400">vehicleInfo.color</code>
                                            <span className="text-muted-foreground">string</span>
                                            <span className="text-muted-foreground">Color del vehículo (texto)</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-xs border-t border-border pt-2">
                                            <code className="text-blue-400">vehicleType</code>
                                            <span className="text-muted-foreground">string</span>
                                            <span className="text-muted-foreground">Tipo de vehículo (texto)</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-xs border-t border-border pt-2">
                                            <code className="text-blue-400">vehicleInfo.vehicleLogoRecog</code>
                                            <span className="text-muted-foreground">number</span>
                                            <span className="text-muted-foreground">Código de marca (numérico)</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-xs border-t border-border pt-2">
                                            <code className="text-blue-400">macAddress</code>
                                            <span className="text-muted-foreground">string</span>
                                            <span className="text-muted-foreground">MAC de la cámara</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-4">
                                    <h4 className="text-xs font-bold text-yellow-400 mb-2">⚠️ Importante</h4>
                                    <ul className="text-[10px] text-yellow-300 space-y-1 list-disc list-inside">
                                        <li>El color y tipo vienen como TEXTO directo ("blue", "SUVMPV")</li>
                                        <li>La marca viene como CÓDIGO NUMÉRICO (1037, 1060, etc.)</li>
                                        <li>Las imágenes vienen como archivos binarios en el multipart</li>
                                        <li>El webhook debe responder con XML de confirmación</li>
                                    </ul>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3">📋 Ejemplos Reales Capturados</h3>
                                    <p className="text-xs text-muted-foreground mb-4">Eventos ANPR reales procesados por el sistema</p>

                                    <div className="space-y-4">
                                        {/* Ejemplo 1: En Lista Blanca */}
                                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-emerald-600 text-foreground">✓ AUTORIZADO</Badge>
                                                <span className="text-xs text-emerald-400 font-bold">Matrícula en Lista Blanca</span>
                                            </div>
                                            <details className="text-xs">
                                                <summary className="text-emerald-400 cursor-pointer mb-2 font-bold">Ver JSON Completo</summary>
                                                <pre className="bg-black/60 p-3 rounded text-[9px] text-neutral-300 overflow-x-auto max-h-96">
                                                    {`{
  "country": 222,
  "licensePlate": "AC725PX",
  "line": 1,
  "direction": "forward",
  "confidenceLevel": 97,
  "plateType": "unknown",
  "plateColor": "unknown",
  "licenseBright": 63,
  "vehicleType": "SUVMPV",
  "vehicleInfo": {
    "index": 4295,
    "colorDepth": 2,
    "color": "blue",
    "length": 0,
    "vehicleLogoRecog": 1037,
    "vehileSubLogoRecog": 0,
    "vehileModel": 0
  },
  "vehicleListName": "allowList",
  "alarmDataType": 0,
  "originalLicensePlate": "AC725PX",
  "CRIndex": 222
}`}
                                                </pre>
                                            </details>
                                            <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Matrícula:</span>
                                                    <span className="text-foreground font-bold ml-2">AC725PX</span>
                                                </div>
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Lista:</span>
                                                    <span className="text-emerald-400 font-bold ml-2">allowList</span>
                                                </div>
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Color:</span>
                                                    <span className="text-blue-400 font-bold ml-2">blue</span>
                                                </div>
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Tipo:</span>
                                                    <span className="text-foreground font-bold ml-2">SUVMPV</span>
                                                </div>
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Marca (código):</span>
                                                    <span className="text-orange-400 font-bold ml-2">1037</span>
                                                </div>
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Confianza:</span>
                                                    <span className="text-emerald-400 font-bold ml-2">97%</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Ejemplo 2: NO en Lista Blanca */}
                                        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-red-600 text-foreground">✗ NO AUTORIZADO</Badge>
                                                <span className="text-xs text-red-400 font-bold">Matrícula NO en Lista Blanca</span>
                                            </div>
                                            <details className="text-xs">
                                                <summary className="text-red-400 cursor-pointer mb-2 font-bold">Ver JSON Completo</summary>
                                                <pre className="bg-black/60 p-3 rounded text-[9px] text-neutral-300 overflow-x-auto max-h-96">
                                                    {`{
  "country": 222,
  "licensePlate": "AH526CV",
  "line": 1,
  "direction": "forward",
  "confidenceLevel": 97,
  "plateType": "unknown",
  "plateColor": "unknown",
  "licenseBright": 82,
  "vehicleType": "SUVMPV",
  "vehicleInfo": {
    "index": 2292,
    "colorDepth": 1,
    "color": "gray",
    "length": 0,
    "vehicleLogoRecog": 1060,
    "vehileSubLogoRecog": 0,
    "vehileModel": 0
  },
  "vehicleListName": "otherList",
  "alarmDataType": 1,
  "originalLicensePlate": "AH526CV",
  "CRIndex": 222
}`}
                                                </pre>
                                            </details>
                                            <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Matrícula:</span>
                                                    <span className="text-foreground font-bold ml-2">AH526CV</span>
                                                </div>
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Lista:</span>
                                                    <span className="text-red-400 font-bold ml-2">otherList</span>
                                                </div>
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Color:</span>
                                                    <span className="text-muted-foreground font-bold ml-2">gray</span>
                                                </div>
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Tipo:</span>
                                                    <span className="text-foreground font-bold ml-2">SUVMPV</span>
                                                </div>
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Marca (código):</span>
                                                    <span className="text-orange-400 font-bold ml-2">1060</span>
                                                </div>
                                                <div className="bg-black/40 p-2 rounded">
                                                    <span className="text-muted-foreground">Confianza:</span>
                                                    <span className="text-emerald-400 font-bold ml-2">97%</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3">
                                            <h4 className="text-xs font-bold text-blue-400 mb-2">🔍 Diferencias Clave</h4>
                                            <ul className="text-[10px] text-blue-300 space-y-1 list-disc list-inside">
                                                <li><code className="text-blue-400">vehicleListName</code>: "allowList" vs "otherList"</li>
                                                <li><code className="text-blue-400">alarmDataType</code>: 0 (tiempo real) vs 1 (histórico)</li>
                                                <li>Ambos tienen 97% de confianza en la detección</li>
                                                <li>Los códigos de marca (1037, 1060) deben mapearse a nombres</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* SYNC TAB */}
                    <TabsContent value="sync" className="space-y-6">
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-foreground">Proceso de Sincronización</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-4">Flujo de Sincronización DB → Cámara</h3>
                                    <div className="space-y-4">
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-foreground font-bold text-xs">
                                                1
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-foreground mb-1">Obtener matrículas de la cámara</h4>
                                                <p className="text-[10px] text-muted-foreground">Se llama a <code className="text-blue-400">getPlatesFromCamera()</code> que itera paginando hasta obtener todas las matrículas</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-foreground font-bold text-xs">
                                                2
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-foreground mb-1">Obtener matrículas de la DB</h4>
                                                <p className="text-[10px] text-muted-foreground">Se consultan todas las credenciales tipo PLATE activas en Prisma</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-foreground font-bold text-xs">
                                                3
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-foreground mb-1">Comparar y calcular diferencias</h4>
                                                <p className="text-[10px] text-muted-foreground">
                                                    • <span className="text-emerald-400">Agregar:</span> Matrículas en DB pero no en cámara<br />
                                                    • <span className="text-red-400">Eliminar:</span> Matrículas en cámara pero no en DB
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-foreground font-bold text-xs">
                                                4
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-foreground mb-1">Aplicar cambios</h4>
                                                <p className="text-[10px] text-muted-foreground">Se ejecutan las operaciones PUT/DELETE necesarias en la cámara</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3">Paginación de Matrículas</h3>
                                    <p className="text-xs text-muted-foreground mb-3">
                                        La cámara Hikvision devuelve un máximo de 400 matrículas por página. El driver implementa paginación automática:
                                    </p>
                                    <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                        {`while (keep_fetching) {
  const response = await searchLPListAudit(searchId, start, 400);
  plates.push(...response.plates);
  
  if (response.isLastPage || plates.length >= totalMatches) {
    break;
  }
  
  start += 400;
}`}
                                    </pre>
                                </div>

                                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-4">
                                    <h4 className="text-xs font-bold text-emerald-400 mb-2">✅ Ventajas del Sistema</h4>
                                    <ul className="text-[10px] text-emerald-300 space-y-1 list-disc list-inside">
                                        <li>Sincronización bidireccional automática</li>
                                        <li>Detección de duplicados y normalización</li>
                                        <li>Manejo robusto de errores de red</li>
                                        <li>Progress tracking en tiempo real</li>
                                    </ul>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* AUTH TAB */}
                    <TabsContent value="auth" className="space-y-6">
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-foreground">Autenticación ISAPI</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3">Métodos Soportados</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-black/40 p-3 rounded border border-neutral-800">
                                            <h4 className="text-xs font-bold text-foreground mb-2">Basic Auth</h4>
                                            <p className="text-[10px] text-muted-foreground mb-2">Codificación Base64 de usuario:contraseña</p>
                                            <code className="text-[10px] text-blue-400 block">
                                                Authorization: Basic YWRtaW46MTIzNDU=
                                            </code>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded border border-neutral-800">
                                            <h4 className="text-xs font-bold text-foreground mb-2">Digest Auth (Recomendado)</h4>
                                            <p className="text-[10px] text-muted-foreground mb-2">Challenge-response con MD5</p>
                                            <code className="text-[10px] text-blue-400 block break-all">
                                                Authorization: Digest username="admin"...
                                            </code>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3">Flujo Digest Authentication</h3>
                                    <div className="space-y-3">
                                        <div className="flex items-start gap-3">
                                            <Badge className="bg-muted">1</Badge>
                                            <div>
                                                <p className="text-xs text-foreground font-bold">Request Inicial</p>
                                                <p className="text-[10px] text-muted-foreground">Cliente envía request sin autenticación</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <Badge className="bg-muted">2</Badge>
                                            <div>
                                                <p className="text-xs text-foreground font-bold">401 Challenge</p>
                                                <p className="text-[10px] text-muted-foreground">Servidor responde con WWW-Authenticate header conteniendo realm, nonce, qop</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <Badge className="bg-muted">3</Badge>
                                            <div>
                                                <p className="text-xs text-foreground font-bold">Calcular Response</p>
                                                <p className="text-[10px] text-muted-foreground">Cliente calcula MD5 hash usando credenciales + nonce</p>
                                                <pre className="bg-black/60 p-2 rounded text-[9px] text-neutral-300 mt-1 overflow-x-auto">
                                                    {`HA1 = MD5(username:realm:password)
HA2 = MD5(method:uri)
response = MD5(HA1:nonce:nc:cnonce:qop:HA2)`}
                                                </pre>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <Badge className="bg-muted">4</Badge>
                                            <div>
                                                <p className="text-xs text-foreground font-bold">Retry con Auth</p>
                                                <p className="text-[10px] text-muted-foreground">Cliente reenvía request con Authorization header completo</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <Badge className="bg-emerald-600">5</Badge>
                                            <div>
                                                <p className="text-xs text-foreground font-bold">200 OK</p>
                                                <p className="text-[10px] text-muted-foreground">Servidor valida y responde con datos solicitados</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-blue-500/10 border border-blue-500/20 rounded p-4">
                                    <h4 className="text-xs font-bold text-blue-400 mb-2">💡 Implementación en el Driver</h4>
                                    <p className="text-[10px] text-blue-300 mb-2">
                                        El driver implementa automáticamente el flujo completo de Digest Auth:
                                    </p>
                                    <ul className="text-[10px] text-blue-300 space-y-1 list-disc list-inside">
                                        <li>Detecta 401 y parsea WWW-Authenticate</li>
                                        <li>Calcula response MD5 automáticamente</li>
                                        <li>Reintenta request con credenciales</li>
                                        <li>Maneja qop="auth" y algoritmo MD5</li>
                                    </ul>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
