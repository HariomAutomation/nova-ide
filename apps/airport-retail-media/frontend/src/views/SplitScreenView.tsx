import React from 'react';
import { AdminView } from './AdminView';
import { PassengerScreenView } from './PassengerScreenView';
import { ZoneUI, ScreenUI, FlightUI } from '../types';

interface SplitScreenViewProps {
  zones: ZoneUI[];
  screens: ScreenUI[];
  flights: FlightUI[];
  selectedScreenId: string | null;
  onSelectScreen: (screenId: string) => void;
  onOpenWhyThisAd: (screen: ScreenUI) => void;
}

export const SplitScreenView: React.FC<SplitScreenViewProps> = (props) => {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1.2fr 0.8fr',
      height: 'calc(100vh - 120px)',
      overflow: 'hidden',
    }}>
      {/* Left Pane: Operator Floor Plan & Control Room */}
      <div style={{
        overflowY: 'auto',
        borderRight: '2px solid #1e293b',
        padding: '12px',
        background: '#0a0d14',
      }}>
        <div style={{
          padding: '8px 16px',
          background: '#121722',
          borderRadius: '8px',
          marginBottom: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '12px', fontWeight: 800, color: '#38bdf8' }}>
            OPERATOR CONSOLE & TELEMETRY
          </span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            Click "⚡ Delay DXB +45m" above to trigger live update
          </span>
        </div>
        <AdminView {...props} />
      </div>

      {/* Right Pane: Live Passenger Screen Simulator */}
      <div style={{
        overflowY: 'auto',
        padding: '12px',
        background: '#020617',
      }}>
        <div style={{
          padding: '8px 16px',
          background: '#090d16',
          borderRadius: '8px',
          marginBottom: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '12px', fontWeight: 800, color: '#34d399' }}>
            PASSENGER SCREEN SIMULATOR (GATE 42 TOTEM)
          </span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            Updates in &lt; 2s upon event injection
          </span>
        </div>
        <PassengerScreenView {...props} />
      </div>
    </div>
  );
};
