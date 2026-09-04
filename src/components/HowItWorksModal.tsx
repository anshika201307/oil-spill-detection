import React from 'react';
import { 
  X, 
  Satellite, 
  RotateCcw, 
  Ship, 
  Scale, 
  ArrowRight, 
  CheckCircle2, 
  HelpCircle, 
  Eye, 
  Wind, 
  Waves, 
  ShieldAlert,
  Sparkles,
  Compass
} from 'lucide-react';

interface HowItWorksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartInvestigation: () => void;
}

export const HowItWorksModal: React.FC<HowItWorksModalProps> = ({
  isOpen,
  onClose,
  onStartInvestigation,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="bg-[#121a2a] border border-[#2a3b50] rounded-2xl max-w-4xl w-full p-6 sm:p-8 space-y-6 shadow-2xl relative my-auto max-h-[92vh] overflow-y-auto text-[#dee2f4]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a3b50] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#00f2ff]/10 border border-[#00f2ff]/40 flex items-center justify-center">
              <Compass className="w-5 h-5 text-[#00f2ff]" />
            </div>
            <div>
              <span className="text-xs font-mono-data text-[#00f2ff] uppercase tracking-wider font-bold">
                Beginner-Friendly Guide
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-[#dee2f4]">
                How OilTrace AI Works in 4 Simple Steps
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-[#94a3b8] hover:text-[#dee2f4] hover:bg-[#1a263c] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Introduction */}
        <div className="p-4 rounded-xl bg-[#0b1220] border border-[#2a3b50] text-sm text-[#cbd5e1] leading-relaxed">
          <strong className="text-[#00f2ff]">OilTrace AI</strong> is an autonomous satellite intelligence system that catches illegal marine oil dumpers. When cargo tankers secretly wash their fuel tanks or dump sludge at sea, OilTrace spots the slick from orbit, reverses the ocean drift like a time machine, and mathematically identifies the guilty vessel for court prosecution.
        </div>

        {/* 4 Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Step 1 */}
          <div className="p-5 rounded-xl bg-[#162236] border border-[#2a3b50] hover:border-[#00f2ff]/50 transition-all space-y-3">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-[#00f2ff]/20 text-[#00f2ff] font-mono-data font-bold flex items-center justify-center text-sm border border-[#00f2ff]/40">
                01
              </span>
              <Satellite className="w-5 h-5 text-[#00f2ff]" />
            </div>
            <h3 className="text-base font-bold text-[#dee2f4]">
              1. Satellite Spots Oil from Space
            </h3>
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              Radar satellites (SAR) send microwave beams to the ocean surface. Oil flattens ocean ripples (Bragg waves), making oil slicks look like crisp <strong className="text-[#dee2f4]">dark patches</strong> even through thick clouds and complete darkness.
            </p>
            <div className="text-[11px] font-mono-data text-[#00f2ff] bg-[#0b1220] p-2 rounded border border-[#2a3b50]">
              💡 99.4% AI Accuracy · Distinguishes true oil from harmless seaweed/algae.
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-5 rounded-xl bg-[#162236] border border-[#2a3b50] hover:border-[#00f2ff]/50 transition-all space-y-3">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-300 font-mono-data font-bold flex items-center justify-center text-sm border border-amber-500/40">
                02
              </span>
              <RotateCcw className="w-5 h-5 text-amber-300" />
            </div>
            <h3 className="text-base font-bold text-[#dee2f4]">
              2. Rewind Ocean Drift (Hindcast)
            </h3>
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              Oil drifts with ocean currents and wind. Our hydrodynamic physics engine simulates the water backwards in time to pinpoint the <strong className="text-[#dee2f4]">exact GPS coordinates and timestamp</strong> where the oil was originally dumped into the sea.
            </p>
            <div className="text-[11px] font-mono-data text-amber-300 bg-[#0b1220] p-2 rounded border border-[#2a3b50]">
              ⏱️ Time-Machine Replay · Pinpoints discharge time down to ±5 minutes.
            </div>
          </div>

          {/* Step 3 */}
          <div className="p-5 rounded-xl bg-[#162236] border border-[#2a3b50] hover:border-[#00f2ff]/50 transition-all space-y-3">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-red-500/20 text-red-300 font-mono-data font-bold flex items-center justify-center text-sm border border-red-500/40">
                03
              </span>
              <Ship className="w-5 h-5 text-red-400" />
            </div>
            <h3 className="text-base font-bold text-[#dee2f4]">
              3. Identify the Guilty Ship (AIS Match)
            </h3>
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              We query global ship transponders (AIS) at that precise release location and time. We detect guilty behavior like <strong className="text-[#dee2f4]">turning off transponders (blackouts)</strong>, sudden ship draft drops (emptying tanks), and abnormal slowdowns.
            </p>
            <div className="text-[11px] font-mono-data text-red-300 bg-[#0b1220] p-2 rounded border border-[#2a3b50]">
              🎯 98.4% Attribution Score · Correlates ship name, IMO, and owner company.
            </div>
          </div>

          {/* Step 4 */}
          <div className="p-5 rounded-xl bg-[#162236] border border-[#2a3b50] hover:border-[#00f2ff]/50 transition-all space-y-3">
            <div className="flex items-center justify-between">
              <span className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-300 font-mono-data font-bold flex items-center justify-center text-sm border border-emerald-500/40">
                04
              </span>
              <Scale className="w-5 h-5 text-emerald-400" />
            </div>
            <h3 className="text-base font-bold text-[#dee2f4]">
              4. Generate Court-Ready Legal Dossier
            </h3>
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              The platform generates a certified legal evidence brief compliant with <strong className="text-[#dee2f4]">UNCLOS & MARPOL Annex I</strong> treaties, protected by a tamper-proof cryptographic SHA-256 hash for immediate Coast Guard interception.
            </p>
            <div className="text-[11px] font-mono-data text-emerald-300 bg-[#0b1220] p-2 rounded border border-[#2a3b50]">
              ⚖️ Port State Control Ready · 1-click printable PDF admiralty evidence.
            </div>
          </div>

        </div>

        {/* Map Legend & Visual Symbols */}
        <div className="p-4 rounded-xl bg-[#0b1220] border border-[#2a3b50] space-y-3">
          <h4 className="text-xs font-mono-data text-[#00f2ff] uppercase tracking-wider font-bold">
            Interactive Map Legend & Symbols:
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 ring-2 ring-red-400/50" />
              <span><strong className="text-red-300">Red Beacon:</strong> Spill Origin Point</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#00f2ff] ring-2 ring-[#00f2ff]/50" />
              <span><strong className="text-[#00f2ff]">Cyan Slick:</strong> Current Oil Footprint</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-1 bg-amber-400" />
              <span><strong className="text-amber-300">Yellow Line:</strong> Suspect Vessel Route</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-1 bg-[#38bdf8] border-b border-dashed border-[#38bdf8]" />
              <span><strong className="text-[#38bdf8]">Blue Dashed:</strong> Wind & Current Drift</span>
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-[#2a3b50]">
          <div className="text-xs text-[#94a3b8] flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#00f2ff]" />
            <span>Ready to explore active incidents or simulate your own custom spill?</span>
          </div>

          <button
            onClick={() => {
              onClose();
              onStartInvestigation();
            }}
            className="btn-primary w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg"
          >
            <span>Launch Live Investigation</span>
            <ArrowRight className="w-4 h-4 text-[#002022]" />
          </button>
        </div>

      </div>
    </div>
  );
};
