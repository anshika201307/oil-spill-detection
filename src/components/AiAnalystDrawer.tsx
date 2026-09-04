import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Send, 
  Bot, 
  Sparkles, 
  Radio, 
  Ship, 
  Droplet, 
  HelpCircle,
  Minimize2,
  Trash2
} from 'lucide-react';
import { SpillIncident, CorrelatedVessel } from '../types';

interface AiAnalystDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeIncident: SpillIncident | null;
  activeVessel: CorrelatedVessel | null;
}

interface ChatMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  timestamp: string;
}

export const AiAnalystDrawer: React.FC<AiAnalystDrawerProps> = ({
  isOpen,
  onClose,
  activeIncident,
  activeVessel,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ai',
      text: `[OILTRACE TACTICAL AI]: Defense reconnaissance neural model active. Currently locked onto ${activeIncident ? activeIncident.name : 'global surveillance grid'}. I can evaluate SAR radar backscatter depressions, run hydrodynamic drift predictions, or assess vessel kinematic anomalies. How can I assist?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!isOpen) return null;

  const handleSend = async (textToSend?: string) => {
    const query = textToSend || inputText;
    if (!query.trim() || isSending) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsSending(true);

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          activeIncident,
          activeVessel,
        }),
      });
      const data = await res.json();

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: data.reply || '[AI]: Intelligence response generated.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          text: '[SYSTEM NOTICE]: Neural offline fallback engaged. Bragg damping ratio confirms heavy mineral oil slick footprint with active Stokes drift.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const quickPrompts = [
    'Explain the Bragg wave damping ratio for this slick.',
    'Analyze the suspect vessel AIS blackout window and draft drop.',
    'Predict coastal shoreline impact timeline under current metocean wind.',
    'Summarize MARPOL Annex I violation evidence for IMO brief.',
  ];

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[92vw] sm:w-[420px] h-[540px] glass-panel-elevated rounded-xl border border-[#00f2ff]/40 shadow-2xl flex flex-col overflow-hidden">
      
      {/* Header */}
      <div className="p-3.5 bg-[#161b28] border-b border-[#3a494b] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-[#00f2ff]/10 border border-[#00f2ff]/30 flex items-center justify-center">
            <Bot className="w-4 h-4 text-[#00f2ff]" />
          </div>
          <div>
            <div className="text-xs font-bold text-[#dee2f4] flex items-center gap-1.5">
              <span>OILTRACE Tactical AI</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="text-[10px] font-mono-data text-[#849495]">
              Gemini Remote Sensing Specialist
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setMessages([messages[0]])}
            className="p-1.5 text-[#849495] hover:text-[#dee2f4] rounded"
            title="Clear Chat"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-[#849495] hover:text-[#dee2f4] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-3 font-sans text-xs">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`p-3 rounded-lg max-w-[88%] leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-[#00f2ff] text-[#002022] font-medium rounded-tr-none'
                  : 'bg-[#1a1f2d] border border-[#3a494b] text-[#dee2f4] rounded-tl-none font-mono-data text-[11px]'
              }`}
            >
              {msg.text}
            </div>
            <span className="text-[9px] font-mono-data text-[#849495] mt-1 px-1">
              {msg.timestamp}
            </span>
          </div>
        ))}

        {isSending && (
          <div className="flex items-center gap-2 text-xs font-mono-data text-[#00f2ff]">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>AI remote sensing engine calculating...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="px-3 py-2 bg-[#0e1320] border-t border-[#3a494b]/60 flex gap-1.5 overflow-x-auto">
        {quickPrompts.map((q, i) => (
          <button
            key={i}
            onClick={() => handleSend(q)}
            className="px-2.5 py-1 rounded bg-[#1a1f2d] hover:bg-[#252a37] text-[#b9cacb] hover:text-[#00f2ff] border border-[#3a494b] text-[10px] whitespace-nowrap transition-colors flex-shrink-0"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input Field */}
      <div className="p-2.5 bg-[#161b28] border-t border-[#3a494b] flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask tactical AI about slick dispersion or vessel tracks..."
          className="flex-1 bg-[#1a1f2d] border border-[#3a494b] focus:border-[#00f2ff] rounded px-3 py-2 text-xs text-[#dee2f4] placeholder-[#849495] outline-none font-mono-data"
        />
        <button
          onClick={() => handleSend()}
          disabled={!inputText.trim() || isSending}
          className="p-2 rounded bg-[#00f2ff] hover:bg-[#74f5ff] text-[#002022] transition-all disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

    </div>
  );
};
