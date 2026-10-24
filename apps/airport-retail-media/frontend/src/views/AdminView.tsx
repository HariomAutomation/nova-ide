import React, { useState } from 'react';
import { ZoneUI, ScreenUI, FlightUI } from '../types';
import { TerminalFloorPlan } from '../components/TerminalFloorPlan';

interface AdminViewProps {
  zones: ZoneUI[];
  screens: ScreenUI[];
  flights: FlightUI[];
  selectedScreenId: string | null;
  onSelectScreen: (screenId: string) => void;
  onOpenWhyThisAd: (screen: ScreenUI) => void;
}

export const AdminView: React.FC<AdminViewProps> = ({
  zones,
  screens,
  flights,
  selectedScreenId,
  onSelectScreen,
  onOpenWhyThisAd,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'screens' | 'feeds' | 'incidents'>('overview');
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>('T1-Z2');

  const selectedScreen = screens.find((s) => s.id === selectedScreenId) || screens[0];
  const totalPaxInTerminal = zones.reduce((sum, z) => sum + z.passengerCount, 0);
  const activeScreensCount = screens.filter((s) => s.status === 'online').length;

  return (
    <div style={{ padding: '24px', maxWidth: '1800px', margin: '0 auto', color: '#f8fafc' }}>
      {/* Top Control Room KPI Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: '16px',
        marginBottom: '24px',
      }}>
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
            Passengers In Network
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#38bdf8', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            {totalPaxInTerminal.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#10b981', marginTop: '2px' }}>
            ↑ 14% vs normal baseline
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
            Live Media Screens
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#10b981', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            {activeScreensCount} / {screens.length}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            100% online availability
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
            Avg Audience Dwell
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#fbbf24', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            46.5 <span style={{ fontSize: '16px', fontWeight: 500 }}>min</span>
          </div>
          <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '2px' }}>
            Delayed flights extending dwell
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
            Impressions Today
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#c084fc', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            184,290
          </div>
          <div style={{ fontSize: '11px', color: '#10b981', marginTop: '2px' }}>
            ↑ 18.2 req/sec decision loop
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
            Estimated Ad Revenue
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#34d399', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            $4,515.10
          </div>
          <div style={{ fontSize: '11px', color: '#34d399', marginTop: '2px' }}>
            eCPM: $24.50 (Yield optimized)
          </div>
        </div>
      </div>

      {/* Main Grid: Floor Plan on Left (65%), Screen & Telemetry Inspector on Right (35%) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', gap: '24px' }}>
        {/* Left Column: Floor Plan & Zone Density */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Terminal Digital Twin & Crowd Density</h2>
              <p style={{ fontSize: '12px', color: '#94a3b8' }}>
                Real-time SVG blueprint mapped to AODB flight gates & ACRIS passenger sensors
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span className="badge badge-success">AODB FEED: 900 FLIGHTS</span>
              <span className="badge badge-info">ACRIS QUEUE: ONLINE</span>
            </div>
          </div>

          <TerminalFloorPlan
            zones={zones}
            screens={screens}
            selectedScreenId={selectedScreenId}
            onSelectScreen={onSelectScreen}
            onSelectZone={(zid) => setSelectedZoneId(zid)}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '14px', fontSize: '11px', color: '#94a3b8' }}>
            <div>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#3b82f6', borderRadius: '2px', marginRight: '5px' }}></span>
              Normal Presence (&lt;150 pax)
              <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#f59e0b', borderRadius: '2px', margin: '0 5px 0 15px' }}></span>
              Medium Surge (150-250 pax)
              <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#ef4444', borderRadius: '2px', margin: '0 5px 0 15px' }}></span>
              High Surge (&gt;250 pax)
            </div>
            <div>Click any screen dot or zone to inspect</div>
          </div>
        </div>

        {/* Right Column: Screen Inspector & Audit Trail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Active Screen Inspector */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <span className="badge badge-info" style={{ marginBottom: '4px' }}>
                  {selectedScreen.orientation.toUpperCase()} DISPLAY • {selectedScreen.resolution}
                </span>
                <h3 style={{ fontSize: '17px', fontWeight: 800 }}>{selectedScreen.name}</h3>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>Location: {selectedScreen.zoneName}</div>
              </div>
              <button
                onClick={() => onOpenWhyThisAd(selectedScreen)}
                style={{
                  background: 'rgba(59, 130, 246, 0.2)',
                  border: '1px solid #3b82f6',
                  color: '#60a5fa',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                🔍 Why This Ad?
              </button>
            </div>

            {selectedScreen.currentAd && (
              <div style={{
                background: '#0a0d14',
                border: '1px solid #1e293b',
                borderRadius: '10px',
                padding: '16px',
              }}>
                <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>
                  Current Active Campaign
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px', color: '#f8fafc' }}>
                  {selectedScreen.currentAd.headline}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 10px 0' }}>
                  {selectedScreen.currentAd.bodyText}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px', fontSize: '11px' }}>
                  <div style={{ background: '#121722', padding: '8px', borderRadius: '6px' }}>
                    <div style={{ color: '#64748b' }}>Promo Code</div>
                    <div style={{ fontWeight: 700, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                      {selectedScreen.currentAd.promoCode}
                    </div>
                  </div>
                  <div style={{ background: '#121722', padding: '8px', borderRadius: '6px' }}>
                    <div style={{ color: '#64748b' }}>Audience Match</div>
                    <div style={{ fontWeight: 700, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                      {(selectedScreen.currentAd.audienceMatchScore * 100).toFixed(0)}% Score
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Data Feed Telemetry Health */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '12px' }}>
              Data Feed Health (AODB / AIDX / ACRIS)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#0a0d14', borderRadius: '6px' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>AODB CSV Snapshot</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>One row per flight leg (33 columns mapped)</div>
                </div>
                <span className="badge badge-success">320 FLIGHTS LOADED</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#0a0d14', borderRadius: '6px' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>AIDX XML Message Stream</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>IATA_AIDX_FlightLegNotifRQ (Delays & Gates)</div>
                </div>
                <span className="badge badge-success">42 MSG/MIN</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#0a0d14', borderRadius: '6px' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>ACRIS NGSI-LD Queue Feed</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>FIWARE smart data models for passenger queues</div>
                </div>
                <span className="badge badge-success">18 SENSORS ONLINE</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
