
import React, { useState } from 'react';
import { WeaponType, WeaponTier } from '../game/WeaponSystem';
import { GameEngine } from '../game/Engine';

interface DebugMenuProps {
    onClose: () => void;
}

const WEAPONS = [
    { label: 'Rifle', value: WeaponType.RIFLE },
    { label: 'Pistola', value: WeaponType.PISTOL },
    { label: 'Shotgun', value: WeaponType.SHOTGUN },
    { label: 'Sniper', value: WeaponType.SNIPER },
];

const TIERS = [
    { label: 'Comum', value: WeaponTier.COMMON, color: 'text-gray-400', border: 'border-gray-400' },
    { label: 'Incomum', value: WeaponTier.UNCOMMON, color: 'text-green-400', border: 'border-green-400' },
    { label: 'Raro', value: WeaponTier.RARE, color: 'text-purple-400', border: 'border-purple-400' },
    { label: 'Lendário', value: WeaponTier.LEGENDARY, color: 'text-yellow-400', border: 'border-yellow-400' },
];

export const DebugMenu: React.FC<DebugMenuProps> = ({ onClose }) => {
    const [selectedWeapon, setSelectedWeapon] = useState<WeaponType>(WeaponType.RIFLE);
    const [selectedTier, setSelectedTier] = useState<WeaponTier>(WeaponTier.COMMON);

    const handleSpawn = () => {
        GameEngine.getInstance().spawnDebugLoot(selectedWeapon, selectedTier);
    };

    return (
        <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-auto bg-black/60 backdrop-blur-sm font-tactical">
            <div className="bg-gray-900 border-2 border-white/20 p-6 rounded-lg shadow-2xl w-96 animate-in zoom-in duration-200">
                
                {/* Header */}
                <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-2">
                    <h2 className="text-xl font-bold text-white uppercase tracking-widest">
                        Debug <span className="text-orange-500">Spawner</span>
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        ✕
                    </button>
                </div>

                {/* Weapon Selection */}
                <div className="mb-4">
                    <label className="block text-gray-500 text-xs uppercase font-bold mb-2">Tipo de Arma</label>
                    <div className="grid grid-cols-2 gap-2">
                        {WEAPONS.map((w) => (
                            <button
                                key={w.value}
                                onClick={() => setSelectedWeapon(w.value)}
                                className={`px-4 py-2 text-sm font-bold uppercase border rounded transition-all ${
                                    selectedWeapon === w.value 
                                    ? 'bg-blue-600 border-blue-400 text-white' 
                                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                                }`}
                            >
                                {w.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tier Selection */}
                <div className="mb-6">
                    <label className="block text-gray-500 text-xs uppercase font-bold mb-2">Raridade</label>
                    <div className="grid grid-cols-2 gap-2">
                        {TIERS.map((t) => (
                            <button
                                key={t.value}
                                onClick={() => setSelectedTier(t.value)}
                                className={`px-4 py-2 text-sm font-bold uppercase border rounded transition-all ${
                                    selectedTier === t.value 
                                    ? `bg-gray-800 ${t.border} ${t.color}`
                                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:bg-gray-700'
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                    <button 
                        onClick={handleSpawn}
                        className="flex-1 bg-green-600 hover:bg-green-500 text-white font-black uppercase py-3 rounded shadow-lg transition-transform active:scale-95"
                    >
                        SPAWN
                    </button>
                    <button 
                        onClick={onClose}
                        className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold uppercase py-3 rounded transition-colors"
                    >
                        Fechar
                    </button>
                </div>

            </div>
        </div>
    );
};
