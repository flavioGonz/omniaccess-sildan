
import { useCallback } from 'react';
import { useStore, getBezierPath, EdgeProps } from 'reactflow';
import { getEdgeParams } from './utils';
import { cn } from '@/lib/utils';

export default function FloatingEdge({ id, source, target, markerEnd, style, data }: EdgeProps) {
    const sourceNode = useStore(useCallback((store) => store.nodeInternals.get(source), [source]));
    const targetNode = useStore(useCallback((store) => store.nodeInternals.get(target), [target]));

    if (!sourceNode || !targetNode) {
        return null;
    }

    const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode);

    const [edgePath] = getBezierPath({
        sourceX: sx,
        sourceY: sy,
        sourcePosition: sourcePos,
        targetPosition: targetPos,
        targetX: tx,
        targetY: ty,
    });

    const isConnected = data?.status !== 'error';
    const isPending = data?.status === 'unknown' || data?.latency === undefined;

    return (
        <>
            <path
                id={id}
                className="react-flow__edge-path"
                d={edgePath}
                markerEnd={markerEnd}
                style={{
                    stroke: isPending ? '#555' : isConnected ? '#10b981' : '#ef4444',
                    strokeWidth: 2,
                    opacity: 0.5,
                    ...style // Allow overrides
                }}
            />
            {/* Animated flow line on top */}
            {isConnected && (
                <path
                    id={`${id}-anim`}
                    className="react-flow__edge-path"
                    d={edgePath}
                    style={{
                        stroke: isConnected ? '#34d399' : '#ef4444',
                        strokeWidth: 2,
                        strokeDasharray: 10,
                        animation: 'dashdraw 1s linear infinite',
                        opacity: 1
                    }}
                />
            )}
            <style>
                {`
                @keyframes dashdraw {
                    from {
                        stroke-dashoffset: 200;
                    }
                    to {
                        stroke-dashoffset: 0;
                    }
                }
            `}
            </style>
            {/* Latency Label */}
            <text>
                <textPath
                    href={`#${id}`}
                    style={{ fontSize: 10, fill: isConnected ? '#fff' : '#ef4444', opacity: 0.6 }}
                    startOffset="50%"
                    textAnchor="middle"
                >
                    {data?.latency ? `${data.latency}ms` : ''}
                </textPath>
            </text>

            {/* Data Packet Sphere Animation */}
            {data?.status === 'active' && (
                <g>
                    <defs>
                        <radialGradient id={`glow-${id}`}>
                            <stop offset="0%" stopColor={data?.packetColor || "#3b82f6"} stopOpacity="1" />
                            <stop offset="100%" stopColor={data?.packetColor || "#3b82f6"} stopOpacity="0" />
                        </radialGradient>
                    </defs>

                    {/* Outer Glow Aura */}
                    <circle r="8" fill={`url(#glow-${id})`} style={{ opacity: 0.6 }}>
                        <animateMotion dur="0.6s" repeatCount="indefinite" path={edgePath} />
                    </circle>

                    {/* Motion Blur Sphere */}
                    <circle r="5" fill={data?.packetColor || "#3b82f6"} style={{ filter: 'blur(1.5px)' }}>
                        <animateMotion dur="0.6s" repeatCount="indefinite" path={edgePath} />
                    </circle>

                    {/* Solid Core with Pulse */}
                    <circle r="3" fill="#fff">
                        <animateMotion dur="0.6s" repeatCount="indefinite" path={edgePath} />
                        <animate attributeName="r" values="2.5;3.5;2.5" dur="0.3s" repeatCount="indefinite" />
                    </circle>
                </g>
            )}
        </>
    );
}
