
import React, { useState, useEffect } from 'react';
import { PlayerStats, RadarBlip, GameMode, KillFeedEntry } from '../types';

interface HUDProps {
  stats: PlayerStats;
  isLocked: boolean;
}

const WeaponIcons: Record<string, React.ReactNode> = {
    'RIFLE': (
        <svg viewBox="0 0 100 40" className="w-8 h-4 fill-white" preserveAspectRatio="xMidYMid meet">
            <path d="M5,25 L15,25 L15,15 L80,15 L95,20 L95,22 L80,22 L80,30 L70,30 L60,22 L25,22 L20,35 L5,35 Z" />
        </svg>
    ),
    'PISTOL': (
        <svg viewBox="0 0 100 40" className="w-6 h-3 fill-white" preserveAspectRatio="xMidYMid meet">
            <path d="M20,25 L30,25 L30,15 L80,15 L80,25 L70,25 L65,35 L40,35 L45,25 Z" />
        </svg>
    ),
    'SHOTGUN': (
        <svg viewBox="0 0 100 40" className="w-8 h-4 fill-white" preserveAspectRatio="xMidYMid meet">
            <path d="M5,25 L15,25 L15,18 L90,18 L90,24 L25,24 L20,35 L5,35 Z" />
        </svg>
    ),
    'SNIPER': (
        <svg viewBox="0 0 100 40" className="w-10 h-4 fill-white" preserveAspectRatio="xMidYMid meet">
            <path d="M0,25 L10,25 L10,18 L30,18 L30,12 L60,12 L60,18 L95,18 L95,20 L60,20 L50,28 L20,28 L15,35 L0,35 Z" />
        </svg>
    ),
    'GRENADE': (
        <svg viewBox="0 0 40 40" className="w-4 h-4 fill-white" preserveAspectRatio="xMidYMid meet">
            <circle cx="20" cy="20" r="12" />
            <rect x="16" y="2" width="8" height="6" />
        </svg>
    )
};

const FallbackIcon = (
    <svg viewBox="0 0 40 40" className="w-4 h-4 fill-white">
        <path d="M5,5 L35,35 M5,35 L35,5" stroke="white" strokeWidth="5" />
    </svg>
);

const KillFeedItem: React.FC<{ entry: KillFeedEntry }> = ({ entry }) => {
    const isYouKiller = entry.killer === 'Maurii IA';
    const isYouVictim = entry.victim === 'Maurii IA';

    return (
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1 rounded mb-1 animate-in slide-in-from-left duration-300">
            <span className={`font-bold text-sm tracking-wide ${isYouKiller ? 'text-green-400' : 'text-green-600'}`}>
                {entry.killer}
            </span>
            
            <div className="opacity-80">
                {WeaponIcons[entry.weapon] || FallbackIcon}
            </div>
            
            {entry.isHeadshot && (
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-red-500">
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="4" fill="white"/>
                </svg>
            )}

            <span className={`font-bold text-sm tracking-wide ${isYouVictim ? 'text-yellow-400' : 'text-red-500'}`}>
                {entry.victim}
            </span>
        </div>
    );
};

