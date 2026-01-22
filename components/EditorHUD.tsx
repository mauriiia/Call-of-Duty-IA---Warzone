
import React, { useState, useEffect } from 'react';
import { GameEngine } from '../game/Engine';
import * as THREE from 'three';

interface EditorHUDProps {
    activeTool: string;
    onExit: () => void;
}

const TOOLS = [
    { id: 'ROAD', label: 'Estrada', icon: '🛣️', color: 'border-gray-500' },
    { id: 'BUILDING', label: 'Prédio', icon: '🏢', color: 'border-blue-500' },
    { id: 'TREE', label: 'Árvore', icon: '🌲', color: 'border-green-500' },
    { id: 'ROCK', label: 'Pedra', icon: '🪨', color: 'border-stone-500' },
    { id: 'WALL', label: 'Muro', icon: '🧱', color: 'border-orange-500' },
    { id: 'BULLDOZER', label: 'Apagar', icon: '🚫', color: 'border-red-500' }
];

export const EditorHUD: React.FC<EditorHUDProps> = ({ activeTool: initialTool, onExit }) => {
    const [selectedTool, setSelectedTool] = useState(initialTool || 'ROAD');
    const [cursorInfo, setCursorInfo] = useState({ x: 0, y: 0, z: 0, rot: 0 });
    const [targetName, setTargetName] = useState("Nenhum");

    useEffect(() => {
        const interval = setInterval(() => {
            const sys = GameEngine.getInstance().editorSystem;
            if (sys) {
                setCursorInfo({
                    x: Math.round(sys.currentCursorPos.x * 10) / 10,
                    y: Math.round(sys.currentCursorPos.y * 10) / 10,
                    z: Math.round(sys.currentCursorPos.z * 10) / 10,
                    rot: Math.round(THREE.MathUtils.radToDeg(sys.currentRotation))
                });
                setTargetName(sys.currentHoveredObject === "None" ? "Nenhum" : sys.currentHoveredObject);
            }
        }, 100);
        return () => clearInterval(interval);
    }, []);

    const handleSetTool = (toolId: string) => {
        setSelectedTool(toolId);
        GameEngine.getInstance().setEditorTool(toolId);
    };

    const handleSave = () => {
        GameEngine.getInstance().editorSystem.saveMap();
    };

    const handleUndo = () => {
        GameEngine.getInstance().editorSystem.undo();
    };

    return (
        <div className="absolute inset-0 pointer-events-none select-none font-sans text-white">
            
            {/* --- TOP BAR (Actions) --- */}
            <div className="absolute top-0 left-0 right-0 h-14 bg-gray-900/95 border-b border-gray-700 flex items-center justify-between px-6 pointer-events-auto shadow-lg backdrop-blur-md">
                <div className="flex items-center gap-4">
                    <span className="font-black text-xl tracking-wider text-white">PROTON <span className="text-blue-500">DESIGNER</span></span>
                    <span className="bg-blue-900/50 text-blue-400 text-[10px] px-2 py-0.5 rounded border border-blue-800">ALPHA BUILD BR</span>
                </div>

                <div className="flex gap-2">
                    <button 
                        onClick={handleUndo} 
                        className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-1.5 rounded text-xs font-bold border border-gray-600 transition-all flex items-center gap-2"
                        title="Ctrl+Z"
                    >
                        <span>↩</span> DESFAZER
                    </button>
                    <div className="w-[1px] h-6 bg-gray-700 mx-2"></div>
                    <button 
                        onClick={handleSave} 
                        className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-1.5 rounded text-xs font-bold border border-blue-500 transition-all flex items-center gap-2"
                        title="Ctrl+S"
                    >
                        <span>💾</span> SALVAR
                    </button>
                    <button 
                        onClick={onExit} 
                        className="bg-red-900/80 hover:bg-red-800 text-red-200 px-4 py-1.5 rounded text-xs font-bold border border-red-800 transition-all ml-2"
                    >
                        SAIR
                    </button>
                </div>
            </div>

            {/* --- LEFT SIDEBAR (Tool Selection) --- */}
            <div className="absolute top-14 left-0 bottom-0 w-20 bg-gray-900/90 border-r border-gray-700 flex flex-col items-center py-6 gap-4 pointer-events-auto backdrop-blur-sm">
                {TOOLS.map((tool) => (
                    <button
                        key={tool.id}
                        onClick={(e) => {
                            handleSetTool(tool.id);
                            (e.currentTarget as HTMLElement).blur(); 
                        }}
                        className={`
                            relative w-12 h-12 rounded-lg flex flex-col items-center justify-center transition-all duration-200 group
                            ${selectedTool === tool.id 
                                ? `bg-gray-700 border-l-4 ${tool.color} text-white shadow-lg` 
                                : 'bg-transparent text-gray-500 hover:bg-gray-800 hover:text-gray-200'
                            }
                        `}
                    >
                        <span className="text-2xl mb-0.5">{tool.icon}</span>
                        
                        {/* Tooltip on Hover */}
                        <div className="absolute left-14 bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                            {tool.label}
                        </div>
                    </button>
                ))}
            </div>

            {/* --- RIGHT SIDEBAR (Inspector) --- */}
            <div className="absolute top-14 right-0 bottom-0 w-64 bg-gray-900/90 border-l border-gray-700 p-4 pointer-events-auto backdrop-blur-sm flex flex-col gap-6">
                
                {/* Object Info */}
                <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest border-b border-gray-700 pb-1">Inspetor</h3>
                    
                    <div className="bg-black/40 p-3 rounded border border-gray-700">
                        <label className="text-[10px] text-gray-400 uppercase block mb-1">Objeto Alvo</label>
                        <div className={`text-sm font-mono font-bold truncate ${selectedTool === 'BULLDOZER' ? 'text-red-400' : 'text-blue-400'}`}>
                            {targetName}
                        </div>
                    </div>
                </div>

                {/* Transform Data */}
                <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest border-b border-gray-700 pb-1">Transformação</h3>
                    
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-black/40 p-2 rounded text-center border border-gray-700">
                            <span className="text-[9px] text-red-500 block">X</span>
                            <span className="font-mono text-xs">{cursorInfo.x}</span>
                        </div>
                        <div className="bg-black/40 p-2 rounded text-center border border-gray-700">
                            <span className="text-[9px] text-green-500 block">Y</span>
                            <span className="font-mono text-xs">{cursorInfo.y}</span>
                        </div>
                        <div className="bg-black/40 p-2 rounded text-center border border-gray-700">
                            <span className="text-[9px] text-blue-500 block">Z</span>
                            <span className="font-mono text-xs">{cursorInfo.z}</span>
                        </div>
                    </div>

                    <div className="bg-black/40 p-2 rounded flex justify-between items-center border border-gray-700 mt-1">
                        <span className="text-[10px] text-gray-400 uppercase">Rotação (Y)</span>
                        <span className="font-mono text-xs text-yellow-400">{cursorInfo.rot}°</span>
                    </div>
                </div>

                {/* Controls Help */}
                <div className="mt-auto">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest border-b border-gray-700 pb-1 mb-2">Controles</h3>
                    <ul className="text-[10px] text-gray-400 space-y-1 font-mono">
                        <li className="flex justify-between"><span>WASD</span> <span className="text-white">Mover Câmera</span></li>
                        <li className="flex justify-between"><span>R</span> <span className="text-white">Rotacionar</span></li>
                        <li className="flex justify-between"><span>Scroll</span> <span className="text-white">Zoom</span></li>
                        <li className="flex justify-between"><span>Shift</span> <span className="text-white">Mover Rápido</span></li>
                        <li className="flex justify-between"><span>Clique</span> <span className="text-white">Ação</span></li>
                    </ul>
                </div>

            </div>

            {/* --- CENTER NOTIFICATION (Bulldozer Warning) --- */}
            {selectedTool === 'BULLDOZER' && (
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-red-900/80 border border-red-500 px-6 py-2 rounded-full flex items-center gap-3 animate-pulse">
                    <span className="text-xl">⚠️</span>
                    <span className="text-xs font-bold uppercase tracking-widest text-white">Modo Demolição Ativo</span>
                </div>
            )}

        </div>
    );
};
