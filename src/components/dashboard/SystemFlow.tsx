
"use client";

import { useEffect, useState, useCallback, memo } from 'react';
import ReactFlow, {
    addEdge,
    FitViewOptions,
    applyNodeChanges,
    applyEdgeChanges,
    Node,
    Edge,
    NodeChange,
    EdgeChange,
    Connection,
    Background,
    MarkerType,
    NodeTypes,
    Handle,
    Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import FloatingEdge from './flow/FloatingEdge';
import { Database, Server, Smartphone, HardDrive, ShieldCheck, Video, Globe, MessageSquare, Film, Zap, Monitor, Webhook, Camera, Copy, Check, ScanLine, Route } from 'lucide-react';
import { cn } from '@/lib/utils';
import axios from 'axios';
import { io } from 'socket.io-client';

// Custom Webhook Driver Node
const WebhookDriverNode = memo(({ data }: any) => {
    const Icon = data.icon;
    const ImageSrc = data.image; // Support for custom images
    const status = data.status || 'idle';
    const isActive = status === 'active';
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(data.fullUrl || `http://localhost:10000${data.sub}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className={cn(
            "relative flex flex-col p-3 transition-all duration-300 bg-card text-foreground border-2 rounded-xl min-w-[180px] custom-drag-handle group/node cursor-grab active:cursor-grabbing",
            isActive ? "border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.6)] scale-105" : "border-blue-500/50"
        )}>
            <Handle type="source" position={Position.Top} className="!bg-blue-500 !w-3 !h-3" />

            {/* Header */}
            <div className="flex items-center gap-2 mb-2 pointer-events-none">
                <div className={cn(
                    "p-1.5 rounded-lg transition-colors flex items-center justify-center w-8 h-8 bg-muted overflow-hidden",
                    isActive ? "bg-blue-500/20 text-blue-400" : "text-muted-foreground"
                )}>
                    {ImageSrc ? (
                        <img src={ImageSrc} alt={data.label} className="w-full h-full object-contain" />
                    ) : (
                        Icon && <Icon size={16} />
                    )}
                </div>
                <div className="flex flex-col">
                    <span className="text-[11px] font-bold uppercase tracking-tighter text-foreground">
                        {data.label}
                    </span>
                    <span className="text-[9px] font-mono text-muted-foreground">
                        Endpoint
                    </span>
                </div>

                {/* Status indicator */}
                <div className={cn(
                    "ml-auto w-2 h-2 rounded-full",
                    isActive ? "bg-blue-500 animate-ping" : "bg-blue-500/30"
                )} />
            </div>

            {/* Path Section */}
            <div className="flex items-center justify-between gap-2 p-1.5 bg-black/20 rounded-lg border border-border group relative z-10">
                <code className="text-[9px] text-muted-foreground font-mono truncate max-w-[120px] pointer-events-auto select-all">
                    {data.sub.toLowerCase()}
                </code>
                <button
                    onClick={handleCopy}
                    className="p-1 hover:bg-accent rounded transition-colors cursor-pointer pointer-events-auto"
                    title="Copiar Endpoint"
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} className="text-muted-foreground group-hover:text-foreground" />}
                </button>
            </div>

            {/* Event Info Animation (Bottom Popup) */}
            {isActive && data.eventInfo && (
                <div className="absolute top-full left-0 right-0 pt-3 animate-in slide-in-from-top-2 fade-in duration-300 pointer-events-none z-50">
                    <div className="bg-blue-600 text-foreground text-[10px] p-2 rounded-lg shadow-lg flex flex-col items-center text-center">
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-blue-600 rotate-45 transform" />
                        <span className="font-bold relative z-10">{data.eventInfo.title}</span>
                        <span className="opacity-80 font-mono text-[9px] relative z-10">{data.eventInfo.desc}</span>
                    </div>
                </div>
            )}
        </div>
    );
});
WebhookDriverNode.displayName = 'WebhookDriverNode';

const nodeTypes = {
    webhook: WebhookDriverNode,
};

const initialNodes: Node[] = [
    {
        id: 'frontend',
        data: { label: 'Frontend', icon: Monitor, sub: 'Next.js App', ip: 'localhost', port: '10001', status: 'unknown' },
        position: { x: 400, y: 50 },
        style: { background: 'var(--card)', color: 'var(--foreground)', border: '2px solid #8b5cf6', width: 200, borderRadius: 12, padding: 12 },
        type: 'default',
    },
    {
        id: 'lpr-node',
        data: { label: 'OmniAccess', icon: ShieldCheck, sub: 'Backend API', ip: 'localhost', port: '10000', status: 'connected' },
        position: { x: 400, y: 250 },
        style: { background: 'var(--card)', color: 'var(--foreground)', border: '2px solid #6366f1', width: 220, borderRadius: 16, padding: 15, boxShadow: '0 0 30px rgba(99, 102, 241, 0.4)' },
        type: 'default',
    },
    {
        id: 'postgres',
        data: { label: 'Primary DB', icon: Database, sub: 'PostgreSQL', ip: '127.0.0.1', port: '5432', status: 'unknown' },
        position: { x: 100, y: 250 },
        style: { background: 'var(--card)', color: 'var(--foreground)', border: '2px solid #3b82f6', width: 200, borderRadius: 12, padding: 12 },
    },
    {
        id: 'minio',
        data: { label: 'Object Storage', icon: HardDrive, sub: 'MinIO / S3', ip: '127.0.0.1', port: '9000', status: 'unknown' },
        position: { x: 100, y: 450 },
        style: { background: 'var(--card)', color: 'var(--foreground)', border: '2px solid #ef4444', width: 200, borderRadius: 12, padding: 12 },
    },
    {
        id: 'waha',
        data: { label: 'WhatsApp', icon: MessageSquare, sub: 'WhatsApp Gateway', ip: '127.0.0.1', port: '3000', status: 'unknown' },
        position: { x: 700, y: 250 },
        style: { background: 'color-mix(in oklab, var(--card) 88%, #25D366 12%)', color: 'var(--foreground)', border: '2px solid #25D366', width: 220, borderRadius: 12, padding: 12, boxShadow: '0 0 28px rgba(37, 211, 102, 0.35)' },
    },
    {
        id: 'webhook-api',
        data: { label: 'Webhook API', icon: Webhook, sub: 'Event Gateway', ip: 'localhost', port: '10000', status: 'idle', lastEvent: null },
        position: { x: 380, y: 450 },
        style: { background: 'var(--card)', color: 'var(--foreground)', border: '2px solid #3b82f6', width: 220, borderRadius: 12, padding: 12 },
        type: 'default',
    },
    {
        id: 'redis',
        data: { label: 'Cola & Cache', icon: Zap, sub: 'Redis 8 + BullMQ', ip: '127.0.0.1', port: '6379', status: 'connected' },
        position: { x: 700, y: 450 },
        style: { background: 'var(--card)', color: 'var(--foreground)', border: '2px solid #f59e0b', width: 200, borderRadius: 12, padding: 12 },
        type: 'default',
    },
    // --- Carril de captura: camara comun -> pasarela -> Omni-LPR -> nucleo ---
    {
        id: 'cams-track',
        data: { label: 'Cámaras interiores', icon: Video, sub: 'RTSP por canal', ip: 'LAN', port: '554', status: 'unknown' },
        position: { x: 980, y: 60 },
        style: { background: 'var(--card)', color: 'var(--foreground)', border: '2px solid #64748b', width: 200, borderRadius: 12, padding: 12 },
        type: 'default',
    },
    {
        id: 'tracking',
        data: { label: 'Seguimiento', icon: Route, sub: 'Pasarela de cuadros', ip: 'localhost', port: 'pm2', status: 'unknown' },
        position: { x: 980, y: 270 },
        style: { background: 'var(--card)', color: 'var(--foreground)', border: '2px solid #a78bfa', width: 200, borderRadius: 12, padding: 12 },
        type: 'default',
    },
    {
        id: 'omni-lpr',
        data: { label: 'Omni-LPR', icon: ScanLine, sub: 'Lector de matrículas', ip: '127.0.0.1', port: '8000', status: 'unknown' },
        position: { x: 980, y: 480 },
        style: { background: 'var(--card)', color: 'var(--foreground)', border: '2px solid #14b8a6', width: 200, borderRadius: 12, padding: 12 },
        type: 'default',
    },
    {
        id: 'media',
        data: { label: 'Media & Clips', icon: Film, sub: 'ffmpeg + go2rtc', ip: '127.0.0.1', port: '1984', status: 'connected' },
        position: { x: 100, y: 640 },
        style: { background: 'var(--card)', color: 'var(--foreground)', border: '2px solid #a855f7', width: 200, borderRadius: 12, padding: 12 },
        type: 'default',
    },
];

// Dynamic webhook driver nodes with images
const webhookDrivers = [
    { id: 'webhook-hikvision', label: 'Hikvision', path: '/api/webhooks/hikvision', icon: Camera, color: '#3b82f6', image: '/logos/hikvision.png' },
    { id: 'webhook-avicam', label: 'Avicam', path: '/api/webhooks/avicam', icon: Camera, color: '#10b981', image: '/logos/avicam.png' },
    { id: 'webhook-akuvox', label: 'Akuvox', path: '/api/webhooks/akuvox', icon: Smartphone, color: '#3b82f6', image: '/logos/akuvox.png' },
    { id: 'webhook-bosch', label: 'Bosch ONVIF', path: '/onvif/notification', icon: Video, color: '#f59e0b' },
    { id: 'webhook-waha', label: 'OpenWA Bot', path: '/api/webhooks/whatsapp', icon: MessageSquare, color: '#25D366' },
];

// Enlaces fijos del nucleo. Los dos caminos (con y sin posiciones guardadas)
// usan exactamente la misma lista para que nunca queden nodos sueltos.
const ENLACES_BASE: Edge[] = [
    { id: 'e-frontend', source: 'frontend', target: 'lpr-node', type: 'floating', animated: true, data: { latency: 0, status: 'unknown' } },
    { id: 'e-postgres', source: 'lpr-node', target: 'postgres', type: 'floating', animated: true, data: { latency: 0, status: 'unknown' } },
    { id: 'e-minio', source: 'lpr-node', target: 'minio', type: 'floating', animated: true, data: { latency: 0, status: 'unknown' } },
    { id: 'e-waha', source: 'lpr-node', target: 'waha', type: 'floating', animated: true, data: { latency: 0, status: 'unknown' } },
    { id: 'e-redis', source: 'lpr-node', target: 'redis', type: 'floating', animated: true, data: { latency: 0, status: 'unknown' } },
    { id: 'e-media', source: 'lpr-node', target: 'media', type: 'floating', animated: true, data: { latency: 0, status: 'unknown' } },
    { id: 'e-webhook-core', source: 'webhook-api', target: 'lpr-node', type: 'floating', animated: false, data: { latency: 0, status: 'idle' } },
    // Carril de captura: la camara entrega video a la pasarela, la pasarela
    // consulta al lector y el avistamiento vuelve al nucleo.
    { id: 'e-cams-track', source: 'cams-track', target: 'tracking', type: 'floating', animated: true, data: { latency: 0, status: 'unknown' } },
    { id: 'e-track-lpr', source: 'tracking', target: 'omni-lpr', type: 'floating', animated: true, data: { latency: 0, status: 'unknown' } },
    { id: 'e-track-core', source: 'tracking', target: 'lpr-node', type: 'floating', animated: true, data: { latency: 0, status: 'unknown' } },
];

const connectionLineStyle = { stroke: "var(--foreground)" };
const edgeTypes = {
    floating: FloatingEdge,
};

const fitViewOptions: FitViewOptions = {
    padding: 0.2,
};

export default function SystemFlow() {
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [webhookActive, setWebhookActive] = useState<string | null>(null);

    // Load saved positions from database
    useEffect(() => {
        const loadPositions = async () => {
            try {
                const res = await axios.get('/api/topology/positions');
                const savedPositions = res.data;

                // Endpoints reales de esta instalacion (no hardcodeados)
                let realEndpoints: Record<string, { ip?: string; port?: string; sub?: string }> = {};
                try {
                    const ep = await axios.get('/api/system/endpoints');
                    realEndpoints = ep.data || {};
                } catch { }

                // Create driver nodes dynamically
                const baseNodes = initialNodes.map((n) => {
                    const real = realEndpoints[n.id];
                    return real ? { ...n, data: { ...n.data, ...real } } : n;
                });

                const driverNodes = webhookDrivers.map((driver, index) => ({
                    id: driver.id,
                    data: {
                        label: driver.label,
                        icon: driver.icon,
                        image: driver.image, // Pass image prop
                        sub: driver.path,
                        ip: 'localhost',
                        port: '10000',
                        status: 'idle'
                    },
                    position: savedPositions[driver.id] || { x: 600 + (index * 220), y: 500 },
                    // Use custom type for smaller, interactive nodes
                    type: 'webhook',
                    // Drag handle class for custom node
                    dragHandle: '.custom-drag-handle'
                }));

                // Apply saved positions to initial nodes
                const nodesWithPositions = initialNodes.map(node => ({
                    ...node,
                    position: savedPositions[node.id] || node.position
                }));

                setNodes([...nodesWithPositions, ...driverNodes]);

                // Create edges
                const initialEdges: Edge[] = [
                    ...ENLACES_BASE,
                    ...webhookDrivers.map(driver => ({
                        id: `e-${driver.id}`,
                        source: driver.id,
                        target: 'webhook-api',
                        type: 'floating' as const,
                        animated: false,
                        data: { latency: 0, status: 'idle' },
                        style: { stroke: '#3b82f6', strokeWidth: 2 } // Force blue color initially
                    }))
                ];

                setEdges(initialEdges);
            } catch (err) {
                console.error('Error loading positions:', err);
                // Fallback to initial setup
                const driverNodes = webhookDrivers.map((driver, index) => ({
                    id: driver.id,
                    data: {
                        label: driver.label,
                        icon: driver.icon,
                        image: driver.image,
                        sub: driver.path,
                        ip: 'localhost',
                        port: '10000',
                        status: 'idle'
                    },
                    position: { x: 600 + (index * 220), y: 500 },
                    type: 'webhook',
                    dragHandle: '.custom-drag-handle'
                }));

                setNodes([...baseNodes, ...driverNodes]);

                const initialEdges: Edge[] = [
                    ...ENLACES_BASE,
                    ...webhookDrivers.map(driver => ({
                        id: `e-${driver.id}`,
                        source: driver.id,
                        target: 'webhook-api',
                        type: 'floating' as const,
                        animated: false,
                        data: { latency: 0, status: 'idle' },
                        style: { stroke: '#3b82f6', strokeWidth: 2 }
                    }))
                ];

                setEdges(initialEdges);
            }
        };

        loadPositions();
    }, []);

    const onNodesChange = useCallback(
        (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
        [setNodes]
    );

    const onEdgesChange = useCallback(
        (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        [setEdges]
    );

    const onConnect = useCallback(
        (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
        [setEdges]
    );

    // Save positions when nodes stop moving
    const onNodeDragStop = useCallback(async (_event: any, node: Node) => {
        try {
            await axios.post('/api/topology/positions', {
                id: node.id,
                x: node.position.x,
                y: node.position.y
            });
        } catch (err) {
            console.error('Error saving position:', err);
        }
    }, []);

    // Socket.IO for real-time webhook events
    useEffect(() => {
        // Use window.location.hostname to connect to the server on the same IP as the frontend
        const socket = io(window.location.origin, {
            path: '/io/socket.io',
            transports: ['polling']
        });

        socket.on('webhook-event', (data: any) => {
            console.log('Webhook event received:', data);

            // Determine which driver node to animate
            let driverNodeId = '';
            let eventInfo = { title: 'Evento Nuevo', desc: 'Procesando...' };

            if (data.type === 'FACE' || data.type === 'LPR' || data.type === 'EVENT') {
                driverNodeId = 'webhook-hikvision';
                eventInfo = data.type === 'FACE' ? { title: 'Rostro Detectado', desc: 'Hikvision LPR' } :
                    data.type === 'LPR' ? { title: 'LPR Lectura', desc: data.plate || 'Matrícula' } :
                        { title: 'Evento Cámara', desc: 'Detección' };
            } else if (data.type === 'BOSCH' || data.type === 'QUEUE') {
                driverNodeId = 'webhook-bosch';
                const count = data.peopleCount || data.count || 0;
                const rule = data.channelName || data.ruleName || 'IVA';
                eventInfo = { title: `${count} Personas`, desc: rule };
            } else if (data.type === 'AVICAM' || data.model === 'AVICAM') {
                driverNodeId = 'webhook-avicam';
                eventInfo = { title: 'Rostro Detectado', desc: data.name || 'Avicam Face' };
            } else if (data.type === 'AKUVOX' || data.model === 'AKUVOX') {
                driverNodeId = 'webhook-akuvox';
                eventInfo = { title: 'Evento Akuvox', desc: data.eventType || 'Access Log' };
            } else if (data.origin === 'WAHA' || data.type === 'CHAT') {
                driverNodeId = 'webhook-waha';
                const msgSnippet = data.body ? (data.body.length > 20 ? data.body.substring(0, 17) + "..." : data.body) : "Mensaje WA";
                eventInfo = { title: 'Mensaje WA', desc: msgSnippet };
            } else {
                // Generic fallback for other webhooks
                driverNodeId = webhookDrivers.find(d => data.path?.includes(d.path))?.id || '';
            }

            if (!driverNodeId) return;

            const isWAHA = data.origin === 'WAHA' || data.type === 'CHAT';
            const packetColor = isWAHA ? '#22c55e' : '#3b82f6';

            setWebhookActive(driverNodeId);

            // 1. Stage 1: Animation from Driver to Webhook API
            setNodes(nds => nds.map(node => {
                if (node.id === driverNodeId) {
                    return { ...node, data: { ...node.data, status: 'active', lastEvent: new Date().toISOString(), eventInfo } };
                }
                return node;
            }));

            setEdges(eds => eds.map(edge => {
                if (edge.id === `e-${driverNodeId}`) {
                    return { ...edge, animated: true, data: { ...edge.data, status: 'active', packetColor }, style: { stroke: packetColor, strokeWidth: 4 } };
                }
                return edge;
            }));

            // 2. Stage 2: Animation from Webhook API to OmniAccess (Core)
            setTimeout(() => {
                setNodes(nds => nds.map(node => {
                    if (node.id === 'webhook-api') {
                        return { ...node, data: { ...node.data, status: 'active', lastEvent: new Date().toISOString() } };
                    }
                    if (node.id === 'lpr-node') {
                        return { ...node, data: { ...node.data, status: 'active' } };
                    }
                    return node;
                }));

                setEdges(eds => eds.map(edge => {
                    if (edge.id === 'e-webhook-core') {
                        return { ...edge, animated: true, data: { ...edge.data, status: 'active', packetColor }, style: { stroke: packetColor, strokeWidth: 4 } };
                    }
                    return edge;
                }));
            }, 600);

            // 3. Stage 3: Animation from OmniAccess to DB and MinIO/Chatbot (Persistence)
            setTimeout(() => {
                setNodes(nds => nds.map(node => {
                    if (node.id === 'postgres' || (isWAHA ? node.id === 'waha' : node.id === 'minio')) {
                        return { ...node, data: { ...node.data, status: 'active' } };
                    }
                    return node;
                }));

                setEdges(eds => eds.map(edge => {
                    const targetId = isWAHA ? 'e-waha' : 'e-minio';
                    if (edge.id === 'e-postgres' || edge.id === targetId) {
                        return { ...edge, animated: true, data: { ...edge.data, status: 'active', packetColor }, style: { stroke: packetColor, strokeWidth: 4 } };
                    }
                    return edge;
                }));
            }, 1200);

            // 4. Reset all after cumulative 4 seconds for a complete flow
            setTimeout(() => {
                setWebhookActive(null);
                setNodes(nds => nds.map(node => {
                    const targets = ['webhook-api', driverNodeId, 'lpr-node', 'postgres', 'minio', 'waha'];
                    if (targets.includes(node.id)) {
                        const isCore = node.id === 'lpr-node';
                        const isConnected = ['lpr-node', 'postgres', 'minio', 'waha'].includes(node.id);
                        return { ...node, data: { ...node.data, status: isConnected ? 'connected' : 'idle', eventInfo: null } };
                    }
                    return node;
                }));
                setEdges(eds => eds.map(edge => {
                    const affectedEdges = [`e-${driverNodeId}`, 'e-webhook-core', 'e-postgres', 'e-minio', 'e-waha'];
                    if (affectedEdges.includes(edge.id)) {
                        const isPermanent = ['e-postgres', 'e-minio', 'e-waha'].includes(edge.id);
                        return { ...edge, animated: isPermanent, data: { ...edge.data, status: 'connected' }, style: { stroke: isPermanent ? undefined : '#3b82f6', strokeWidth: 2 } };
                    }
                    return edge;
                }));
            }, 4000);
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    // Status polling
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await axios.get('/api/system-status');
                const data = res.data;

                setEdges(eds => eds.map(edge => {
                    let status = 'unknown';
                    let latency = 0;

                    if (edge.id === 'e-postgres' && data.primaryDb) {
                        status = data.primaryDb.status;
                        latency = data.primaryDb.latency || 0;
                    } else if (edge.id === 'e-minio' && data.minio) {
                        status = data.minio.status;
                        latency = data.minio.latency || 0;
                    } else if (edge.id === 'e-waha' && data.waha) {
                        status = data.waha.status === 'connected' ? 'connected' : 'error';
                        latency = data.waha.latency || 0;
                    } else if (edge.id === 'e-track-lpr' && data.omniLpr) {
                        status = data.omniLpr.status === 'connected' ? 'connected' : 'error';
                        latency = data.omniLpr.latency || 0;
                    } else if ((edge.id === 'e-cams-track' || edge.id === 'e-track-core') && data.tracking) {
                        status = data.tracking.status === 'connected'
                            ? 'connected'
                            : data.tracking.status === 'disabled' ? 'disabled' : 'error';
                    } else if (edge.id === 'e-frontend') {
                        status = 'connected';
                    } else if (edge.id.startsWith('e-webhook')) {
                        // Ensure webhook edges stay blue
                        return {
                            ...edge,
                            style: { stroke: '#3b82f6', strokeWidth: edge.data.status === 'active' ? 4 : 2 }
                        };
                    }

                    return {
                        ...edge,
                        data: { ...edge.data, status, latency },
                        style: {
                            stroke: status === 'connected' ? '#22c55e'
                                : status === 'error' ? '#ef4444'
                                    : status === 'disabled' ? 'var(--border)' : '#6b7280',
                            strokeWidth: status === 'disabled' ? 2 : 3
                        },
                        animated: status === 'connected'
                    };
                }));

                setNodes(nds => nds.map(node => {
                    if (node.id.startsWith('webhook-')) return node;

                    let nodeStatus = 'unknown';
                    let stats = '';
                    let borderColor = '#6b7280';
                    let ip = node.data.ip;
                    let port = node.data.port;

                    if (node.id === 'frontend') {
                        nodeStatus = 'connected';
                        borderColor = '#22c55e';
                    } else if (node.id === 'postgres' && data.primaryDb) {
                        nodeStatus = data.primaryDb.status;
                        borderColor = nodeStatus === 'connected' ? '#22c55e' : '#ef4444';
                        if (data.primaryDb.details) {
                            stats = `${data.primaryDb.details.tableCount} Tablas | ${(data.primaryDb.details.size / 1024 / 1024).toFixed(0)} MB`;
                            ip = data.primaryDb.details.host || ip;
                            port = data.primaryDb.details.port || port;
                        }
                    } else if (node.id === 'minio' && data.minio) {
                        nodeStatus = data.minio.status;
                        borderColor = nodeStatus === 'connected' ? '#22c55e' : '#ef4444';
                        if (data.minio.details) {
                            stats = `LPR: ${data.minio.details.bucket} | Face: ${data.minio.details.faceBucket}`;
                            const parts = data.minio.details.endpoint.split(':');
                            if (parts.length > 0) ip = parts[0];
                            if (parts.length > 1) port = parts[1];
                        }
                    } else if (node.id === 'waha' && data.waha) {
                        nodeStatus = data.waha.status === 'connected' ? 'connected' : 'error';
                        borderColor = nodeStatus === 'connected' ? '#22c55e' : '#ef4444';
                        if (data.waha.details) {
                            stats = `${data.waha.details.sessions} ses. · ${data.waha.details.sessionStatus || '-'}`;
                            const parts = data.waha.details.endpoint.split(':');
                            if (parts.length > 0) ip = parts[0];
                            if (parts.length > 1) port = parts[1];
                        }
                    } else if (node.id === 'omni-lpr' && data.omniLpr) {
                        nodeStatus = data.omniLpr.status;
                        borderColor = nodeStatus === 'connected' ? '#22c55e' : '#ef4444';
                        if (data.omniLpr.details) {
                            stats = data.omniLpr.details.version;
                            const partes = String(data.omniLpr.details.endpoint || '').split(':');
                            if (partes[0]) ip = partes[0];
                            if (partes[1]) port = partes[1];
                        }
                    } else if (node.id === 'tracking' && data.tracking) {
                        nodeStatus = data.tracking.status;
                        borderColor = nodeStatus === 'connected' ? '#22c55e'
                            : nodeStatus === 'disabled' ? '#6b7280' : '#ef4444';
                        const d = data.tracking.details;
                        if (d) {
                            stats = d.cameras === 0
                                ? 'Sin cámaras cargadas'
                                : `${d.cameras} cám · ${d.sightings24h} lecturas 24h`;
                        }
                    } else if (node.id === 'cams-track' && data.tracking) {
                        const cant = data.tracking.details?.cameras ?? 0;
                        nodeStatus = cant > 0 ? 'connected' : 'disabled';
                        borderColor = cant > 0 ? '#22c55e' : '#6b7280';
                        stats = cant > 0 ? `${cant} canal(es)` : 'Ninguna configurada';
                    } else if (node.id === 'lpr-node') {
                        nodeStatus = 'connected';
                        borderColor = '#22c55e';
                    }  else if (node.id === 'redis' || node.id === 'media') {
                        nodeStatus = 'connected';
                        borderColor = '#22c55e';
                    }

                    return {
                        ...node,
                        data: { ...node.data, status: nodeStatus, stats, ip, port },
                        style: {
                            ...node.style,
                            border: `2px solid ${borderColor}`,
                            boxShadow: nodeStatus === 'connected'
                                ? `0 0 20px ${borderColor}40`
                                : nodeStatus === 'error'
                                    ? `0 0 20px ${borderColor}40`
                                    : 'none'
                        }
                    };
                }));

            } catch (err) {
                console.error("Status fetch error", err);
            }
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 3000);
        return () => clearInterval(interval);
    }, []);

    const nodesWithIcons = nodes.map(node => {
        if (node.type === 'webhook') return node;

        const Icon = node.data.icon;
        const status = node.data.status || 'unknown';

        return {
            ...node,
            data: {
                ...node.data,
                label: (
                    <div className={cn(
                        "flex flex-col items-center justify-center h-full gap-1 p-1 transition-all duration-300",
                        status === 'connected' && "animate-pulse-subtle",
                        status === 'error' && "animate-pulse-error",
                        status === 'active' && "animate-pulse-webhook"
                    )}>
                        <div className="flex items-center gap-2 mb-1 w-full justify-center">
                            {Icon && <Icon className={cn(
                                node.id === 'lpr-node' ? "text-indigo-400" : "text-foreground/70",
                                status === 'connected' && "text-emerald-400",
                                status === 'error' && "text-red-400",
                                status === 'active' && "text-blue-400"
                            )} size={18} />}
                            <div className={cn(
                                "font-bold uppercase tracking-tighter",
                                node.id === 'lpr-node' ? "text-sm text-foreground" : "text-[11px] text-foreground"
                            )}>
                                {node.data.label}
                            </div>
                        </div>
                        {node.data.sub && (
                            <div className="text-[9px] text-muted-foreground font-mono uppercase tracking-wider">
                                {node.data.sub}
                            </div>
                        )}
                        <div className="mt-1 space-y-0.5 w-full">
                            <div className="flex items-center justify-between px-2">
                                <span className="text-[8px] text-muted-foreground font-bold uppercase">Network</span>
                                <span className="text-[8px] text-muted-foreground font-mono">{node.data.ip}:{node.data.port}</span>
                            </div>
                            {node.data.stats && (
                                <div className="flex items-center justify-between px-2">
                                    <span className="text-[8px] text-muted-foreground font-bold uppercase">Data</span>
                                    <span className="text-[8px] text-muted-foreground font-mono">{node.data.stats}</span>
                                </div>
                            )}
                        </div>
                        {status !== 'unknown' && (
                            <div className={cn(
                                "mt-1 w-2 h-2 rounded-full",
                                status === 'connected' && "bg-emerald-500 animate-pulse",
                                status === 'error' && "bg-red-500 animate-pulse",
                                status === 'idle' && "bg-blue-500",
                                status === 'active' && "bg-blue-500 animate-ping",
                                status === 'disabled' && "bg-muted"
                            )} />
                        )}
                    </div>
                )
            }
        };
    });

    return (
        <div className="w-full h-full">
            <style jsx global>{`
                @keyframes pulse-subtle {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.9; }
                }
                @keyframes pulse-error {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                @keyframes pulse-webhook {
                    0%, 100% { transform: scale(1); }
                    10% { transform: scale(1.1); }
                    30% { transform: scale(0.95); }
                    50% { transform: scale(1.05); }
                }
                .animate-pulse-subtle {
                    animation: pulse-subtle 3s ease-in-out infinite;
                }
                .animate-pulse-error {
                    animation: pulse-error 1.5s ease-in-out infinite;
                }
                .animate-pulse-webhook {
                    animation: pulse-webhook 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
            `}</style>
            <ReactFlow
                nodes={nodesWithIcons}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                edgeTypes={edgeTypes}
                nodeTypes={nodeTypes}
                connectionLineStyle={connectionLineStyle}
                fitView
                fitViewOptions={fitViewOptions}
                attributionPosition="bottom-left"
            >
                <Background color="var(--border)" gap={16} />
            </ReactFlow>
        </div>
    );
}