export const HUD: React.FC<HUDProps> = ({ stats, isLocked }) => {
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [showRegion, setShowRegion] = useState(false);
  
  // Victory Animation State Machine
  // 0: None, 1: Warzone Intro, 2: Flash/Transition, 3: Victory Slam, 4: Champion Subtext
  const [victoryStep, setVictoryStep] = useState(0);

  useEffect(() => {
     if (stats.currentRegion && stats.currentRegion !== activeRegion) {
         setActiveRegion(stats.currentRegion);
         setShowRegion(true);
         const timer = setTimeout(() => { setShowRegion(false); }, 4000);
         return () => clearTimeout(timer);
     }
  }, [stats.currentRegion, activeRegion]);

  // WARZONE VICTORY SEQUENCE
  useEffect(() => {
      if (stats.isVictory) {
          // Timeline
          setVictoryStep(1); // "WARZONE" appears immediately
          
          setTimeout(() => setVictoryStep(2), 2000); // 2s: Flash + Blue Tint
          setTimeout(() => setVictoryStep(3), 2200); // 2.2s: VICTORY Text Slam
          setTimeout(() => setVictoryStep(4), 2800); // 2.8s: CHAMPION Subtext
      } else {
          setVictoryStep(0);
      }
  }, [stats.isVictory]);

  const isSniper = ['SNIPER', 'AWM', 'Kar98k'].includes(stats.weaponName);
  const isRifle = ['RIFLE', 'AK-27', 'M16', 'M15'].includes(stats.weaponName);

  if (stats.isDead) {
      return (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 font-tactical select-none">
              <div className="absolute inset-0 bg-red-900/30 mix-blend-overlay"></div>
              <div className="z-10 flex flex-col items-center animate-in zoom-in duration-500">
                  <h1 className="text-8xl font-black text-red-600 tracking-tighter drop-shadow-[0_0_20px_rgba(220,20,20,0.8)] border-t-8 border-b-8 border-red-600 py-4 mb-4">
                      M.O.R.T.O.
                  </h1>
                  <span className="text-2xl font-bold text-white/50 tracking-[0.5em] uppercase">Missão Falhou</span>
                  <div className="mt-12 flex flex-col gap-2 items-center text-white/80">
                      <p>Abates: {stats.score / 100}</p>
                      <p>Ranking: #{stats.enemiesRemaining + 1}</p>
                  </div>
                  <div className="mt-12 animate-pulse">
                      <span className="bg-white/10 px-4 py-2 rounded text-white text-sm font-bold tracking-widest">PRESSIONE [ESC] PARA SAIR</span>
                  </div>
              </div>
          </div>
      );
  }

  // --- WARZONE STYLE VICTORY SCREEN ---
  if (victoryStep > 0) {
      return (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center font-tactical select-none overflow-hidden">
              
              {/* STEP 2: BLUE TINT OVERLAY */}
              <div className={`absolute inset-0 bg-blue-900/60 mix-blend-multiply transition-opacity duration-500 ${victoryStep >= 2 ? 'opacity-100' : 'opacity-0'}`}></div>
              <div className={`absolute inset-0 bg-gradient-to-t from-blue-900/90 via-transparent to-blue-900/50 transition-opacity duration-1000 ${victoryStep >= 2 ? 'opacity-100' : 'opacity-0'}`}></div>

              {/* STEP 2: WHITE FLASH (Quick) */}
              <div className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-[50ms] ${victoryStep === 2 ? 'opacity-40' : 'opacity-0'}`}></div>

              <div className="z-10 flex flex-col items-center relative w-full">
                  
                  {/* STEP 1: WARZONE TEXT (Moves up at Step 3) */}
                  <div className={`transition-all duration-700 ease-out flex flex-col items-center ${victoryStep >= 3 ? '-translate-y-24 scale-75 opacity-80' : 'translate-y-0 scale-100'}`}>
                      <h2 className="text-2xl font-bold text-white tracking-[0.5em] uppercase drop-shadow-md animate-in slide-in-from-bottom duration-1000">
                          CALL OF DUTY IA
                      </h2>
                      <h1 className="text-8xl font-black italic tracking-tighter text-white drop-shadow-2xl transform -skew-x-12 animate-in zoom-in duration-500">
                          WAR<span className="text-blue-400">ZONE</span>
                      </h1>
                  </div>

                  {/* STEP 3: VICTORY SLAM */}
                  {victoryStep >= 3 && (
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center w-full">
                          {/* Main Text */}
                          <h1 className="text-[10rem] leading-none font-black italic tracking-tighter text-cyan-400 drop-shadow-[0_10px_20px_rgba(0,0,0,0.8)] transform -skew-x-12 animate-in zoom-in-50 duration-200">
                              VITÓRIA
                          </h1>
                          
                          {/* Animated Underline */}
                          <div className="w-[60%] h-2 bg-gradient-to-r from-transparent via-cyan-400 to-transparent mt-4 animate-in expand-width duration-500"></div>
                          
                          {/* STEP 4: CHAMPION SUBTEXT */}
                          <div className={`mt-6 overflow-hidden transition-all duration-500 ${victoryStep >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
                              <span className="text-4xl font-bold text-white tracking-[0.8em] uppercase bg-black/40 px-12 py-2 transform -skew-x-12 border-l-4 border-r-4 border-cyan-400">
                                  CAMPEÃO
                              </span>
                          </div>
                      </div>
                  )}

                  {/* EXIT HINT */}
                  {victoryStep >= 4 && (
                      <div className="absolute bottom-[-40vh] animate-bounce text-white/60 text-sm tracking-widest font-mono">
                          PRESSIONE [ESC] PARA SAIR
                      </div>
                  )}
              </div>
          </div>
      );
  }

  const getWeaponColor = () => {
      if (!stats.weaponTierColor) return 'white';
      return stats.weaponTierColor; 
  };

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden font-tactical text-white">
      
      {/* KILL FEED AREA */}
      <div className="absolute top-1/2 -translate-y-1/2 left-4 flex flex-col-reverse items-start max-w-md pointer-events-none opacity-90">
          {stats.killFeed && stats.killFeed.map(entry => (
              <KillFeedItem key={entry.id} entry={entry} />
          ))}
      </div>

      {stats.showDropPrompt && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center animate-pulse z-50">
              <span className="text-4xl font-black text-yellow-400 tracking-widest drop-shadow-[0_0_15px_rgba(255,200,0,0.8)] border-b-4 border-yellow-400 pb-2">PRESSIONE 'F' PARA PULAR</span>
              <span className="text-sm font-bold text-white/80 mt-2 tracking-[0.5em] bg-black/50 px-4">ZONA DE LANÇAMENTO ATIVA</span>
          </div>
      )}

      {!stats.showDropPrompt && (stats.isParachuting || stats.isFalling) && (
          <div className="absolute bottom-32 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
              {stats.isParachuting ? (
                  <div className="flex flex-col items-center animate-pulse">
                      <span className="text-xl font-bold text-red-500 uppercase tracking-widest bg-black/60 px-4 py-1 rounded">PRESSIONE 'C' PARA CORTAR LINHAS</span>
                      <span className="text-xs text-white/70">MODO MERGULHO</span>
                  </div>
              ) : (
                  <div className="flex flex-col items-center animate-bounce">
                      <span className="text-xl font-bold text-cyan-400 uppercase tracking-widest bg-black/60 px-4 py-1 rounded border border-cyan-500/50">PRESSIONE 'ESPAÇO' PARA ABRIR</span>
                  </div>
              )}
          </div>
      )}

      {stats.gameMode !== 'TRAINING' && showRegion && activeRegion && !stats.showDropPrompt && (
          <div className="absolute top-16 left-0 w-full flex flex-col items-center justify-center animate-in slide-in-from-top-4 fade-in duration-700">
               <div className="flex flex-col items-center bg-black/40 backdrop-blur-sm px-12 py-2 border-t-2 border-b-2 border-yellow-500/50">
                   <span className="text-yellow-500/80 text-[10px] tracking-[0.4em] uppercase mb-1">ENTRANDO NA ZONA</span>
                   <h1 className="text-4xl font-black text-white tracking-widest uppercase drop-shadow-xl">{activeRegion}</h1>
               </div>
          </div>
      )}

      {stats.gameMode === 'BATTLE_ROYALE' && (
        <>
            <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center">
                <div className="text-yellow-500 font-black text-4xl drop-shadow-[0_0_10px_rgba(220,200,20,0.8)]">VIVOS: {stats.enemiesRemaining + 1}</div>
            </div>
            {stats.isOutsideZone && (
                 <div className="absolute top-1/4 left-0 w-full text-center animate-pulse">
                     <h1 className="text-6xl font-black text-red-600 tracking-tighter bg-black/50 py-2">RETORNE À ÁREA DE COMBATE</h1>
                 </div>
            )}
        </>
      )}

      {!stats.showDropPrompt && (
        <>
            <div className="absolute top-8 left-8 opacity-90">
                <div className="w-48 h-48 bg-gray-900/90 border-2 border-white/20 rounded-full relative overflow-hidden shadow-2xl backdrop-blur-md">
                <div className="absolute inset-0 border border-white/10 rounded-full scale-50"></div>
                <div className="absolute inset-0 border border-white/10 rounded-full scale-75"></div>
                <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-white/10"></div>
                <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/10"></div>
                <div className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-green-500/10 to-transparent animate-spin-slow opacity-30" style={{animationDuration: '4s'}}></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[10px] border-b-yellow-400 drop-shadow-[0_0_4px_rgba(255,255,0,0.8)]"></div>
                </div>
                {stats.radarBlips && stats.radarBlips.map(blip => {
                    const scale = 2.4; 
                    const dist = Math.sqrt(blip.x * blip.x + blip.y * blip.y);
                    if (dist > 40) return null;
                    return (
                        <div key={blip.id} className={`absolute w-2 h-2 ${blip.team === 'BLUE' ? 'bg-cyan-400' : 'bg-red-500'} rounded-full shadow-sm border border-black/50`}
                            style={{ top: `calc(50% + ${blip.y * scale}px)`, left: `calc(50% + ${blip.x * scale}px)`, transform: 'translate(-50%, -50%)' }} />
                    );
                })}
                </div>
            </div>

            <div className="absolute bottom-8 left-8 transform -skew-x-12 origin-bottom-left">
                <div className="flex flex-col items-start">
                <div className="bg-black/80 px-4 py-1 mb-[2px] border-l-4 border-yellow-500">
                    <span className="text-yellow-500 font-bold text-sm tracking-[0.2em] transform skew-x-12 inline-block">OPERADOR</span>
                </div>
                <div className="w-72 bg-gradient-to-r from-black/90 to-transparent p-2 pt-1">
                    <div className="flex flex-col gap-1 w-full">
                        <div className="h-3 w-full bg-gray-700/50">
                            <div className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)] transition-all duration-100 ease-out" style={{width: `${stats.health}%`}} />
                        </div>
                    </div>
                </div>
                </div>
            </div>

            <div className="absolute bottom-8 right-8 transform -skew-x-12 origin-bottom-right">
                <div className="bg-gradient-to-l from-black/90 to-transparent p-6 pr-0 min-w-[320px] flex flex-col items-end border-r-4" style={{ borderColor: getWeaponColor() }}>
                <div className="flex items-center gap-2 mb-0 transform skew-x-12 mr-2">
                    <span className="text-yellow-500/80 font-black text-xs tracking-widest bg-yellow-500/10 px-2 py-[2px] border border-yellow-500/20">
                        [{stats.fireMode}]
                    </span>
                    <span className="font-bold text-sm tracking-widest uppercase" style={{ color: getWeaponColor(), textShadow: `0 0 10px ${getWeaponColor()}` }}>
                        {stats.weaponName}
                    </span>
                </div>
                <div className="flex items-baseline gap-3 transform skew-x-12 mr-2">
                    <span className={`text-7xl font-black tracking-tighter drop-shadow-lg ${stats.ammo < 10 ? 'text-red-500' : 'text-white'}`}>
                    {stats.ammo}
                    </span>
                    <div className="flex flex-col items-start -mb-1">
                    <span className="text-xl font-bold text-gray-400">/ {stats.maxAmmo * 4}</span>
                    </div>
                </div>
                </div>
            </div>
      </>
      )}
      
      {!stats.showDropPrompt && (
          <>
            {/* SNIPER SCOPE (8x) */}
            {stats.isAiming && isSniper && (
                <div className="absolute inset-0 flex items-center justify-center z-50">
                    
                    {/* BLURRED VIGNETTE LAYER */}
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-[6px]" 
                         style={{ 
                             maskImage: 'radial-gradient(circle, transparent 28%, black 35%)',
                             WebkitMaskImage: 'radial-gradient(circle, transparent 28%, black 35%)'
                         }}>
                    </div>

                    <svg className="w-full h-full absolute top-0 left-0" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
                        {/* Scope Rim (Thick to hide blur edge) */}
                        <circle cx="500" cy="500" r="325" stroke="#111" strokeWidth="25" fill="none" />
                        
                        <g stroke="black" strokeLinecap="square">
                            <line x1="180" y1="500" x2="380" y2="500" strokeWidth="6" />
                            <line x1="820" y1="500" x2="620" y2="500" strokeWidth="6" />
                            <line x1="500" y1="820" x2="500" y2="620" strokeWidth="6" />
                            <line x1="500" y1="180" x2="500" y2="380" strokeWidth="6" />
                            <line x1="380" y1="500" x2="620" y2="500" strokeWidth="1.5" />
                            <line x1="500" y1="380" x2="500" y2="620" strokeWidth="1.5" />
                            <line x1="420" y1="492" x2="420" y2="508" strokeWidth="1.5" />
                            <line x1="460" y1="495" x2="460" y2="505" strokeWidth="1.5" />
                            <line x1="540" y1="495" x2="540" y2="505" strokeWidth="1.5" />
                            <line x1="580" y1="492" x2="580" y2="508" strokeWidth="1.5" />
                            <line x1="492" y1="540" x2="508" y2="540" strokeWidth="1.5" />
                            <line x1="495" y1="580" x2="505" y2="580" strokeWidth="1.5" />
                        </g>

                        <text x="500" y="650" textAnchor="middle" fill="white" fontSize="14" fontFamily="monospace" opacity="0.9" letterSpacing="0.1em" style={{ textShadow: '0 1px 4px rgba(0,0,0,1)' }}>
                            SEGURE <tspan fontWeight="bold" fill="#fbbf24">SHIFT</tspan> PARA FOCAR
                        </text>
                        
                        <path d="M490 250 L500 260 L510 250" stroke="white" strokeWidth="2" fill="none" opacity="0.8" />
                        <text x="500" y="240" textAnchor="middle" fill="white" fontSize="12" fontFamily="monospace" opacity="0.8">173</text>
                    </svg>
                    <div className="absolute inset-0 pointer-events-none" 
                        style={{ 
                            background: 'radial-gradient(circle, transparent 30%, rgba(0,0,0,0.2) 70%)',
                        }}>
                    </div>
                </div>
            )}

            {/* RIFLE 4x SCOPE (Tactical) */}
            {stats.isAiming && isRifle && (
                <div className="absolute inset-0 flex items-center justify-center z-50">
                    
                    {/* BLURRED VIGNETTE LAYER (Wider for 4x) */}
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-[6px]" 
                         style={{ 
                             maskImage: 'radial-gradient(circle, transparent 32%, black 40%)',
                             WebkitMaskImage: 'radial-gradient(circle, transparent 32%, black 40%)'
                         }}>
                    </div>

                    <svg className="w-full h-full absolute top-0 left-0" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
                        {/* Housing Rim - Darker/Thicker for tactical look */}
                        <circle cx="500" cy="500" r="360" stroke="#151515" strokeWidth="30" fill="none" />
                        <circle cx="500" cy="500" r="350" stroke="#000" strokeWidth="4" fill="none" />
                        
                        {/* Knobs */}
                        <rect x="460" y="110" width="80" height="40" fill="#111" rx="4" /> 
                        <rect x="850" y="460" width="40" height="80" fill="#111" rx="4" />

                        <g stroke="black" strokeWidth="3" strokeLinecap="square">
                            <line x1="200" y1="500" x2="800" y2="500" />
                            <line x1="500" y1="200" x2="500" y2="800" />
                            
                            <line x1="480" y1="550" x2="520" y2="550" strokeWidth="2" />
                            <line x1="485" y1="600" x2="515" y2="600" strokeWidth="2" />
                            <line x1="490" y1="650" x2="510" y2="650" strokeWidth="2" />
                        </g>

                        {/* Green Center Dot */}
                        <circle cx="500" cy="500" r="3" fill="#00ff00" />
                        <path d="M500 480 L500 520 M480 500 L520 500" stroke="#00ff00" strokeWidth="2" opacity="0.6" />
                        
                        <text x="500" y="720" textAnchor="middle" fill="white" fontSize="12" fontFamily="monospace" opacity="0.5">ZOOM 4x</text>
                    </svg>
                    <div className="absolute inset-0 pointer-events-none" 
                        style={{ 
                            background: 'radial-gradient(circle, transparent 40%, rgba(0,0,0,0.1) 70%)',
                        }}>
                    </div>
                </div>
            )}

            {!stats.isAiming && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center opacity-90 transition-opacity duration-200">
                    <div className="w-1 h-1 bg-yellow-400/80 rounded-full shadow-[0_0_4px_#fbbf24]"></div>
                    <div className="absolute -left-6 top-[50%] -translate-y-[50%] w-4 h-[2px] bg-white/60 shadow-sm"></div>
                    <div className="absolute -right-6 top-[50%] -translate-y-[50%] w-4 h-[2px] bg-white/60 shadow-sm"></div>
                    <div className="absolute -top-6 left-[50%] -translate-x-[50%] h-4 w-[2px] bg-white/60 shadow-sm"></div>
                    <div className="absolute -bottom-6 left-[50%] -translate-x-[50%] h-4 w-[2px] bg-white/60 shadow-sm"></div>
                </div>
            )}
          </>
      )}
    </div>
  );
};
