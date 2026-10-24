import React from 'react';

interface SimulationBarProps {
  isPlaying: boolean;
  speed: 1 | 10 | 60;
  onTogglePlay: () => void;
  onSelectSpeed: (speed: 1 | 10 | 60) => void;
  onInjectEvent: (type: 'delay_dxb' | 'gate_change' | 'queue_surge' | 'screen_offline') => void;
  lastEventNotice: string | null;
}

export const SimulationBar: React.FC<SimulationBarProps> = ({
  isPlaying,
  speed,
  onTogglePlay,
  onSelectSpeed,
  onInjectEvent,
  lastEventNotice,
}) => {
  return (
    <div style={{
      background: 'rgba(18, 23, 34, 0.95)',
      borderBottom: '1px solid #1e293b',
      padding: '8px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      fontSize: '13px',
      color: '#cbd5e1',
    }}>
      {/* Simulation Controls: Play/Pause and Speed Multipliers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          onClick={onTogglePlay}
          style={{
            background: isPlaying ? '#ef4444' : '#10b981',
            color: '#fff',
            padding: '5px 12px',
            borderRadius: '6px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>{isPlaying ? '⏸ Pause' : '▶ Play'}</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#0a0d14', padding: '3px', borderRadius: '6px', border: '1px solid #1e293b' }}>
          {([1, 10, 60] as const).map((s) => (
            <button
              key={s}
              onClick={() => onSelectSpeed(s)}
              style={{
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                color: speed === s ? '#fff' : '#64748b',
                background: speed === s ? '#3b82f6' : 'transparent',
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Cause-and-Effect Live Injection Buttons (The Brief's Headline Demo) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
          Inject Telemetry:
        </span>

        <button
          onClick={() => onInjectEvent('delay_dxb')}
          style={{
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            color: '#fbbf24',
            padding: '5px 10px',
            borderRadius: '6px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          title="Trigger AIDX delay event for DXB Flight SL882: updates Airline view, raises zone dwell, and triggers Retailer +1.5x Perfume boost in <2s"
        >
          <span>⚡ Delay DXB +45m</span>
        </button>

        <button
          onClick={() => onInjectEvent('gate_change')}
          style={{
            background: 'rgba(59, 130, 246, 0.15)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            color: '#60a5fa',
            padding: '5px 10px',
            borderRadius: '6px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          title="Trigger AIDX gate change to Gate 44"
        >
          <span>🚪 Gate Move (42→44)</span>
        </button>

        <button
          onClick={() => onInjectEvent('queue_surge')}
          style={{
            background: 'rgba(139, 92, 246, 0.15)',
            border: '1px solid rgba(139, 92, 246, 0.35)',
            color: '#c084fc',
            padding: '5px 10px',
            borderRadius: '6px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          title="Trigger ACRIS queue surge at Security North: blends into ZonePresence"
        >
          <span>📈 ACRIS Queue Surge</span>
        </button>
      </div>

      {/* Real-Time Cause & Effect Status Ticker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {lastEventNotice && (
          <div style={{
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#34d399',
            padding: '3px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 500,
            fontFamily: 'var(--font-mono)',
            animation: 'fadeIn 0.3s ease-in',
          }}>
            ✓ {lastEventNotice}
          </div>
        )}
      </div>
    </div>
  );
};
