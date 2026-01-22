
import React, { useState, useEffect, useRef } from 'react';
import { GameSettings, GameMode, FSRMode } from '../types';
import { SoundManager } from '../game/SoundManager';

interface MainMenuProps {
    onStartGame: (settings: GameSettings) => void;
}

const LOADING_TEXTS = [
    "INITIALIZING BOOT SEQUENCE...",
    "VERIFYING SECURITY TOKENS...",
    "CONNECTING TO DATACENTER: SA_EAST_1...",
    "FETCHING PLAYER PROFILE...",
    "LOADING ASSETS...",
    "COMPILING SHADERS (45%)...",
    "COMPILING SHADERS (89%)...",
    "SYNCHRONIZING GAME STATE...",
    "READY."
];

export const MainMenu: React.FC<MainMenuProps> = ({ onStartGame }) => {
    // Stages: SPLASH -> LOADING -> MENU
    const [stage, setStage] = useState<'SPLASH' | 'LOADING' | 'MENU'>('SPLASH');
    
    // Loading State
    const [progress, setProgress] = useState(0);
    const [loadingText, setLoadingText] = useState(LOADING_TEXTS[0]);
    
    // Transition State (Controls the shutter opening)
    const [shutterOpen, setShutterOpen] = useState(false);

    const [settings, setSettings] = useState<GameSettings>({
        mode: 'BATTLE_ROYALE',
        difficulty: 'MEDIUM',
        graphics: 'MEDIUM',
        sound: true,
        fov: 90,
        rayTracing: false,
        fsrMode: 'OFF'
    });

    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Generate random sparks configuration only once
    const sparks = React.useMemo(() => Array.from({ length: 50 }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        size: Math.random() * 4 + 2, // 2px to 6px
        duration: Math.random() * 5 + 4, // 4s to 9s
        delay: Math.random() * -10, // Negative delay to start mid-air
        drift: `${(Math.random() - 0.5) * 150}px` // Horizontal drift
    })), []);

    // INPUT HANDLER (UNLOCK AUDIO CONTEXT)
    useEffect(() => {
        const handleInput = () => {
            if (stage === 'SPLASH') {
                // Resume Audio Context for the game engine later
                SoundManager.getInstance().resumeContext();

                // FIX: Play music SILENTLY to unlock browser autoplay policy.
                // We will restart it and turn up volume when the shutter opens.
                if (audioRef.current) {
                    audioRef.current.volume = 0; 
                    audioRef.current.play().catch(e => console.warn("Music autoplay blocked:", e));
                }
                
                // Advance visual state to loading bar
                setStage('LOADING');
            }
        };
        
        window.addEventListener('keydown', handleInput);
        window.addEventListener('mousedown', handleInput);
        return () => {
            window.removeEventListener('keydown', handleInput);
            window.removeEventListener('mousedown', handleInput);
        }
    }, [stage]);

    // MUSIC SYNC WITH SHUTTER
    useEffect(() => {
        if (shutterOpen && audioRef.current) {
            // Now that the menu is visible, restart music and set volume
            audioRef.current.currentTime = 0;
            audioRef.current.volume = 0.5; // 50% Volume
        }
    }, [shutterOpen]);

    // LOADING SEQUENCE LOGIC
    useEffect(() => {
        if (stage === 'LOADING') {
            let currentProgress = 0;
            const interval = setInterval(() => {
                // Non-linear loading speed for realism
                const increment = Math.random() * 2.5; 
                currentProgress += increment;
                
                // Update Text based on progress milestones
                const textIndex = Math.min(
                    LOADING_TEXTS.length - 1, 
                    Math.floor((currentProgress / 100) * LOADING_TEXTS.length)
                );
                setLoadingText(LOADING_TEXTS[textIndex]);

                if (currentProgress >= 100) {
                    currentProgress = 100;
                    clearInterval(interval);
                    
                    // Start Transition (Shutter Open)
                    setTimeout(() => {
                        setShutterOpen(true);
                        // Switch state after animation completes to enable interaction
                        setTimeout(() => {
                            setStage('MENU');
                        }, 800); // Matches CSS transition duration
                    }, 500);
                }
                setProgress(currentProgress);
            }, 30); // Speed of update

            return () => clearInterval(interval);
        }
    }, [stage]);

    // Toggles
    const toggleMode = () => {
        const modes: GameMode[] = ['BATTLE_ROYALE', 'TRAINING', 'EDITOR'];
        const idx = modes.indexOf(settings.mode);
        const next = modes[(idx + 1) % modes.length];
        setSettings(prev => ({ ...prev, mode: next }));
    };

    const toggleDifficulty = () => {
        const levels = ['EASY', 'MEDIUM', 'HARD'] as const;
        const idx = levels.indexOf(settings.difficulty);
        const next = levels[(idx + 1) % levels.length];
        setSettings(prev => ({ ...prev, difficulty: next }));
    };

    const toggleGraphics = () => {
        const levels = ['LOW', 'MEDIUM', 'HIGH'] as const;
        const idx = levels.indexOf(settings.graphics);
        const next = levels[(idx + 1) % levels.length];
        setSettings(prev => ({ ...prev, graphics: next }));
    };

    const toggleFSR = () => {
        const modes: FSRMode[] = ['OFF', 'ULTRA_QUALITY', 'QUALITY', 'BALANCED', 'PERFORMANCE'];
        const idx = modes.indexOf(settings.fsrMode);
        const next = modes[(idx + 1) % modes.length];
        setSettings(prev => ({ ...prev, fsrMode: next }));
    };

    const handleStart = () => {
        // FIX: Explicitly stop music when starting the game
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        onStartGame(settings);
    };

    // Translation Helpers
    const getModeName = (mode: GameMode) => {
        switch(mode) {
            case 'BATTLE_ROYALE': return 'BATTLE ROYALE';
            case 'TRAINING': return 'TREINO';
            case 'EDITOR': return 'EDITOR DE MAPA';
            default: return mode;
        }
    };

    const getDifficultyName = (diff: string) => {
        switch(diff) {
            case 'EASY': return 'FÁCIL';
            case 'MEDIUM': return 'MÉDIO';
            case 'HARD': return 'DIFÍCIL';
            default: return diff;
        }
    };

    const getGraphicsName = (graph: string) => {
        switch(graph) {
            case 'LOW': return 'BAIXO';
            case 'MEDIUM': return 'MÉDIO';
            case 'HIGH': return 'ALTO';
            default: return graph;
        }
    };

    const getFSRName = (mode: string) => {
        switch(mode) {
            case 'OFF': return 'DESLIGADO';
            case 'ULTRA_QUALITY': return 'ULTRA QUALIDADE';
            case 'QUALITY': return 'QUALIDADE';
            case 'BALANCED': return 'EQUILIBRADO';
            case 'PERFORMANCE': return 'PERFORMANCE';
            default: return mode;
        }
    };

    // --- ASSETS ---
    const splashImageURL = "https://i.imgur.com/xOuXXB8.jpeg";
    const menuImageURL = "https://i.imgur.com/oXPlGa9.jpeg";
    
    // Music and Sound - Using user provided link with raw=1
    const menuMusicURL = "https://www.dropbox.com/scl/fi/owswkwa2zflwey848tdnr/Untitled-2.mp3?rlkey=k53u47expvn9yw3twk4s2w6uf&st=oyhxe56e&raw=1"; 

    return (
        <>
            {/* --- PERSISTENT AUDIO ELEMENTS --- */}
            {/* Music: Loops */}
            <audio ref={audioRef} src={menuMusicURL} loop preload="auto" />

            {/* --- SPLASH SCREEN LAYER --- */}
            {stage === 'SPLASH' && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-auto bg-black font-console select-none overflow-hidden">
                     <div className="absolute inset-0 bg-cover bg-center opacity-60" style={{ backgroundImage: `url('${splashImageURL}')` }}></div>
                     <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/20"></div>
                     
                     <div className="z-10 flex flex-col items-center animate-pulse">
                        <h2 className="text-4xl font-bold text-white italic tracking-widest uppercase mb-[-10px] transform -skew-x-12 drop-shadow-lg">
                            Call of Duty IA
                        </h2>
                        <h1 className="text-9xl font-black text-white italic tracking-tighter drop-shadow-2xl transform -skew-x-12">
                            WAR<span className="text-lime-500">ZONE</span>
                        </h1>
                        <div className="h-1 w-full bg-lime-500 my-4 shadow-[0_0_15px_rgba(132,204,22,0.8)]"></div>
                        <span className="text-2xl font-bold text-white tracking-[0.5em] uppercase animate-bounce mt-8">
                            Pressione Qualquer Tecla
                        </span>
                     </div>
                     
                     <div className="absolute bottom-8 right-8 text-white/30 font-tactical text-xs tracking-widest uppercase">
                        Proton Engine v1.0 // Build 8944 // BR
                     </div>
                </div>
            )}

            {/* --- MAIN MENU & LOADING LAYERS --- */}
            {stage !== 'SPLASH' && (
                <>
                    {/* --- LOADING OVERLAY (THE SHUTTER) --- */}
                    <div className="absolute inset-0 z-[60] pointer-events-none flex flex-col overflow-hidden">
                        
                        {/* TOP SHUTTER */}
                        <div 
                            className="relative w-full bg-black flex flex-col justify-end items-center pb-4 border-b border-gray-800 transition-transform duration-700 ease-in-out z-20"
                            style={{ 
                                height: '50%', 
                                transform: shutterOpen ? 'translateY(-100%)' : 'translateY(0%)'
                            }}
                        >
                            {/* Content visible only during loading */}
                            {!shutterOpen && (
                                <div className="absolute bottom-10 flex flex-col items-center gap-1 w-1/3 opacity-20">
                                    <h2 className="text-xl font-bold text-white tracking-widest uppercase transform -skew-x-12">Call of Duty IA</h2>
                                    <h1 className="text-6xl font-black text-white italic tracking-tighter transform -skew-x-12">
                                        WARZONE
                                    </h1>
                                </div>
                            )}
                        </div>

                        {/* BOTTOM SHUTTER */}
                        <div 
                            className="relative w-full bg-black flex flex-col justify-start items-center pt-8 border-t border-gray-800 transition-transform duration-700 ease-in-out z-20"
                            style={{ 
                                height: '50%', 
                                transform: shutterOpen ? 'translateY(100%)' : 'translateY(0%)'
                            }}
                        >
                            {/* LOADING BAR (Only visible if shutter is NOT open) */}
                            {!shutterOpen && (
                                <div className="w-full max-w-4xl px-8 flex flex-col gap-2">
                                    <div className="flex justify-between items-end">
                                        <span className="text-lime-500 font-bold font-mono text-sm tracking-widest animate-pulse">
                                            {loadingText}
                                        </span>
                                        <span className="text-white font-black text-2xl">
                                            {Math.floor(progress)}%
                                        </span>
                                    </div>
                                    
                                    {/* PROGRESS BAR CONTAINER */}
                                    <div className="w-full h-2 bg-gray-900 rounded-sm overflow-hidden relative border border-gray-700">
                                        <div 
                                            className="h-full bg-lime-500 shadow-[0_0_10px_rgba(132,204,22,0.8)] transition-all duration-75 ease-out"
                                            style={{ width: `${progress}%` }}
                                        ></div>
                                        {/* Scanline effect on bar */}
                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_1s_infinite]"></div>
                                    </div>

                                    <div className="flex justify-between text-gray-600 text-[10px] font-mono mt-1">
                                        <span>UID: 8493-2910-4492</span>
                                        <span>SERVER: SA_EAST (14ms)</span>
                                        <span>VER: 1.0.42</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* --- ACTUAL MAIN MENU (Behind the shutter) --- */}
                    <div id="main-menu" className={`absolute inset-0 z-50 pointer-events-none font-console select-none overflow-hidden bg-black transition-all duration-1000 ${shutterOpen ? 'scale-100' : 'scale-105'}`}>
                        
                        {/* Background Image Layer */}
                        <div className="absolute inset-0 bg-cover bg-center opacity-40 transition-opacity duration-1000" style={{ backgroundImage: `url('${menuImageURL}')` }}></div>
                        
                        {/* Background Vignette */}
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.4)_40%,transparent_100%)] pointer-events-none"></div>

                        {/* --- SPARKS / EMBERS OVERLAY --- */}
                        <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
                            {sparks.map(s => (
                                <div 
                                    key={s.id}
                                    className="spark"
                                    style={{
                                        left: `${s.left}%`,
                                        width: `${s.size}px`,
                                        height: `${s.size}px`,
                                        animationDuration: `${s.duration}s`,
                                        animationDelay: `${s.delay}s`,
                                        '--drift': s.drift
                                    } as React.CSSProperties}
                                />
                            ))}
                        </div>

                        {/* HEADER (Top Left) */}
                        <div className="absolute top-12 left-12 animate-in slide-in-from-top duration-1000 delay-500">
                            <div className="flex items-center gap-3 opacity-90">
                                <div className="w-2 h-16 bg-lime-500"></div>
                                <div className="flex flex-col justify-center">
                                    <h2 className="text-white text-xl tracking-[0.2em] uppercase font-bold italic transform -skew-x-12 leading-none mb-1">
                                        Call of Duty IA
                                    </h2>
                                    <h1 className="text-6xl font-black text-white italic tracking-tighter leading-none transform -skew-x-12">
                                        WAR<span className="text-lime-500">ZONE</span>
                                    </h1>
                                </div>
                            </div>
                        </div>

                        {/* MAIN MENU LIST (Bottom Left) */}
                        <div className="absolute bottom-[10%] left-[8%] flex flex-col items-start gap-5 pointer-events-auto">
                            
                            {/* DEPLOY BUTTON */}
                            <button 
                                onClick={handleStart}
                                className="group flex flex-col items-start text-left focus:outline-none transition-transform duration-200 hover:translate-x-6 animate-in slide-in-from-left duration-700 delay-700 fill-mode-backwards"
                            >
                                <span className="text-8xl font-black text-white uppercase tracking-tighter leading-none group-hover:text-lime-500 transition-colors drop-shadow-2xl">
                                    {settings.mode === 'EDITOR' ? 'CRIAR' : 'INICIAR'}
                                </span>
                                <div className="flex items-center gap-2 mt-[-5px] opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                     <div className="h-[2px] w-12 bg-lime-500"></div>
                                     <span className="text-sm text-white tracking-[0.3em] uppercase font-bold">Confirmar Operação</span>
                                </div>
                            </button>

                            {/* OPTIONS LIST */}
                            <ul className="flex flex-col gap-1 mt-4 animate-in slide-in-from-left duration-700 delay-1000 fill-mode-backwards">
                                
                                {/* MODE */}
                                <li>
                                    <button 
                                        onClick={toggleMode}
                                        className="group text-4xl font-bold text-white/70 uppercase tracking-tight hover:text-white transition-all hover:translate-x-4 flex items-center gap-3"
                                    >
                                        <span className="w-1 h-6 bg-transparent group-hover:bg-cyan-400 transition-colors"></span>
                                        OPERAÇÃO: <span className="text-orange-500 group-hover:text-orange-400">[{getModeName(settings.mode)}]</span>
                                    </button>
                                </li>

                                {/* DIFFICULTY */}
                                <li>
                                    <button 
                                        onClick={toggleDifficulty}
                                        className="group text-4xl font-bold text-white/70 uppercase tracking-tight hover:text-white transition-all hover:translate-x-4 flex items-center gap-3"
                                    >
                                        <span className="w-1 h-6 bg-transparent group-hover:bg-cyan-400 transition-colors"></span>
                                        AMEAÇA: <span className="text-cyan-500 group-hover:text-cyan-400">[{getDifficultyName(settings.difficulty)}]</span>
                                    </button>
                                </li>

                                {/* GRAPHICS */}
                                <li>
                                    <button 
                                        onClick={toggleGraphics}
                                        className="group text-4xl font-bold text-white/70 uppercase tracking-tight hover:text-white transition-all hover:translate-x-4 flex items-center gap-3"
                                    >
                                        <span className="w-1 h-6 bg-transparent group-hover:bg-cyan-400 transition-colors"></span>
                                        VISUAL: <span className="text-cyan-500 group-hover:text-cyan-400">[{getGraphicsName(settings.graphics)}]</span>
                                    </button>
                                </li>

                                {/* FSR */}
                                <li>
                                    <button 
                                        onClick={toggleFSR}
                                        className="group text-4xl font-bold text-white/70 uppercase tracking-tight hover:text-white transition-all hover:translate-x-4 flex items-center gap-3"
                                    >
                                        <span className="w-1 h-6 bg-transparent group-hover:bg-cyan-400 transition-colors"></span>
                                        AMD FSR 1.0: <span className={settings.fsrMode === 'OFF' ? "text-white/50" : "text-green-400"}>
                                            [{getFSRName(settings.fsrMode)}]
                                        </span>
                                    </button>
                                </li>

                                {/* RAY TRACING */}
                                <li>
                                    <button 
                                        onClick={() => { setSettings(prev => ({...prev, rayTracing: !prev.rayTracing})); }}
                                        className="group text-4xl font-bold text-white/70 uppercase tracking-tight hover:text-white transition-all hover:translate-x-4 flex items-center gap-3"
                                    >
                                        <span className="w-1 h-6 bg-transparent group-hover:bg-purple-500 transition-colors"></span>
                                        RAY TRACING: <span className={settings.rayTracing ? "text-green-400" : "text-red-500"}>
                                            [{settings.rayTracing ? 'ATIVADO' : 'DESATIVADO'}]
                                        </span>
                                    </button>
                                </li>
                                
                                {/* SOUND */}
                                 <li>
                                    <button 
                                        onClick={() => { setSettings(prev => ({...prev, sound: !prev.sound})); }}
                                        className="group text-4xl font-bold text-white/70 uppercase tracking-tight hover:text-white transition-all hover:translate-x-4 flex items-center gap-3"
                                    >
                                        <span className="w-1 h-6 bg-transparent group-hover:bg-cyan-400 transition-colors"></span>
                                        ÁUDIO: <span className={settings.sound ? "text-green-500" : "text-red-500"}>
                                            [{settings.sound ? 'LIGADO' : 'DESLIGADO'}]
                                        </span>
                                    </button>
                                </li>

                                {/* EXIT */}
                                <li className="mt-6">
                                    <button 
                                        className="text-2xl font-bold text-white/40 uppercase tracking-widest hover:text-red-600 hover:translate-x-2 transition-all"
                                    >
                                        SAIR DO JOGO
                                    </button>
                                </li>
                            </ul>

                        </div>

                        {/* RIGHT SIDE DECORATION */}
                        <div className="absolute bottom-[15%] right-[5%] text-right pointer-events-none opacity-60 animate-in slide-in-from-right duration-1000 delay-500">
                            <div className="flex flex-col items-end gap-1">
                                <h3 className="text-lime-500 text-xs font-bold tracking-[0.2em] uppercase">Status</h3>
                                <p className="text-4xl font-bold text-white uppercase">Pronto</p>
                                <div className="w-32 h-1 bg-white/20 my-2"></div>
                                <p className="text-white/50 text-sm font-mono tracking-widest">
                                    SERVIDOR: LOCALHOST<br/>
                                    PING: 1ms<br/>
                                    DADOS: CRIPTOGRAFADOS
                                </p>
                            </div>
                        </div>

                    </div>
                </>
            )}
        </>
    );
};
