import React, { useState } from 'react';
import { ScreenUI, FlightUI } from '../types';

interface PassengerScreenViewProps {
  screens: ScreenUI[];
  selectedScreenId: string | null;
  onSelectScreen: (screenId: string) => void;
  onOpenWhyThisAd: (screen: ScreenUI) => void;
  flights: FlightUI[];
}

export const PassengerScreenView: React.FC<PassengerScreenViewProps> = ({
  screens,
  selectedScreenId,
  onSelectScreen,
  onOpenWhyThisAd,
  flights,
}) => {
  const [orientationOverride, setOrientationOverride] = useState<'portrait' | 'landscape'>('portrait');
  const screen = screens.find((s) => s.id === selectedScreenId) || screens[0];
  const ad = screen.currentAd;

  // Real SVG QR Code generator representation
  const qrUrl = `/claim/${ad?.promoCode || 'AURA-DXB-20'}`;

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', color: '#f8fafc' }}>
      {/* Simulator Control Strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px',
        background: '#121722',
        padding: '12px 20px',
        borderRadius: '12px',
        border: '1px solid #1e293b',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8' }}>
            Select Screen Hardware:
          </label>
          <select
            value={screen.id}
            onChange={(e) => onSelectScreen(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              background: '#0a0d14',
              color: '#f8fafc',
              border: '1px solid #334155',
              fontSize: '13px',
            }}
          >
            {screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.zoneName})
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '4px', background: '#0a0d14', padding: '4px', borderRadius: '6px', border: '1px solid #1e293b' }}>
            <button
              onClick={() => setOrientationOverride('portrait')}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 600,
                color: orientationOverride === 'portrait' ? '#fff' : '#64748b',
                background: orientationOverride === 'portrait' ? '#3b82f6' : 'transparent',
              }}
            >
              📱 9:16 Portrait (Totem)
            </button>
            <button
              onClick={() => setOrientationOverride('landscape')}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 600,
                color: orientationOverride === 'landscape' ? '#fff' : '#64748b',
                background: orientationOverride === 'landscape' ? '#3b82f6' : 'transparent',
              }}
            >
              🖥️ 16:9 Landscape (Gate Display)
            </button>
          </div>

          <button
            onClick={() => onOpenWhyThisAd(screen)}
            style={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
              color: '#fff',
              padding: '8px 16px',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '13px',
              boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
            }}
          >
            🔍 Why This Ad? (Audit Breakdown)
          </button>
        </div>
      </div>

      {/* Screen Physical Frame Container */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{
          width: orientationOverride === 'portrait' ? '460px' : '960px',
          height: orientationOverride === 'portrait' ? '820px' : '540px',
          background: '#020617',
          borderRadius: '24px',
          border: '12px solid #1e293b',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 30px rgba(59, 130, 246, 0.2)',
          display: 'flex',
          flexDirection: orientationOverride === 'portrait' ? 'column' : 'row',
          overflow: 'hidden',
          position: 'relative',
          transition: 'all 0.4s ease',
        }}>
          {/* FIDS Flight Ticker Side / Top Bar */}
          <div style={{
            width: orientationOverride === 'portrait' ? '100%' : '320px',
            height: orientationOverride === 'portrait' ? '180px' : '100%',
            background: '#090d16',
            borderRight: orientationOverride === 'landscape' ? '2px solid #1e293b' : 'none',
            borderBottom: orientationOverride === 'portrait' ? '2px solid #1e293b' : 'none',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '1px', color: '#f59e0b' }}>
                FLIGHT DEPARTURES
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                {screen.gate || 'TERMINAL 1'}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'hidden' }}>
              {flights.slice(0, 3).map((f) => (
                <div key={f.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: f.status === 'delayed' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${f.status === 'delayed' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.05)'}`,
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}>
                  <div>
                    <span style={{ fontWeight: 800, color: '#f8fafc' }}>{f.flightNumber}</span>
                    <span style={{ color: '#94a3b8', marginLeft: '6px' }}>{f.destination}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: f.status === 'delayed' ? '#f87171' : '#34d399', fontFamily: 'var(--font-mono)' }}>
                      {f.status === 'delayed' ? `DELAY ${f.estimatedDeparture}` : f.scheduledDeparture}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Dynamic Retail Media Advertisement Area */}
          <div style={{
            flex: 1,
            position: 'relative',
            background: 'linear-gradient(180deg, rgba(15,23,42,0.9) 0%, rgba(2,6,23,0.95) 100%)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '24px',
          }}>
            {/* Top Brand Banner */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="badge badge-success">{ad?.discount || '20% OFF'}</span>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  {ad?.advertiser || 'Duty Free Luxury'}
                </span>
              </div>

              <h1 style={{
                fontSize: orientationOverride === 'portrait' ? '28px' : '32px',
                fontWeight: 900,
                marginTop: '12px',
                lineHeight: 1.2,
                color: '#ffffff',
                textShadow: '0 2px 10px rgba(0,0,0,0.5)',
              }}>
                {ad?.headline || 'Aura Élixir Oud Royale'}
              </h1>

              <p style={{
                fontSize: '14px',
                color: '#cbd5e1',
                marginTop: '8px',
                lineHeight: 1.4,
              }}>
                {ad?.bodyText || 'Exclusive fragrance promotion for Gulf travelers.'}
              </p>
            </div>

            {/* Middle Campaign Visual */}
            <div style={{
              flex: 1,
              maxHeight: orientationOverride === 'portrait' ? '280px' : '220px',
              borderRadius: '16px',
              overflow: 'hidden',
              margin: '16px 0',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            }}>
              <img
                src={ad?.imageUrl || 'https://images.unsplash.com/photo-1547887537-6158d64c35b3?w=800&q=80'}
                alt="Ad Creative"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>

            {/* Bottom Claim Action with Live Mobile QR Code */}
            <div style={{
              background: '#090d16',
              border: '1px solid #1e293b',
              borderRadius: '14px',
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>
                  Scan With Phone Camera To Claim
                </div>
                <div style={{ fontSize: '18px', fontWeight: 900, color: '#f8fafc', fontFamily: 'var(--font-mono)' }}>
                  {ad?.promoCode || 'AURA-DXB-20'}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Valid at Gate 42 Boutique • Tap QR to test
                </div>
              </div>

              {/* Interactive QR Code Simulator Link */}
              <a
                href={qrUrl}
                target="_blank"
                rel="noreferrer"
                title="Scan or Click to open mobile claim page on your device"
                style={{
                  background: '#ffffff',
                  padding: '8px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 15px rgba(255, 255, 255, 0.2)',
                  textDecoration: 'none',
                }}
              >
                {/* SVG QR Code Pattern */}
                <svg width="64" height="64" viewBox="0 0 24 24" fill="#000000">
                  <path d="M2 2h8v8H2V2zm2 2v4h4V4H4zm10-2h8v8h-8V2zm2 2v4h4V4h-4zM2 14h8v8H2v-8zm2 2v4h4v-4H4zm8-2h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2zm-2-2h2v2h-2v-2zm4 4h2v2h-2v-2zm-8 2h2v2h-2v-2zm4 0h4v2h-4v-2z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
