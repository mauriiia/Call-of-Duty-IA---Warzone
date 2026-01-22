
import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './game/Engine';
import { HUD } from './components/HUD';
import { MainMenu } from './components/MainMenu';
import { PauseMenu } from './components/PauseMenu';
import { EditorHUD } from './components/EditorHUD';
import { DebugMenu } from './components/DebugMenu';
import { PlayerStats, GameSettings } from './types';
import { SoundManager } from './game/SoundManager';

// --- CONFIGURAÇÃO DE ÁUDIO (TAURI) ---
// Para rodar no Tauri localmente:
// 1. Crie uma pasta 'public/sounds' no seu projeto.
// 2. Baixe os arquivos e salve como 'plane.mp3' e 'wind.mp3'.
// 3. Mude as URLs abaixo para: "/sounds/plane.mp3" e "/sounds/wind.mp3".

const PLANE_SOUND_URL = "https://www.dropbox.com/scl/fi/cwde6hxn4265e80j1b5qr/skydive-plane-pilatus-pc6-28690.mp3?rlkey=rtyxps6wpttu67vttarqbny75&st=z9l0pw7j&raw=1";
const WIND_SOUND_URL = "https://www.dropbox.com/scl/fi/8x21h492149h14/wind-loop.mp3?rlkey=placeholder&raw=1"; // Placeholder, o código trata falha de load gracefully.
// Fallback visual: Se o link acima quebrar, o SoundManager apenas não tocará, sem crashar.

const App: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Game State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLocked, setIsLocked] = useState(false); 
  const [activeTool, setActiveTool] = useState('ROAD');
  
  // Debug State
  const [showDebugMenu, setShowDebugMenu] = useState(false);

  const [stats, setStats] = useState<PlayerStats>({
    health: 100,
    ammo: 30,
    maxAmmo: 30,
    isReloading: false,
    isAiming: false,
    fireMode: 'AUTO',
    weaponName: 'RIFLE',
    score: 0,
    gameMode: 'BATTLE_ROYALE',
    wave: 1,
    enemiesRemaining: 0,
    radarBlips: [],
    killFeed: [],
    currentRegion: null
  });

  // INITIALIZATION EFFECT (RUNS ONCE)
  useEffect(() => {
    if (!containerRef.current) return;

    const game = GameEngine.getInstance();
    
    // Initialize Game Loop
    game.init(containerRef.current, (newStats) => {
      setStats(newStats);
    });

    // Handle Pointer Lock Changes (ESC key handling)
    const lockChangeAlert = () => {
        const locked = document.pointerLockElement === document.querySelector('canvas');
        setIsLocked(locked);
        
        // Use Engine state directly to avoid stale closures
        const mode = GameEngine.getInstance().currentMode;
        
        // Don't auto-pause if in EDITOR or if Debug Menu is open
        if (mode !== 'EDITOR' && !showDebugMenu) {
            game.setPaused(!locked);
        }
    };
    document.addEventListener('pointerlockchange', lockChangeAlert);

    // Setup Debug Toggle Listener
    game.input.onDebugToggle = () => {
        // Toggle UI State
        setShowDebugMenu(prev => {
            const newState = !prev;
            if (newState) {
                // Opening menu: Unlock pointer so user can click
                game.input.unlockPointer();
            } else {
                // Closing menu: Re-lock pointer
                game.input.lockPointer();
            }
            return newState;
        });
    };

    return () => {
      game.dispose();
      document.removeEventListener('pointerlockchange', lockChangeAlert);
    };
  }, []); 

  const handleStartGame = async (settings: GameSettings) => {
    // 1. Resume Audio Context
    await SoundManager.getInstance().resumeContext();
    
    // 2. Preload/Bless Sounds (CRITICAL FIX for Autoplay)
    if (settings.mode === 'BATTLE_ROYALE') {
        SoundManager.getInstance().preloadPlaneSound(PLANE_SOUND_URL);
        
        // Preload Wind sound too (even if URL fails, it attempts to register)
        // Usando um gerador de ruído interno se a URL falhar é melhor, 
        // mas aqui tentamos a tag de áudio primeiro para consistência com o Tauri.
        SoundManager.getInstance().preloadWindSound(WIND_SOUND_URL); 
    }

    GameEngine.getInstance().startMode(settings);
    setIsPlaying(true);
  };

  const handleResume = () => {
      GameEngine.getInstance().input.lockPointer();
  };

  const handleRestart = () => {
      GameEngine.getInstance().restartMatch();
      GameEngine.getInstance().input.lockPointer();
  };

  const handleFOVChange = (fov: number) => {
      GameEngine.getInstance().updateFOV(fov);
  };

  const handleQuit = () => {
      // 1. Tell engine to stop processing game loop and input
      GameEngine.getInstance().exitGame();
      
      // 2. Update UI state to show Main Menu
      setIsPlaying(false);
      setIsLocked(false);
  };

  const closeDebugMenu = () => {
      setShowDebugMenu(false);
      GameEngine.getInstance().input.lockPointer();
  };

  const isEditor = stats.gameMode === 'EDITOR';

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
      
      {/* --- PERSISTENT AUDIO ELEMENTS FOR TAURI/WEB --- */}
      <audio id="plane-audio" loop preload="auto" crossOrigin="anonymous" />
      <audio id="wind-audio" loop preload="auto" crossOrigin="anonymous" />

      {!isPlaying && (
        <MainMenu onStartGame={handleStartGame} />
      )}

      {isPlaying && !isEditor && isLocked && !showDebugMenu && (
        <HUD stats={stats} isLocked={isLocked} />
      )}

      {isPlaying && isEditor && (
          <EditorHUD 
            activeTool={activeTool} 
            onExit={handleQuit} 
          />
      )}

      {/* Debug Menu Overlay */}
      {showDebugMenu && isPlaying && (
          <DebugMenu onClose={closeDebugMenu} />
      )}

      {/* Logic to show Pause Menu: Playing, Not Locked, Not Editor, Not Debug */}
      {isPlaying && !isEditor && !isLocked && !showDebugMenu && (
          <PauseMenu 
            onResume={handleResume}
            onRestart={handleRestart}
            onQuit={handleQuit}
            onChangeFOV={handleFOVChange}
          />
      )}
    </div>
  );
};

export default App;
