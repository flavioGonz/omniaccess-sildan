"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import * as d3 from "d3";
import { TreeNode } from "@/app/actions/structure";
import {
    LayoutDashboard, Users, Car, ShieldCheck, History, Settings,
    DoorOpen, LayoutGrid, HardDrive, Activity, BarChart3, Search,
    User, FileText, Key, ScanFace, Fingerprint, PlusCircle, CheckCircle2, XCircle,
    Camera, Code2, Webhook as WebhookIcon, Tablet, Lock, ListChecks, Clock,
    FileSpreadsheet, Image, Shield, Plus, Trash2, Edit2, Save, X, Home, CreditCard,
    Maximize2, Minimize2, Zap, Info, RefreshCcw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { updateProjectStructure } from "@/app/actions/structure";
import { sileo as toast } from "sileo";

interface TreeDiagramProps {
    data: TreeNode;
}

const MATCH_ICONS: Record<string, any> = {
    LayoutDashboard, Users, Car, ShieldCheck, History, Settings,
    DoorOpen, LayoutGrid, HardDrive, Activity, BarChart3, Search,
    User, FileText, Key, ScanFace, Fingerprint, PlusCircle, CheckCircle2, XCircle,
    Camera, Code2, Webhook: WebhookIcon, Tablet, Lock, ListChecks, Clock,
    FileSpreadsheet, Image, Shield, Home, CreditCard, Zap
};

export function TreeDiagram({ data: initialData }: TreeDiagramProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const gRef = useRef<SVGGElement>(null);
    const [treeData, setTreeData] = useState<TreeNode>(initialData);
    const [editingNode, setEditingNode] = useState<TreeNode | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Tree Manipulation Helpers
    const addNode = (parentId: string) => {
        const newNode: TreeNode = {
            id: Math.random().toString(36).substr(2, 9),
            name: "Nuevo Módulo",
            type: "feature",
            status: "pending",
            description: "Nueva funcionalidad del sistema"
        };

        const updateTree = (node: TreeNode): TreeNode => {
            if (node.id === parentId) {
                return { ...node, children: [...(node.children || []), newNode] };
            }
            if (node.children) {
                return { ...node, children: node.children.map(updateTree) };
            }
            return node;
        };

        const newTree = updateTree({ ...treeData });
        setTreeData(newTree);
        persistTree(newTree);
    };

    const persistTree = async (data: TreeNode) => {
        setIsSaving(true);
        try {
            await updateProjectStructure(data);
            toast.success({ title: "Arquitectura sincronizada" });
        } catch (error) {
            toast.error({ title: "Error al guardar cambios" });
        } finally {
            setIsSaving(false);
        }
    };

    const removeNode = (id: string) => {
        if (id === "root") return;
        const updateTree = (node: TreeNode): TreeNode | null => {
            if (node.id === id) return null;
            if (node.children) {
                const newChildren = node.children.map(updateTree).filter(Boolean) as TreeNode[];
                return { ...node, children: newChildren };
            }
            return node;
        };
        const result = updateTree({ ...treeData });
        if (result) {
            setTreeData(result);
            persistTree(result);
        }
    };

    const saveEdit = (updatedNode: Partial<TreeNode>) => {
        const updateTree = (node: TreeNode): TreeNode => {
            if (node.id === editingNode?.id) {
                return { ...node, ...updatedNode };
            }
            if (node.children) {
                return { ...node, children: node.children.map(updateTree) };
            }
            return node;
        };
        const newTree = updateTree({ ...treeData });
        setTreeData(newTree);
        persistTree(newTree);
        setEditingNode(null);
    };

    // Calculate Tree Layout
    const hierarchy = useMemo(() => {
        if (!treeData) return null;

        const rootDataset = d3.hierarchy(treeData);
        const dx = 60;  // Vertical separation
        const dy = 260; // Horizontal separation

        const treeLayout = d3.tree<TreeNode>().nodeSize([dx, dy]);
        treeLayout(rootDataset);

        let x0 = Infinity;
        let x1 = -Infinity;
        rootDataset.each((d: any) => {
            if (d.x > x1) x1 = d.x;
            if (d.x < x0) x0 = d.x;
        });

        const height = x1 - x0 + dx * 2;
        return { root: rootDataset as d3.HierarchyPointNode<TreeNode>, x0, x1, height };
    }, [treeData]);

    // Zoom and Init
    useEffect(() => {
        if (!svgRef.current || !gRef.current || !hierarchy) return;

        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 3])
            .on("zoom", (event) => {
                d3.select(gRef.current).attr("transform", event.transform);
            });

        const selection = d3.select(svgRef.current);
        selection.call(zoom);

        const centerTimer = setTimeout(() => {
            if (svgRef.current) {
                const initialTransform = d3.zoomIdentity.translate(160, (svgRef.current.clientHeight / 2) - hierarchy.root.x);
                selection.call(zoom.transform, initialTransform);
            }
        }, 100);

        return () => clearTimeout(centerTimer);
    }, [hierarchy]);

    if (!hierarchy) return null;
    const { root } = hierarchy;

    return (
        <div className={cn(
            "w-full h-full bg-[#080808] relative overflow-hidden transition-all duration-500 rounded-3xl border border-border",
            isFullScreen ? "fixed inset-0 z-[100] rounded-none border-none" : "shadow-lg"
        )}>
            {/* Legend & Controls Overlay */}
            <div className="absolute top-6 left-6 z-20 flex flex-col gap-4 pointer-events-none">
                <div className="bg-black/60 backdrop-blur-xl border border-border p-4 rounded-2xl flex flex-col gap-2 shadow-lg pointer-events-auto">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                        <span className="text-[9px] font-bold text-foreground/70 uppercase tracking-widest">Operativo</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)] animate-pulse" />
                        <span className="text-[9px] font-bold text-foreground/70 uppercase tracking-widest">En Desarrollo</span>
                    </div>
                    {isSaving && (
                        <div className="mt-2 pt-2 border-t border-border flex items-center gap-2">
                            <RefreshCcw size={10} className="text-blue-400 animate-spin" />
                            <span className="text-[8px] font-bold text-blue-400 uppercase tracking-widest">Guardando...</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="absolute top-6 right-6 z-20 flex gap-3">
                <Button
                    variant="outline" size="icon"
                    className="bg-card border-border hover:bg-muted rounded-xl"
                    onClick={() => setIsFullScreen(!isFullScreen)}
                >
                    {isFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </Button>
                <div className="flex flex-col gap-1.5">
                    <Button
                        variant="outline" size="icon"
                        className="bg-card border-border hover:bg-muted rounded-xl h-10 w-10"
                        onClick={() => d3.select(svgRef.current).transition().call(d3.zoom<SVGSVGElement, any>().scaleBy as any, 1.3)}
                    >
                        <Plus size={18} />
                    </Button>
                    <Button
                        variant="outline" size="icon"
                        className="bg-card border-border hover:bg-muted rounded-xl h-10 w-10"
                        onClick={() => d3.select(svgRef.current).transition().call(d3.zoom<SVGSVGElement, any>().scaleBy as any, 0.7)}
                    >
                        <div className="w-4 h-0.5 bg-current rounded-full" />
                    </Button>
                </div>
            </div>

            {/* SVG Content */}
            <svg ref={svgRef} width="100%" height="100%" className="cursor-grab active:cursor-grabbing">
                <g ref={gRef}>
                    <defs>
                        <linearGradient id="link-grad-ok" gradientUnits="userSpaceOnUse">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0" />
                            <stop offset="50%" stopColor="#10b981" stopOpacity="0.2" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id="link-grad-err" gradientUnits="userSpaceOnUse">
                            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.1" />
                            <stop offset="50%" stopColor="#ef4444" stopOpacity="0.5" />
                            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.1" />
                        </linearGradient>
                    </defs>

                    {/* Links */}
                    <g fill="none">
                        {root.links().map((link, i) => {
                            const isPending = link.target.data.status !== 'done';
                            const genLink = d3.linkHorizontal<any, any>().x((d) => d.y).y((d) => d.x);
                            return (
                                <path
                                    key={i}
                                    d={genLink(link) || ""}
                                    stroke={isPending ? "url(#link-grad-err)" : "url(#link-grad-ok)"}
                                    strokeWidth={isPending ? 1.5 : 1}
                                    strokeDasharray={isPending ? "4 4" : "0"}
                                />
                            );
                        })}
                    </g>

                    {/* Nodes */}
                    <g>
                        {root.descendants().map((node: any, i) => {
                            const Icon = node.data.icon ? MATCH_ICONS[node.data.icon] : null;
                            const statusColor = node.data.status === 'done' ? '#10b981' : '#ef4444';

                            return (
                                <g key={i} transform={`translate(${node.y},${node.x})`} className="group/node">
                                    <circle
                                        r={node.data.type === 'section' ? 5 : 3}
                                        fill={node.data.status === 'done' ? "#10b98133" : "#ef444422"}
                                        stroke={statusColor}
                                        strokeWidth={1.5}
                                        className="transition-all duration-300 group-hover/node:r-6"
                                    />

                                    <foreignObject width="220" height="80" x={12} y={-20}>
                                        <div className="flex flex-col gap-1 p-0.5">
                                            <div className={cn(
                                                "inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl border backdrop-blur-md transition-all duration-300 group hover:shadow-lg hover:shadow-white/5",
                                                node.data.type === 'section'
                                                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-100'
                                                    : 'bg-card border-border text-muted-foreground'
                                            )}>
                                                {Icon && <Icon size={11} className="opacity-60" />}
                                                <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap truncate max-w-[120px]">
                                                    {node.data.name}
                                                </span>

                                                <div className="flex items-center gap-1 opacity-0 group-hover/node:opacity-100 transition-opacity ml-1 border-l border-border pl-2 pointer-events-auto">
                                                    <button onClick={() => addNode(node.data.id)} className="p-1 hover:text-emerald-400"><Plus size={12} /></button>
                                                    <button onClick={() => setEditingNode(node.data)} className="p-1 hover:text-blue-400"><Settings size={10} /></button>
                                                    {node.data.id !== "root" && (
                                                        <button onClick={() => removeNode(node.data.id)} className="p-1 hover:text-red-400"><Trash2 size={10} /></button>
                                                    )}
                                                </div>
                                            </div>
                                            {node.data.description && (
                                                <div className="text-[8px] font-medium text-muted-foreground uppercase tracking-tighter px-2 truncate max-w-[180px]">
                                                    {node.data.description}
                                                </div>
                                            )}
                                        </div>
                                    </foreignObject>
                                </g>
                            );
                        })}
                    </g>
                </g>
            </svg>

            {/* Edit Modal */}
            {editingNode && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[110] p-4 animate-in fade-in duration-300">
                    <div className="bg-card rounded-3xl border border-border p-8 max-w-sm w-full shadow-lg space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-foreground uppercase tracking-tighter">Editar Módulo</h3>
                            <Button variant="ghost" size="icon" onClick={() => setEditingNode(null)} className="rounded-xl">
                                <X size={20} />
                            </Button>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nombre</label>
                                <input
                                    className="w-full h-10 bg-card border border-border rounded-xl px-4 text-xs font-bold text-foreground focus:outline-none"
                                    defaultValue={editingNode.name}
                                    onChange={(e) => editingNode.name = e.target.value}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Descripción</label>
                                <input
                                    className="w-full h-10 bg-card border border-border rounded-xl px-4 text-xs font-medium text-muted-foreground focus:outline-none"
                                    defaultValue={editingNode.description}
                                    onChange={(e) => editingNode.description = e.target.value}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Tipo</label>
                                    <select
                                        className="w-full h-10 bg-card border border-border rounded-xl px-3 text-[10px] font-bold text-foreground outline-none"
                                        defaultValue={editingNode.type}
                                        onChange={(e) => editingNode.type = e.target.value as any}
                                    >
                                        <option value="section">Sección</option>
                                        <option value="feature">Funcionalidad</option>
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Estado</label>
                                    <select
                                        className="w-full h-10 bg-card border border-border rounded-xl px-3 text-[10px] font-bold text-foreground outline-none"
                                        defaultValue={editingNode.status}
                                        onChange={(e) => editingNode.status = e.target.value as any}
                                    >
                                        <option value="done">OK</option>
                                        <option value="pending">Pendiente</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <Button
                            className="w-full bg-blue-600 hover:bg-blue-500 h-12 rounded-xl text-[10px] font-bold uppercase tracking-widest"
                            onClick={() => saveEdit(editingNode)}
                        >
                            Guardar Cambios
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
