
import React, { useState, useEffect } from 'react';
import { GameEngine } from '../game/Engine';
import { FSRMode } from '../types';

interface PauseMenuProps {
    onResume: () => void;
    onRestart: () => void;
    onQuit: () => void;
    onChangeFOV: (fov: number) => void;
}

export const PauseMenu: React.FC<PauseMenuProps> = ({ onResume, onRestart, onQuit, onChangeFOV }) => {
    
    // Read initial values from engine
    const [fov, setFov] = useState(90);
    const [rayTracing, setRayTracing] = useState(false);
    const [fsrMode, setFsrMode] = useState<FSRMode>('OFF');

    useEffect(() => {
        const engine = GameEngine.getInstance();
        if (engine.player) {
            setFov(engine.player.baseFov);
        }
        setRayTracing(engine.rayTracingEnabled);
        if (engine.fsr) {
            setFsrMode(engine.fsr.currentMode);
        }
    }, []);

    const toggleFOV = () => {
        const options = [70, 80, 90, 100, 110, 120];
        const idx = options.indexOf(fov);
        const next = options[(idx + 1) % options.length];
        setFov(next);
        onChangeFOV(next);
    };

    const toggleFSR = () => {
        const modes: FSRMode[] = ['OFF', 'ULTRA_QUALITY', 'QUALITY', 'BALANCED', 'PERFORMANCE'];
        const idx = modes.indexOf(fsrMode);
        const next = modes[(idx + 1) % modes.length];
        setFsrMode(next);
        GameEngine.getInstance().setFSRMode(next); 
    };

    const toggleRTX = () => {
        const newState = !rayTracing;
        setRayTracing(newState);
        const engine = GameEngine.getInstance();
        engine.updateGraphicsSettings({
            mode: engine.currentMode,
            difficulty: 'MEDIUM', 
            graphics: 'HIGH',     
            sound: true,
            fov: fov,
            rayTracing: newState,
            fsrMode: fsrMode // preserve current
        });
    };

    return (
        <div className="absolute inset-0 z-50 flex flex-col justify-center pointer-events-auto font-console select-none">
            
            {/* Dark Vignette Background */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"></div>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,rgba(0,0,0,0.8)_0%,transparent_70%)]"></div>

            {/* Menu Container (Left Aligned) */}
            <div className="relative z-10 ml-[8%] flex flex-col items-start gap-2 animate-in slide-in-from-left duration-300">
                
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-7xl font-black text-white italic tracking-tighter uppercase drop-shadow-2xl">
                        PAUSADO
                    </h1>
                    <div className="flex items-center gap-2">
                        <div className="h-2 w-24 bg-orange-500"></div>
                        <span className="text-orange-500 font-bold tracking-[0.5em] uppercase text-sm">
                            Sistema Parado
                        </span>
                    </div>
                </div>

                {/* Menu Options */}
                <div className="flex flex-col gap-4">
                    
                    {/* RESUME */}
                    <button 
                        onClick={onResume}
                        className="group flex items-center gap-4 focus:outline-none transition-all duration-200 hover:translate-x-4"
                    >
                         <div className="w-1 h-8 bg-white/20 group-hover:bg-orange-500 transition-colors duration-200"></div>
                         <span className="text-5xl font-black text-white/80 uppercase tracking-tight group-hover:text-white transition-colors shadow-black drop-shadow-lg">
                            CONTINUAR
                         </span>
                    </button>

                    {/* RESTART */}
                    <button 
                        onClick={onRestart}
                        className="group flex items-center gap-4 focus:outline-none transition-all duration-200 hover:translate-x-4"
                    >
                         <div className="w-1 h-8 bg-white/20 group-hover:bg-cyan-400 transition-colors duration-200"></div>
                         <span className="text-5xl font-black text-white/80 uppercase tracking-tight group-hover:text-cyan-400 transition-colors shadow-black drop-shadow-lg">
                            REINICIAR MISSÃO
                         </span>
                    </button>

                    {/* FSR TOGGLE */}
                    <button 
                        onClick={toggleFSR}
                        className="group flex items-center gap-4 focus:outline-none transition-all duration-200 hover:translate-x-4 mt-2"
                    >
                         <div className="w-1 h-6 bg-white/20 group-hover:bg-green-500 transition-colors duration-200"></div>
                         <span className="text-4xl font-bold text-white/60 uppercase tracking-tight group-hover:text-green-400 transition-colors shadow-black drop-shadow-lg">
                            AMD FSR: <span className={fsrMode !== 'OFF' ? 'text-green-300' : 'text-white/50'}>[{fsrMode.replace('_', ' ')}]</span>
                         </span>
                    </button>

                    {/* RTX TOGGLE */}
                    <button 
                        onClick={toggleRTX}
                        className="group flex items-center gap-4 focus:outline-none transition-all duration-200 hover:translate-x-4"
                    >
                         <div className="w-1 h-6 bg-white/20 group-hover:bg-purple-500 transition-colors duration-200"></div>
                         <span className="text-4xl font-bold text-white/60 uppercase tracking-tight group-hover:text-purple-400 transition-colors shadow-black drop-shadow-lg">
                            RAY TRACING: [{rayTracing ? 'ON' : 'OFF'}]
                         </span>
                    </button>

                    {/* FOV SETTING */}
                    <button 
                        onClick={toggleFOV}
                        className="group flex items-center gap-4 focus:outline-none transition-all duration-200 hover:translate-x-4"
                    >
                         <div className="w-1 h-6 bg-white/20 group-hover:bg-blue-400 transition-colors duration-200"></div>
                         <span className="text-4xl font-bold text-white/60 uppercase tracking-tight group-hover:text-blue-400 transition-colors shadow-black drop-shadow-lg">
                            CAMPO DE VISÃO: [{fov}]
                         </span>
                    </button>

                    {/* MAIN MENU */}
                    <button 
                        onClick={onQuit}
                        className="group flex items-center gap-4 focus:outline-none transition-all duration-200 hover:translate-x-4 mt-4 border-t border-white/10 pt-4"
                    >
                         <div className="w-1 h-6 bg-transparent group-hover:bg-red-500 transition-colors duration-200"></div>
                         <span className="text-3xl font-bold text-white/50 uppercase tracking-widest group-hover:text-red-500 transition-colors shadow-black drop-shadow-lg">
                            ABORTAR MISSÃO
                         </span>
                    </button>

                </div>
            </div>

            {/* Right Side Stats */}
            <div className="absolute right-[5%] bottom-[20%] text-right opacity-40">
                <div className="border-r-4 border-white/20 pr-4">
                    <h2 className="text-2xl font-bold text-white uppercase">Objetivo Pendente</h2>
                    <p className="font-mono text-sm text-white/70 mt-2">
                        PAUSA TÁTICA INICIADA.<br/>
                        RECURSOS DO SISTEMA: {fsrMode !== 'OFF' ? 'OTIMIZADO' : 'PADRÃO'}<br/>
                        CONEXÃO ESTÁVEL.
                    </p>
                </div>
            </div>

        </div>
    );
};
