import React from 'react';
import { ZoneUI, ScreenUI } from '../types';

interface TerminalFloorPlanProps {
  zones: ZoneUI[];
  screens: ScreenUI[];
  selectedScreenId: string | null;
  onSelectScreen: (screenId: string) => void;
  onSelectZone: (zoneId: string) => void;
}

export const TerminalFloorPlan: React.FC<TerminalFloorPlanProps> = ({
  zones,
  screens,
  selectedScreenId,
  onSelectScreen,
  onSelectZone,
}) => {
  const getZoneDensityColor = (zoneId: string) => {
    const z = zones.find((item) => item.id === zoneId);
    if (!z || z.passengerCount === 0) return 'rgba(30, 41, 59, 0.4)';
    const count = z.passengerCount;
    if (count > 250) return 'rgba(239, 68, 68, 0.45)'; // High density red/orange
    if (count > 150) return 'rgba(245, 158, 11, 0.4)'; // Medium density yellow
    return 'rgba(59, 130, 246, 0.35)'; // Normal density blue
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '380px' }}>
      <svg
        viewBox="0 0 900 480"
        style={{
          width: '100%',
          height: '100%',
          background: '#0d111a',
          borderRadius: '12px',
          border: '1px solid #1e293b',
        }}
      >
        <defs>
          <radialGradient id="heatGlowRed" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="heatGlowBlue" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </radialGradient>
          <pattern id="gridPattern" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Airport Grid Blueprint */}
        <rect width="900" height="480" fill="url(#gridPattern)" />

        {/* Terminal 1 Building Envelope */}
        <path
          d="M 60 40 L 520 40 L 520 200 L 440 200 L 440 440 L 60 440 Z"
          fill="#111625"
          stroke="#1e293b"
          strokeWidth="2"
        />
        <text x="80" y="70" fill="#64748b" fontSize="12" fontWeight="700" letterSpacing="1">
          TERMINAL 1 (INTERNATIONAL)
        </text>

        {/* Terminal 2 Building Envelope */}
        <path
          d="M 580 40 L 840 40 L 840 380 L 580 380 Z"
          fill="#111625"
          stroke="#1e293b"
          strokeWidth="2"
        />
        <text x="600" y="70" fill="#64748b" fontSize="12" fontWeight="700" letterSpacing="1">
          TERMINAL 2 (DOMESTIC)
        </text>

        {/* Zone T1-Z3: Security North & Checkpoints */}
        <g onClick={() => onSelectZone('T1-Z3')} style={{ cursor: 'pointer' }}>
          <rect
            x="80"
            y="90"
            width="380"
            height="70"
            rx="8"
            fill={getZoneDensityColor('T1-Z3')}
            stroke="#334155"
            strokeDasharray="4 2"
          />
          <text x="100" y="125" fill="#f8fafc" fontSize="12" fontWeight="600">
            Zone T1-Z3: Security North & Screening Checkpoints
          </text>
          <text x="100" y="145" fill="#94a3b8" fontSize="10">
            ACRIS Queue Sensors • {zones.find(z => z.id === 'T1-Z3')?.passengerCount || 0} pax
          </text>
        </g>

        {/* Zone T1-Z1: Central Retail & Dining Plaza */}
        <g onClick={() => onSelectZone('T1-Z1')} style={{ cursor: 'pointer' }}>
          <rect
            x="80"
            y="180"
            width="340"
            height="110"
            rx="8"
            fill={getZoneDensityColor('T1-Z1')}
            stroke="#3b82f6"
            strokeWidth="1.5"
          />
          <text x="100" y="215" fill="#f8fafc" fontSize="13" fontWeight="700">
            Zone T1-Z1: Central Luxury Plaza & F&B
          </text>
          <text x="100" y="235" fill="#94a3b8" fontSize="11">
            Dwell: {zones.find(z => z.id === 'T1-Z1')?.dwellMinutes || 0} min • Int'l: {Math.round((zones.find(z => z.id === 'T1-Z1')?.internationalShare || 0) * 100)}%
          </text>
          <text x="100" y="255" fill="#38bdf8" fontSize="11" fontWeight="600">
            Current Presence: {zones.find(z => z.id === 'T1-Z1')?.passengerCount || 0} passengers
          </text>
        </g>

        {/* Zone T1-Z2: Gate 40-48 Concourse Pier */}
        <g onClick={() => onSelectZone('T1-Z2')} style={{ cursor: 'pointer' }}>
          <rect
            x="80"
            y="310"
            width="340"
            height="110"
            rx="8"
            fill={getZoneDensityColor('T1-Z2')}
            stroke="#ef4444"
            strokeWidth="1.5"
          />
          <text x="100" y="340" fill="#f8fafc" fontSize="13" fontWeight="700">
            Zone T1-Z2: Gate 40-48 Departure Concourse
          </text>
          <text x="100" y="360" fill="#fca5a5" fontSize="11" fontWeight="600">
            Gate 42 (DXB Flight Delayed +45m)
          </text>
          <text x="100" y="380" fill="#cbd5e1" fontSize="11">
            Presence: {zones.find(z => z.id === 'T1-Z2')?.passengerCount || 0} pax • Dwell: {zones.find(z => z.id === 'T1-Z2')?.dwellMinutes || 0}m
          </text>
        </g>

        {/* Zone T2-Z1: Domestic Concourse B */}
        <g onClick={() => onSelectZone('T2-Z1')} style={{ cursor: 'pointer' }}>
          <rect
            x="600"
            y="110"
            width="220"
            height="240"
            rx="8"
            fill={getZoneDensityColor('T2-Z1')}
            stroke="#334155"
          />
          <text x="620" y="140" fill="#f8fafc" fontSize="13" fontWeight="600">
            Zone T2-Z1: Domestic
          </text>
          <text x="620" y="165" fill="#94a3b8" fontSize="11">
            Gates 10-20
          </text>
          <text x="620" y="190" fill="#cbd5e1" fontSize="11">
            Presence: {zones.find(z => z.id === 'T2-Z1')?.passengerCount || 0} pax
          </text>
        </g>

        {/* Screen Dots & Pulsing Status */}
        {screens.map((screen) => {
          let cx = 200;
          let cy = 200;
          if (screen.id === 'SCR-T1-G42') { cx = 250; cy = 390; }
          if (screen.id === 'SCR-T1-PLAZA-01') { cx = 250; cy = 240; }
          if (screen.id === 'SCR-T1-SEC-03') { cx = 280; cy = 120; }
          if (screen.id === 'SCR-T2-G12') { cx = 710; cy = 230; }

          const isSelected = selectedScreenId === screen.id;
          const isWarning = screen.status === 'warning';
          const isOffline = screen.status === 'offline';
          const dotColor = isOffline ? '#ef4444' : isWarning ? '#f59e0b' : '#10b981';

          return (
            <g
              key={screen.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectScreen(screen.id);
              }}
              style={{ cursor: 'pointer' }}
            >
              {isSelected && (
                <circle cx={cx} cy={cy} r="18" fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="3 3">
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from={`0 ${cx} ${cy}`}
                    to={`360 ${cx} ${cy}`}
                    dur="6s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 10 : 8}
                fill={dotColor}
                stroke="#ffffff"
                strokeWidth="2"
              />
              <text
                x={cx + 14}
                y={cy + 4}
                fill={isSelected ? '#38bdf8' : '#e2e8f0'}
                fontSize="10"
                fontWeight="700"
              >
                {screen.name.split(' ')[0]} ({screen.orientation === 'portrait' ? '9:16' : '16:9'})
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
