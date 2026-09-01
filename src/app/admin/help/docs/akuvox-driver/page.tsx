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
    CreditCard,
    Image as ImageIcon
} from "lucide-react";

export default function AkuvoxDocsPage() {
    const [selectedTab, setSelectedTab] = useState("overview");

    return (
        <div className="min-h-screen bg-background p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-foreground uppercase tracking-tight mb-2">
                        Akuvox Access Control Driver
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Documentación técnica completa del driver HTTP API para dispositivos Akuvox
                    </p>
                </div>

                <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
                    <TabsList className="bg-card border border-border">
                        <TabsTrigger value="overview" className="data-[state=active]:bg-purple-600">
                            <Server className="mr-2" size={16} />
                            Overview
                        </TabsTrigger>
                        <TabsTrigger value="apis" className="data-[state=active]:bg-purple-600">
                            <Code className="mr-2" size={16} />
                            APIs HTTP
                        </TabsTrigger>
                        <TabsTrigger value="webhook" className="data-[state=active]:bg-purple-600">
                            <Webhook className="mr-2" size={16} />
                            Webhook Events
                        </TabsTrigger>
                        <TabsTrigger value="face-capture" className="data-[state=active]:bg-blue-600">
                            <ImageIcon className="mr-2" size={16} />
                            Captura de Rostros
                        </TabsTrigger>
                        <TabsTrigger value="troubleshooting" className="data-[state=active]:bg-red-600">
                            <Zap className="mr-2" size={16} />
                            Troubleshooting
                        </TabsTrigger>
                        <TabsTrigger value="sync" className="data-[state=active]:bg-purple-600">
                            <RefreshCw className="mr-2" size={16} />
                            Sincronización
                        </TabsTrigger>
                        <TabsTrigger value="auth" className="data-[state=active]:bg-purple-600">
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
                                    <h3 className="text-sm font-bold text-purple-400 mb-3">Componentes Principales</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <div className="flex items-start gap-3">
                                                <FileCode className="text-emerald-400 mt-1" size={16} />
                                                <div>
                                                    <p className="text-xs font-bold text-foreground">AkuvoxDriver.ts</p>
                                                    <p className="text-[10px] text-muted-foreground">Driver principal HTTP API</p>
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-3">
                                                <Webhook className="text-orange-400 mt-1" size={16} />
                                                <div>
                                                    <p className="text-xs font-bold text-foreground">route.ts (webhook)</p>
                                                    <p className="text-[10px] text-muted-foreground">Receptor de eventos de acceso</p>
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
                                                <ImageIcon className="text-blue-400 mt-1" size={16} />
                                                <div>
                                                    <p className="text-xs font-bold text-foreground">Face Recognition</p>
                                                    <p className="text-[10px] text-muted-foreground">Procesamiento de imágenes</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-purple-400 mb-3">Flujo de Datos</h3>
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-purple-600 text-foreground">1</Badge>
                                            <p className="text-xs text-muted-foreground">Usuario presenta credencial (TAG/Face) → Dispositivo valida</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-purple-600 text-foreground">2</Badge>
                                            <p className="text-xs text-muted-foreground">Dispositivo envía evento al webhook (opcional)</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-purple-600 text-foreground">3</Badge>
                                            <p className="text-xs text-muted-foreground">Sistema sincroniza usuarios/caras desde DB → Dispositivo</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-purple-600 text-foreground">4</Badge>
                                            <p className="text-xs text-muted-foreground">Driver gestiona usuarios con ID determinista (Compatible con Linux AC/Android)</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-purple-600 text-foreground">5</Badge>
                                            <p className="text-xs text-muted-foreground">Apertura de puerta mediante API Unificada o CGI Legacy</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className="bg-purple-600 text-foreground">6</Badge>
                                            <p className="text-xs text-muted-foreground">Captura Atómica: Webhook dispara fetch inmediato de imagen facial</p>
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
                                <CardTitle className="text-foreground">Endpoints HTTP API Utilizados</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Add User */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Users className="text-emerald-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Agregar Usuario</h3>
                                        </div>
                                        <Badge className="bg-emerald-600 text-foreground">POST</Badge>
                                    </div>
                                    <code className="text-[10px] text-purple-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        /api/user/add
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Crea un usuario con credenciales (TAGs, PIN, Face). Soporta campos mandatory de modelos Linux.</p>
                                    <details className="text-xs">
                                        <summary className="text-purple-400 cursor-pointer mb-2">Ver Payload (Linux Compatible)</summary>
                                        <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                            {`{
  "target": "user",
  "action": "add",
  "data": {
    "item": [{
      "ID": "123456",
      "UserID": "123456",        // Mandatory for Linux AC
      "Name": "Juan Pérez",
      "UserCode": "123456",
      "Type": "0",
      "Group": "Default",
      "Role": "-1",
      "CardCode": "1234567890",
      "PrivatePIN": "1234",
      "LiftFloorNum": "0",       // Mandatory for Linux AC
      "WebRelay": "0",           // Mandatory for Linux AC
      "ScheduleRelay": "1001-1;" // Format strict: ScheduleID-RelayNum;
    }]
  }
}`}
                                        </pre>
                                    </details>
                                </div>

                                {/* Add Face */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <ImageIcon className="text-blue-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Agregar Cara</h3>
                                        </div>
                                        <Badge className="bg-blue-600 text-foreground">POST</Badge>
                                    </div>
                                    <code className="text-[10px] text-purple-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        /api/face/add
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Agrega una imagen facial a un usuario existente</p>
                                    <details className="text-xs">
                                        <summary className="text-purple-400 cursor-pointer mb-2">Ver Payload</summary>
                                        <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                            {`{
  "target": "face",
  "action": "add",
  "data": {
    "ID": "123456",
    "Image": "base64_encoded_image_data..."
  }
}`}
                                        </pre>
                                    </details>
                                    <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded">
                                        <p className="text-[10px] text-yellow-400">
                                            <strong>Nota:</strong> La imagen debe estar en formato Base64 y cumplir con los requisitos de calidad del dispositivo.
                                        </p>
                                    </div>
                                </div>

                                {/* Get Users */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Download className="text-blue-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Obtener Usuarios</h3>
                                        </div>
                                        <Badge className="bg-blue-600 text-foreground">POST</Badge>
                                    </div>
                                    <code className="text-[10px] text-purple-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        /api/user/get
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Obtiene lista de usuarios del dispositivo (paginado)</p>
                                    <details className="text-xs">
                                        <summary className="text-purple-400 cursor-pointer mb-2">Ver Payload</summary>
                                        <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                            {`{
  "target": "user",
  "action": "get",
  "data": {
    "offset": 0,
    "num": 200
  }
}`}
                                        </pre>
                                    </details>
                                </div>

                                {/* Delete User */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Trash2 className="text-red-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Eliminar Usuario</h3>
                                        </div>
                                        <Badge className="bg-red-600 text-foreground">POST</Badge>
                                    </div>
                                    <code className="text-[10px] text-purple-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        /api/user/delete
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Elimina un usuario del dispositivo</p>
                                    <details className="text-xs">
                                        <summary className="text-purple-400 cursor-pointer mb-2">Ver Payload</summary>
                                        <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                            {`// Por ID interno
{
  "target": "user",
  "action": "delete",
  "data": {
    "ID": ["123456"]
  }
}

// Por UserCode
{
  "target": "user",
  "action": "delete",
  "data": {
    "UserCode": ["123456"]
  }
}`}
                                        </pre>
                                    </details>
                                </div>

                                {/* Open Door */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Play className="text-purple-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Abrir Puerta (Unified)</h3>
                                        </div>
                                        <div className="flex gap-1">
                                            <Badge className="bg-purple-600 text-foreground">POST</Badge>
                                            <Badge className="bg-muted text-foreground">GET</Badge>
                                        </div>
                                    </div>
                                    <code className="text-[10px] text-purple-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        POST /api/relay/trig
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Método moderno unificado para Android/Linux. Soporta fallback automático a CGI.</p>
                                    <details className="text-xs">
                                        <summary className="text-purple-400 cursor-pointer mb-2">Ver Payload JSON</summary>
                                        <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                            {`{
  "target": "relay",
  "action": "trig",
  "data": {
    "mode": 0,
    "num": 1,
    "level": 0,
    "delay": 5
  }
}`}
                                        </pre>
                                    </details>
                                    <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded">
                                        <p className="text-[10px] text-blue-400">
                                            <strong>Fallback CGI:</strong> Si la API unificada falla, el driver intenta <code>/fcgi/do?action=OpenDoor</code> automáticamente.
                                        </p>
                                    </div>
                                </div>

                                {/* Get Door Logs */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Download className="text-orange-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Obtener Logs de Auditoría</h3>
                                        </div>
                                        <Badge className="bg-orange-600 text-foreground">GET/POST</Badge>
                                    </div>
                                    <code className="text-[10px] text-purple-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        /api/doorlog/get
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Obtiene el historial de eventos de acceso del dispositivo</p>
                                    <details className="text-xs">
                                        <summary className="text-purple-400 cursor-pointer mb-2">Ver Respuesta</summary>
                                        <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                            {`{
  "retcode": 0,
  "action": "get",
  "message": "OK",
  "data": {
    "num": 2,
    "item": [
      {
        "ID": "1",
        "Type": "4",      // 0=Unknown, 1=Card, 2=Password, 3=Public, 4=Face
        "Name": "Juan Pérez",
        "Status": "0",    // 0=Success, 1=Failed
        "Code": "1234567890",
        "Date": "20241230",
        "Time": "10:30:45"
      },
      {
        "ID": "2",
        "Type": "1",
        "Name": "María García",
        "Status": "0",
        "Code": "9876543210",
        "Date": "20241230",
        "Time": "11:15:22"
      }
    ]
  }
}`}
                                        </pre>
                                    </details>
                                    <div className="mt-3 p-3 bg-orange-500/10 border border-orange-500/20 rounded">
                                        <h4 className="text-[10px] font-bold text-orange-400 mb-2">Tipos de Evento:</h4>
                                        <ul className="text-[9px] text-orange-300 space-y-1">
                                            <li><strong>0:</strong> Unknown (Desconocido)</li>
                                            <li><strong>1:</strong> Card (Tarjeta RFID)</li>
                                            <li><strong>2:</strong> Password (Código PIN)</li>
                                            <li><strong>3:</strong> Public (Código Público)</li>
                                            <li><strong>4:</strong> Face (Reconocimiento Facial)</li>
                                        </ul>
                                    </div>
                                </div>

                                {/* Export Door Logs */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Download className="text-cyan-400" size={16} />
                                            <h3 className="text-sm font-bold text-foreground">Exportar Logs (XML)</h3>
                                        </div>
                                        <Badge className="bg-cyan-600 text-foreground">GET/POST</Badge>
                                    </div>
                                    <code className="text-[10px] text-purple-400 bg-black/40 px-2 py-1 rounded block mb-2">
                                        /api/doorlog/export
                                    </code>
                                    <p className="text-xs text-muted-foreground mb-3">Descarga todos los logs en formato XML</p>
                                    <div className="mt-3 p-3 bg-cyan-500/10 border border-cyan-500/20 rounded">
                                        <p className="text-[10px] text-cyan-400">
                                            <strong>Retorna:</strong> Archivo DoorLog.xml con todos los eventos de acceso registrados en el dispositivo.
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Card: Credenciales y Métodos de Acceso */}
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-foreground">Credenciales y Métodos de Acceso</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Face Recognition */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center gap-2 mb-3">
                                        <ImageIcon className="text-blue-400" size={20} />
                                        <h3 className="text-sm font-bold text-foreground">Reconocimiento Facial</h3>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-blue-400 mb-2">Campo en Usuario:</h4>
                                            <code className="text-[10px] text-purple-400">FaceUrl</code>
                                            <p className="text-[10px] text-muted-foreground mt-1">URL o ruta de la imagen facial en Base64</p>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-blue-400 mb-2">Formato de Imagen:</h4>
                                            <ul className="text-[10px] text-muted-foreground space-y-1 list-disc list-inside">
                                                <li>Formato: JPG recomendado</li>
                                                <li>Tamaño máximo: ~200KB</li>
                                                <li>Codificación: Base64</li>
                                                <li>Resolución: Mínimo 640x480</li>
                                            </ul>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-blue-400 mb-2">Proceso de Sincronización:</h4>
                                            <ol className="text-[10px] text-muted-foreground space-y-1 list-decimal list-inside">
                                                <li>Crear usuario con <code className="text-purple-400">/api/user/add</code></li>
                                                <li>Descargar imagen desde servidor</li>
                                                <li>Convertir imagen a Base64</li>
                                                <li>Enviar mediante <code className="text-purple-400">/api/face/add</code></li>
                                            </ol>
                                        </div>
                                    </div>
                                </div>

                                {/* RFID Cards */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center gap-2 mb-3">
                                        <CreditCard className="text-emerald-400" size={20} />
                                        <h3 className="text-sm font-bold text-foreground">Tarjetas RFID</h3>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-emerald-400 mb-2">Campo en Usuario:</h4>
                                            <code className="text-[10px] text-purple-400">CardCode</code>
                                            <p className="text-[10px] text-muted-foreground mt-1">Número de serie de la tarjeta RFID</p>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-emerald-400 mb-2">Múltiples Tarjetas:</h4>
                                            <p className="text-[10px] text-muted-foreground mb-2">Un usuario puede tener varias tarjetas separadas por punto y coma:</p>
                                            <code className="text-[9px] text-emerald-400 bg-black/60 px-2 py-1 rounded block">
                                                "CardCode": "1234567890;9876543210;1122334455"
                                            </code>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-emerald-400 mb-2">Ejemplo de Sincronización:</h4>
                                            <pre className="bg-black/60 p-2 rounded text-[9px] text-neutral-300 overflow-x-auto">
                                                {`{
  "target": "user",
  "action": "add",
  "data": {
    "item": [{
      "ID": "123456",
      "Name": "Juan Pérez",
      "UserCode": "123456",
      "CardCode": "1234567890",
      "ScheduleRelay": "1001-1;1001-2;"
    }]
  }
}`}
                                            </pre>
                                        </div>
                                    </div>
                                </div>

                                {/* Security Codes (PIN) */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Lock className="text-yellow-400" size={20} />
                                        <h3 className="text-sm font-bold text-foreground">Códigos de Seguridad (PIN)</h3>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-yellow-400 mb-2">Campo en Usuario:</h4>
                                            <code className="text-[10px] text-purple-400">PrivatePIN</code>
                                            <p className="text-[10px] text-muted-foreground mt-1">Código PIN personal del usuario</p>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-yellow-400 mb-2">Múltiples PINs:</h4>
                                            <p className="text-[10px] text-muted-foreground mb-2">Un usuario puede tener varios códigos PIN separados por punto y coma:</p>
                                            <code className="text-[9px] text-yellow-400 bg-black/60 px-2 py-1 rounded block">
                                                "PrivatePIN": "01016566;01011212;12345"
                                            </code>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-yellow-400 mb-2">Formato del PIN:</h4>
                                            <ul className="text-[10px] text-muted-foreground space-y-1 list-disc list-inside">
                                                <li>Longitud: 4-8 dígitos</li>
                                                <li>Solo números (0-9)</li>
                                                <li>Puede incluir ceros a la izquierda</li>
                                                <li>Ejemplo: "0123", "1234", "01016566"</li>
                                            </ul>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-yellow-400 mb-2">Código Público:</h4>
                                            <p className="text-[10px] text-muted-foreground mb-2">Existe también un código público compartido por todos:</p>
                                            <code className="text-[9px] text-yellow-400 bg-black/60 px-2 py-1 rounded block">
                                                GET/POST: /api/publiccode/get
                                            </code>
                                            <p className="text-[9px] text-muted-foreground mt-1">Permite acceso sin identificación individual</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Schedule & Relay */}
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Zap className="text-purple-400" size={20} />
                                        <h3 className="text-sm font-bold text-foreground">Horarios y Relés</h3>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-purple-400 mb-2">Campo ScheduleRelay:</h4>
                                            <p className="text-[10px] text-muted-foreground mb-2">Define qué relés puede activar el usuario y en qué horarios:</p>
                                            <code className="text-[9px] text-purple-400 bg-black/60 px-2 py-1 rounded block">
                                                "ScheduleRelay": "1001-1;1001-2;1002-1"
                                            </code>
                                            <p className="text-[9px] text-muted-foreground mt-2">Formato: <code>ScheduleID-RelayNum</code></p>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <h4 className="text-xs font-bold text-purple-400 mb-2">Schedules Predefinidos:</h4>
                                            <ul className="text-[10px] text-muted-foreground space-y-1">
                                                <li><code className="text-purple-400">1001</code> - Always (Siempre, 00:00-23:59)</li>
                                                <li><code className="text-purple-400">1002</code> - Never (Nunca)</li>
                                                <li><code className="text-purple-400">Custom</code> - Horarios personalizados por día/hora</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* WEBHOOK TAB */}
                    <TabsContent value="webhook" className="space-y-6">
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-foreground">Eventos Webhook</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-purple-400 mb-3">Configuración del Webhook</h3>
                                    <div className="space-y-3">
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">URL Base del Webhook:</p>
                                            <code className="text-xs text-emerald-400 bg-black/40 px-2 py-1 rounded block">
                                                http://TU_SERVIDOR:10000/api/webhooks/akuvox
                                            </code>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">Método:</p>
                                            <Badge className="bg-purple-600">GET</Badge>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">Parámetros:</p>
                                            <Badge className="bg-muted">Query String</Badge>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-purple-400 mb-3">📋 Ejemplos Reales de Eventos</h3>
                                    <p className="text-xs text-muted-foreground mb-4">Eventos HTTP GET enviados por los dispositivos Akuvox</p>

                                    <div className="space-y-4">
                                        {/* Face Valid */}
                                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-emerald-600 text-foreground">✓ FACE VALID</Badge>
                                                <span className="text-xs text-emerald-400 font-bold">Smart User Sync (Recomendado)</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Optimizada (Action URL en Akuvox):</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=face_valid&mac=$mac&user=$user_name&userid=$userid&FaceUrl=$FaceUrl&PicUrl=$pic_url&time=$time
                                                    </code>
                                                </div>
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">Beneficio:</p>
                                                    <p className="text-[9px] text-muted-foreground">
                                                        El uso de <code className="text-emerald-400">$userid</code> y las variables de imagen <code className="text-blue-400">$FaceUrl/$pic_url</code> permite al sistema capturar la evidencia instantáneamente sin depender del polling.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Face Invalid */}
                                        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-red-600 text-foreground">✗ FACE INVALID</Badge>
                                                <span className="text-xs text-red-400 font-bold">Cara No Reconocida</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Configurada:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=face_invalid&mac=$mac&FaceUrl=$FaceUrl&PicUrl=$pic_url&time=$time
                                                    </code>
                                                </div>
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">Ejemplo de Request:</p>
                                                    <code className="text-[9px] text-red-400 block break-all">
                                                        GET /api/webhooks/akuvox?event=face_invalid&mac=00:1A:2B:3C:4D:5E&time=1703945456
                                                    </code>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Card Valid */}
                                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-emerald-600 text-foreground">✓ CARD VALID</Badge>
                                                <span className="text-xs text-emerald-400 font-bold">Tarjeta RFID Autorizada</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Recomendada:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=card_valid&mac=$mac&card=$card_sn&userid=$userid&time=$time
                                                    </code>
                                                </div>
                                            </div>
                                        </div>

                                        {/* QR Code Valid */}
                                        <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-blue-600 text-foreground">📱 QR VALID</Badge>
                                                <span className="text-xs text-blue-400 font-bold">Código QR / Temp Key</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Recomendada:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=qr_valid&mac=$mac&qrcode=$qrcode&time=$time
                                                    </code>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Card Invalid */}
                                        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-red-600 text-foreground">✗ CARD INVALID</Badge>
                                                <span className="text-xs text-red-400 font-bold">Tarjeta No Autorizada</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Configurada:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=card_invalid&mac=$mac&card=$card_sn&time=$time
                                                    </code>
                                                </div>
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">Ejemplo de Request:</p>
                                                    <code className="text-[9px] text-red-400 block break-all">
                                                        GET /api/webhooks/akuvox?event=card_invalid&mac=00:1A:2B:3C:4D:5E&card=9999999999&time=1703946012
                                                    </code>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Code Valid */}
                                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-emerald-600 text-foreground">✓ CODE VALID</Badge>
                                                <span className="text-xs text-emerald-400 font-bold">PIN Correcto</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Configurada:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=code_valid&mac=$mac&code=$code&time=$time
                                                    </code>
                                                </div>
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">Ejemplo de Request:</p>
                                                    <code className="text-[9px] text-emerald-400 block break-all">
                                                        GET /api/webhooks/akuvox?event=code_valid&mac=00:1A:2B:3C:4D:5E&code=1234&time=1703946234
                                                    </code>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Code Invalid */}
                                        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-red-600 text-foreground">✗ CODE INVALID</Badge>
                                                <span className="text-xs text-red-400 font-bold">PIN Incorrecto</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Configurada:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=code_invalid&mac=$mac&code=$code&time=$time
                                                    </code>
                                                </div>
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">Ejemplo de Request:</p>
                                                    <code className="text-[9px] text-red-400 block break-all">
                                                        GET /api/webhooks/akuvox?event=code_invalid&mac=00:1A:2B:3C:4D:5E&code=9999&time=1703946456
                                                    </code>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Door Open */}
                                        <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-blue-600 text-foreground">🚪 DOOR OPEN</Badge>
                                                <span className="text-xs text-blue-400 font-bold">Puerta Abierta (Relé Activado)</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Configurada:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=door_open&mac=$mac&id=$relay_id&time=$time
                                                    </code>
                                                </div>
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">Ejemplo de Request:</p>
                                                    <code className="text-[9px] text-blue-400 block break-all">
                                                        GET /api/webhooks/akuvox?event=door_open&mac=00:1A:2B:3C:4D:5E&id=A&time=1703946678
                                                    </code>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Door Close */}
                                        <div className="bg-muted/5 border border-border/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-muted text-foreground">🔒 DOOR CLOSE</Badge>
                                                <span className="text-xs text-muted-foreground font-bold">Puerta Cerrada</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Configurada:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=door_close&mac=$mac&id=$relay_id&time=$time
                                                    </code>
                                                </div>
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">Ejemplo de Request:</p>
                                                    <code className="text-[9px] text-muted-foreground block break-all">
                                                        GET /api/webhooks/akuvox?event=door_close&mac=00:1A:2B:3C:4D:5E&id=A&time=1703946890
                                                    </code>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Tamper Alarm */}
                                        <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-orange-600 text-foreground">⚠️ TAMPER</Badge>
                                                <span className="text-xs text-orange-400 font-bold">Alarma de Manipulación</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Configurada:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=tamper&mac=$mac&time=$time
                                                    </code>
                                                </div>
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">Ejemplo de Request:</p>
                                                    <code className="text-[9px] text-orange-400 block break-all">
                                                        GET /api/webhooks/akuvox?event=tamper&mac=00:1A:2B:3C:4D:5E&time=1703947012
                                                    </code>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Incoming Call */}
                                        <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Badge className="bg-purple-600 text-foreground">📞 CALLING</Badge>
                                                <span className="text-xs text-purple-400 font-bold">Llamada Entrante</span>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">URL Configurada:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        http://TU_SERVIDOR:10000/api/webhooks/akuvox?event=calling&mac=$mac&to=$remote&time=$time
                                                    </code>
                                                </div>
                                                <div className="bg-black/40 p-3 rounded">
                                                    <p className="text-[10px] text-muted-foreground mb-1">Ejemplo de Request:</p>
                                                    <code className="text-[9px] text-purple-400 block break-all">
                                                        GET /api/webhooks/akuvox?event=calling&mac=00:1A:2B:3C:4D:5E&to=101&time=1703947234
                                                    </code>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-blue-500/10 border border-blue-500/20 rounded p-4">
                                    <h4 className="text-xs font-bold text-blue-400 mb-2">🔧 Variables Akuvox Disponibles</h4>
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                        <div className="bg-black/40 p-2 rounded">
                                            <code className="text-blue-400">$mac</code>
                                            <p className="text-muted-foreground mt-1">Dirección MAC del dispositivo</p>
                                        </div>
                                        <div className="bg-black/40 p-2 rounded">
                                            <code className="text-blue-400">$ip</code>
                                            <p className="text-muted-foreground mt-1">Dirección IP del dispositivo</p>
                                        </div>
                                        <div className="bg-black/40 p-2 rounded">
                                            <code className="text-blue-400">$name</code>
                                            <p className="text-muted-foreground mt-1">Nombre del usuario reconocido</p>
                                        </div>
                                        <div className="bg-black/40 p-2 rounded">
                                            <code className="text-blue-400">$card_sn</code>
                                            <p className="text-muted-foreground mt-1">Número de tarjeta RFID</p>
                                        </div>
                                        <div className="bg-black/40 p-2 rounded">
                                            <code className="text-blue-400">$code</code>
                                            <p className="text-muted-foreground mt-1">Código PIN ingresado</p>
                                        </div>
                                        <div className="bg-black/40 p-2 rounded">
                                            <code className="text-blue-400">$time</code>
                                            <p className="text-muted-foreground mt-1">Timestamp del evento</p>
                                        </div>
                                        <div className="bg-black/40 p-2 rounded">
                                            <code className="text-blue-400">$relay_id</code>
                                            <p className="text-muted-foreground mt-1">ID del relé (A, B, etc)</p>
                                        </div>
                                        <div className="bg-black/40 p-2 rounded">
                                            <code className="text-blue-400">$remote</code>
                                            <p className="text-muted-foreground mt-1">Extensión/SIP destino</p>
                                        </div>
                                        <div className="bg-black/40 p-2 rounded">
                                            <code className="text-blue-400">$FaceUrl</code>
                                            <p className="text-muted-foreground mt-1">Ruta interna de imagen facial</p>
                                        </div>
                                        <div className="bg-black/40 p-2 rounded">
                                            <code className="text-blue-400">$pic_url</code>
                                            <p className="text-muted-foreground mt-1">URL temporal de captura (Linux)</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-4">
                                    <h4 className="text-xs font-bold text-yellow-400 mb-2">⚠️ Nota Importante</h4>
                                    <p className="text-[10px] text-yellow-300">
                                        Los dispositivos Akuvox tienen soporte limitado para webhooks. La mayoría de modelos NO envían eventos automáticamente.
                                        El sistema funciona principalmente mediante sincronización activa (polling) desde el servidor. Los webhooks deben configurarse
                                        manualmente en <strong>Phone &gt; Action URL</strong> del dispositivo.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* FACE CAPTURE TAB */}
                    <TabsContent value="face-capture" className="space-y-6">
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-foreground flex items-center gap-2">
                                    <ImageIcon className="text-blue-400" size={20} />
                                    Mecánica de Evidencia Facial (Proxy v13)
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3 flex items-center gap-2">
                                        🛡️ El Proxy Inteligente
                                    </h3>
                                    <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                                        Debido a las restricciones de seguridad (CORS), certificados auto-firmados y la lentitud extrema de algunos modelos (Torre 1/2), el sistema utiliza un <strong>Face Proxy</strong> en el servidor que actúa como intermediario para garantizar la descarga de la evidencia.
                                    </p>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-black/40 p-3 rounded border border-neutral-800">
                                            <h4 className="text-xs font-bold text-foreground mb-2">Protocol Switching</h4>
                                            <p className="text-[10px] text-muted-foreground">
                                                Versión 13+: Intenta primero vía <strong>HTTPS</strong> (estándar Android) y hace fallback automático a <strong>HTTP</strong> si falla.
                                            </p>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded border border-neutral-800">
                                            <h4 className="text-xs font-bold text-foreground mb-2">Ultra-Patience (30s)</h4>
                                            <p className="text-[10px] text-muted-foreground">
                                                Diseñado para equipos lentos. El proxy espera hasta 30 segundos para completar la negociación Digest y la descarga.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-purple-400 mb-3">⭐ La "Regla de Oro" de Archivos</h3>
                                    <p className="text-xs text-muted-foreground mb-4">
                                        Akuvox utiliza un sistema de nombres de archivos que varía según la generación del dispositivo:
                                    </p>

                                    <div className="space-y-3">
                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-emerald-400 mb-1">1. Formato Strict (No-Zeros)</p>
                                            <p className="text-[10px] text-muted-foreground mb-2">Elimina ceros a la izquierda en hora, minuto y segundo.</p>
                                            <code className="text-[10px] text-emerald-300">2026-01-07_14-7-47.jpg</code>
                                            <p className="text-[9px] text-muted-foreground mt-1 italic">Ejemplo: 14:07:47 se convierte en 14-7-47</p>
                                        </div>

                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-blue-400 mb-1">2. Suffix Android/Linux (_0)</p>
                                            <p className="text-[10px] text-muted-foreground mb-2">Obligatorio en modelos como la Torre 2 (.204).</p>
                                            <code className="text-[10px] text-blue-300">2026-01-07_11-2-47_0.jpg</code>
                                        </div>

                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-muted-foreground mb-1">3. Legacy Fallback</p>
                                            <p className="text-[10px] text-muted-foreground mb-2">Algunos firmwares conservan los ceros.</p>
                                            <code className="text-[10px] text-muted-foreground">2026-01-07_08-05-07.jpg</code>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-purple-400 mb-3">📂 Estructura de Carpetas</h3>
                                    <p className="text-xs text-muted-foreground mb-3">El sistema rotará por estas ubicaciones hasta encontrar el archivo:</p>
                                    <ul className="text-[10px] text-muted-foreground space-y-1 list-disc list-inside">
                                        <li><code>/Image/DoorPicture/</code> (Prioridad para registros de puerta)</li>
                                        <li><code>/Image/IntercomPicture/</code> (Fallback para logs de llamadas)</li>
                                    </ul>
                                </div>

                                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
                                    <h3 className="text-sm font-bold text-emerald-400 mb-3 flex items-center gap-2">
                                        🧪 Cómo Testear Manualmente
                                    </h3>
                                    <p className="text-xs text-muted-foreground mb-4">Puedes probar el proxy directamente pegando esto en tu navegador:</p>
                                    <code className="text-[10px] text-purple-400 bg-black/60 px-3 py-2 rounded block break-all mb-4">
                                        http://localhost:10000/api/proxy/face?deviceId=ID_DEL_EQUIPO&date=2026-01-07&time=11:02:47
                                    </code>
                                    <div className="space-y-2">
                                        <p className="text-[10px] text-muted-foreground">Si el proxy funciona, verás los logs de V13 en la consola del servidor:</p>
                                        <code className="text-[9px] text-emerald-400 bg-black/40 p-2 rounded block">
                                            [Proxy-Face-V13] 🔍 Testing -{'>'} https://10.10.10.204/Image/DoorPicture/2026-01-07_11-2-47_0.jpg{"\n"}
                                            [Proxy-Face] 🔐 Negotiating Auth for 2026-01-07_11-2-47_0.jpg{"\n"}
                                            [Proxy-Face] ✅ Success via Auth!
                                        </code>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* TROUBLESHOOTING TAB */}
                    <TabsContent value="troubleshooting" className="space-y-6">
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-foreground flex items-center gap-2">
                                    <Zap className="text-red-400" size={20} />
                                    Troubleshooting: Eventos Faciales
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Problema Identificado */}
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                                    <h3 className="text-sm font-bold text-red-400 mb-3 flex items-center gap-2">
                                        🔴 Problema Identificado
                                    </h3>
                                    <div className="space-y-3 text-xs text-muted-foreground">
                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="font-bold text-red-300 mb-2">Síntoma:</p>
                                            <ul className="list-disc list-inside space-y-1 text-[11px]">
                                                <li>Los eventos faciales de Akuvox se catalogan como <strong>"No Identificado"</strong></li>
                                                <li>La foto NO aparece en el dashboard ni en el historial</li>
                                                <li>La puerta se abre (dice "AUTORIZADO"), pero la lógica está mal</li>
                                                <li>Eventos muestran "EXTERNO / DESCONOCIDO" en lugar del usuario real</li>
                                            </ul>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="font-bold text-yellow-300 mb-2">Log en Consola:</p>
                                            <code className="text-[10px] text-yellow-400 bg-black/60 px-2 py-1 rounded block">
                                                [2026-01-07T11:54:16.996Z] [SOCKET] Emitting access_event for Akuvox event: face_valid
                                            </code>
                                        </div>
                                    </div>
                                </div>

                                {/* Root Cause Analysis */}
                                <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4">
                                    <h3 className="text-sm font-bold text-orange-400 mb-3 flex items-center gap-2">
                                        🔍 Causas Raíz (Root Cause)
                                    </h3>
                                    <div className="space-y-3">
                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-orange-300 mb-2">1. NO se buscaba credencial tipo FACE en la base de datos</p>
                                            <p className="text-[10px] text-muted-foreground mb-2">
                                                El código solo buscaba credenciales de tipo TAG y PIN, pero NO de tipo FACE. Por lo tanto, aunque el usuario existiera en la DB con su credencial facial, nunca se vinculaba al evento.
                                            </p>
                                            <code className="text-[9px] text-red-400 bg-black/60 px-2 py-1 rounded block">
                                                {"// ANTES: Solo se buscaban credenciales TAG/PIN\nif (credentialValue && credentialType) {\n  // Pero NO se aplicaba MODE_FACE ni se vinculaba usuario\n}"}
                                            </code>
                                        </div>

                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-orange-300 mb-2">2. NO se aplicaba lógica MODE_FACE (Blacklist/Whitelist)</p>
                                            <p className="text-[10px] text-muted-foreground mb-2">
                                                Similar al MODE_LPR, el sistema debe tener un MODE_FACE que defina si los rostros identificados en la DB deben ser DENEGADOS (modo Blacklist) o AUTORIZADOS (modo Whitelist).
                                            </p>
                                            <code className="text-[9px] text-red-400 bg-black/60 px-2 py-1 rounded block">
                                                // FALTABA: Lógica para consultar setting 'MODE_FACE'{"\n"}
                                                // Y tomar decisión de acceso basado en ese modo
                                            </code>
                                        </div>

                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-orange-300 mb-2">3. NO se capturaban las fotos correctamente</p>
                                            <p className="text-[10px] text-muted-foreground mb-2">
                                                Las variables <code className="text-blue-400">$FaceUrl</code> y <code className="text-blue-400">$PicUrl</code> no se estaban usando correctamente en el Action URL, y el sistema no loggeaba suficiente información para debugging.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Solución Implementada */}
                                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
                                    <h3 className="text-sm font-bold text-emerald-400 mb-3 flex items-center gap-2">
                                        ✅ Solución Implementada
                                    </h3>
                                    <div className="space-y-3">
                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-emerald-300 mb-2">1. Búsqueda de Credenciales FACE en la Base de Datos</p>
                                            <ul className="list-disc list-inside space-y-1 text-[10px] text-muted-foreground ml-2">
                                                <li>Ahora el sistema busca credenciales con <code className="text-purple-400">type: 'FACE'</code></li>
                                                <li>Cuando encuentra la credencial, vincula el usuario al evento</li>
                                                <li>Loggea el resultado para debugging: <code className="text-emerald-400">"✓ User found by FACE credential"</code></li>
                                            </ul>
                                            <pre className="mt-2 bg-black/60 p-2 rounded text-[9px] text-emerald-300 overflow-x-auto">
                                                {`console.log(\`\${logPrefix} 🔍 [DB-SEARCH] Searching for credential: "\${credentialValue}" (type: \${credentialType})\`);
const credential = await prisma.credential.findFirst({
  where: { value: credentialValue, type: credentialType },
  include: { user: true }
});

if (credential) {
  user = credential.user;
  userId = user.id;
  console.log(\`\${logPrefix} ✓ User found by \${credentialType} credential: \${user.name} (\${user.id})\`);
  // Aplicar MODE_FACE aquí...
}`}
                                            </pre>
                                        </div>

                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-emerald-300 mb-2">2. Implementación de Lógica MODE_FACE</p>
                                            <ul className="list-disc list-inside space-y-1 text-[10px] text-muted-foreground ml-2">
                                                <li><strong>Modo WHITELIST</strong> (Por defecto): Rostros en la DB son AUTORIZADOS, desconocidos son DENEGADOS</li>
                                                <li><strong>Modo BLACKLIST</strong>: Rostros en la DB son DENEGADOS, desconocidos son AUTORIZADOS</li>
                                            </ul>
                                            <pre className="mt-2 bg-black/60 p-2 rounded text-[9px] text-emerald-300 overflow-x-auto">
                                                {`if (credentialType === 'FACE') {
  const modeSetting = await prisma.setting.findUnique({ 
    where: { key: 'MODE_FACE' } 
  });
  const mode = modeSetting?.value || 'WHITELIST';

  if (mode === 'BLACKLIST') {
    accessDecision = "DENY";
    console.log('⛔ [MODE-FACE] BLACKLIST Active - Face found in DB => DENIED.');
  } else if (mode === 'WHITELIST') {
    accessDecision = "GRANT";
    console.log('✅ [MODE-FACE] WHITELIST Active - Face found in DB => GRANTED.');
  }
}`}
                                            </pre>
                                        </div>

                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-emerald-300 mb-2">3. Captura Mejorada de Imágenes Faciales</p>
                                            <ul className="list-disc list-inside space-y-1 text-[10px] text-muted-foreground ml-2">
                                                <li>Se agregaron logs detallados de los parámetros FaceUrl/PicUrl</li>
                                                <li>Se mejoró el logging de éxito/fallo en la captura de imágenes</li>
                                                <li>Se usa correctamente la función <code className="text-purple-400">fetchAkuvoxFaceImage</code></li>
                                            </ul>
                                            <pre className="mt-2 bg-black/60 p-2 rounded text-[9px] text-emerald-300 overflow-x-auto">
                                                {`console.log(\`\${logPrefix} [AUTO-SNAP] Params: FaceUrl=\${params.FaceUrl}, PicUrl=\${params.PicUrl}, userid=\${params.userid}\`);

const snapBuffer = await fetchAkuvoxFaceImage(device, {
  userId: params.userid,
  name: params.user || params.name,
  path: params.FaceUrl || params.PicUrl
});

if (snapBuffer) {
  const filename = \`aku_face_\${device.id}_\${Date.now()}.jpg\`;
  snapPath = await uploadToS3(snapBuffer, filename, "image/jpeg", "face");
  console.log(\`\${logPrefix} [AUTO-SNAP] ✓ Face image uploaded to S3: \${snapPath}\`);
} else {
  console.warn(\`\${logPrefix} [AUTO-SNAP] ✗ Failed to fetch face image from device\`);
}`}
                                            </pre>
                                        </div>
                                    </div>
                                </div>

                                {/* Cómo Verificar */}
                                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                                    <h3 className="text-sm font-bold text-blue-400 mb-3">🧪 Cómo Verificar la Corrección</h3>
                                    <div className="space-y-2">
                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-blue-300 mb-2">Paso 1: Verificar Logs en Consola</p>
                                            <p className="text-[10px] text-muted-foreground mb-1">Después de un evento facial, debes ver:</p>
                                            <code className="text-[9px] text-blue-400 bg-black/60 px-2 py-1 rounded block">
                                                [SOCKET] Emitting access_event for Akuvox event: face_valid{"\n"}
                                                🔍 [DB-SEARCH] Searching for credential: "Juan Pérez" (type: FACE){"\n"}
                                                ✓ User found by FACE credential: Juan Pérez (user-123){"\n"}
                                                ✅ [MODE-FACE] WHITELIST Active - Face found in DB ={'>'} GRANTED.{"\n"}
                                                [AUTO-SNAP] ✓ Face image uploaded to S3: face/aku_face_device1_1704812345678.jpg
                                            </code>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-blue-300 mb-2">Paso 2: Verificar Dashboard</p>
                                            <ul className="list-disc list-inside space-y-1 text-[10px] text-muted-foreground ml-2">
                                                <li>El evento debe mostrar el nombre del usuario (no "No Identificado")</li>
                                                <li>Debe aparecer la foto facial capturada</li>
                                                <li>El tipo de credencial debe ser "RECONOCIMIENTO FACIAL"</li>
                                                <li>La decisión de acceso debe estar correcta según el MODE_FACE configurado</li>
                                            </ul>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded">
                                            <p className="text-xs font-bold text-blue-300 mb-2">Paso 3: Probar Diferentes Modos</p>
                                            <p className="text-[10px] text-muted-foreground mb-2">
                                                Ir a <strong>Configuración &gt; Modo Face</strong> y probar:
                                            </p>
                                            <ul className="list-disc list-inside space-y-1 text-[10px] text-muted-foreground ml-2">
                                                <li><strong>WHITELIST</strong>: Usuario conocido → GRANT, desconocido → DENY</li>
                                                <li><strong>BLACKLIST</strong>: Usuario conocido → DENY, desconocido → GRANT</li>
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
                                    <h3 className="text-sm font-bold text-purple-400 mb-4">Flujo de Sincronización DB → Dispositivo</h3>
                                    <div className="space-y-4">
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-foreground font-bold text-xs">
                                                1
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-foreground mb-1">Generar ID Determinista</h4>
                                                <p className="text-[10px] text-muted-foreground">Se genera un ID numérico único basado en el ID de la DB usando hash MD5</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-foreground font-bold text-xs">
                                                2
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-foreground mb-1">Crear Usuario Base</h4>
                                                <p className="text-[10px] text-muted-foreground">Se envía la información del usuario con TAGs y PIN mediante /api/user/add</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-foreground font-bold text-xs">
                                                3
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-foreground mb-1">Agregar Imagen Facial</h4>
                                                <p className="text-[10px] text-muted-foreground">
                                                    Si existe foto, se descarga, convierte a Base64 y se envía mediante /api/face/add
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-foreground font-bold text-xs">
                                                4
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-foreground mb-1">Verificar Sincronización</h4>
                                                <p className="text-[10px] text-muted-foreground">Se consulta /api/user/get para validar que el usuario fue creado correctamente</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-purple-400 mb-3">ID Determinista</h3>
                                    <p className="text-xs text-muted-foreground mb-3">
                                        El driver genera IDs numéricos únicos y reproducibles para cada usuario:
                                    </p>
                                    <pre className="bg-black/60 p-3 rounded text-[10px] text-neutral-300 overflow-x-auto">
                                        {`private getNumericId(stringId: string): string {
  let hash = 0;
  for (let i = 0; i < stringId.length; i++) {
    const char = stringId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash % 1000000).toString();
}`}
                                    </pre>
                                </div>

                                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-4">
                                    <h4 className="text-xs font-bold text-emerald-400 mb-2">✅ Ventajas del Sistema</h4>
                                    <ul className="text-[10px] text-emerald-300 space-y-1 list-disc list-inside">
                                        <li>IDs deterministas permiten re-sincronización sin duplicados</li>
                                        <li>Soporte para múltiples credenciales por usuario (TAG + PIN + Face)</li>
                                        <li>Manejo robusto de errores con múltiples estrategias de eliminación</li>
                                        <li>Compatibilidad con diferentes firmwares de Akuvox</li>
                                    </ul>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* AUTH TAB */}
                    <TabsContent value="auth" className="space-y-6">
                        <Card className="bg-card border-border">
                            <CardHeader>
                                <CardTitle className="text-foreground">Autenticación HTTP</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-purple-400 mb-3">Métodos Soportados</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-black/40 p-3 rounded border border-neutral-800">
                                            <h4 className="text-xs font-bold text-foreground mb-2">Basic Auth (Recomendado)</h4>
                                            <p className="text-[10px] text-muted-foreground mb-2">Codificación Base64 de usuario:contraseña</p>
                                            <code className="text-[10px] text-purple-400 block">
                                                Authorization: Basic YXBpOkFwaSoyMDEx
                                            </code>
                                        </div>
                                        <div className="bg-black/40 p-3 rounded border border-neutral-800">
                                            <h4 className="text-xs font-bold text-foreground mb-2">Digest Auth</h4>
                                            <p className="text-[10px] text-muted-foreground mb-2">Challenge-response con MD5 (fallback)</p>
                                            <code className="text-[10px] text-purple-400 block break-all">
                                                Authorization: Digest username="api"...
                                            </code>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-blue-500/10 border border-blue-500/20 rounded p-4">
                                    <h4 className="text-xs font-bold text-blue-400 mb-2">💡 Credenciales por Función</h4>
                                    <div className="space-y-2 text-[10px] text-blue-300">
                                        <div className="flex items-start gap-2">
                                            <Badge className="bg-blue-600 text-foreground text-[8px]">ADMIN</Badge>
                                            <p>Usuario: <code className="text-blue-400">admin</code> - Para gestión de usuarios y configuración</p>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <Badge className="bg-purple-600 text-foreground text-[8px]">API</Badge>
                                            <p>Usuario: <code className="text-purple-400">api</code> / Password: <code className="text-purple-400">Api*2011</code> - Solo para control de relés</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-background p-4 rounded-lg border border-border">
                                    <h3 className="text-sm font-bold text-purple-400 mb-3">Implementación en el Driver</h3>
                                    <p className="text-xs text-muted-foreground mb-3">
                                        El driver implementa automáticamente ambos métodos con fallback:
                                    </p>
                                    <ul className="text-[10px] text-muted-foreground space-y-1 list-disc list-inside">
                                        <li>Intenta primero con Basic Auth</li>
                                        <li>Si recibe 401, parsea WWW-Authenticate</li>
                                        <li>Calcula Digest Auth automáticamente</li>
                                        <li>Reintenta con las credenciales correctas</li>
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
