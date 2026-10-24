import React from 'react';
import { Role } from '../types';

interface HeaderProps {
  currentRole: Role;
  onSelectRole: (role: Role) => void;
  airportClock: string;
  speed: number;
  feedStatus: 'live' | 'mock';
}

export const Header: React.FC<HeaderProps> = ({
  currentRole,
  onSelectRole,
  airportClock,
  speed,
  feedStatus,
}) => {
  const roles: { id: Role; label: string; icon: string; theme: 'dark' | 'light' }[] = [
    { id: 'admin', label: 'Platform Admin', icon: '⚡', theme: 'dark' },
    { id: 'retailer', label: 'Retailer', icon: '🛍️', theme: 'light' },
    { id: 'media_manager', label: 'Media Manager', icon: '📊', theme: 'light' },
    { id: 'airline', label: 'Airline Rep', icon: '✈️', theme: 'light' },
    { id: 'passenger_screen', label: 'Screen Simulator', icon: '📺', theme: 'dark' },
    { id: 'split_screen', label: 'Split-Screen Demo', icon: '🪟', theme: 'dark' },
  ];

  return (
    <header style={{
      background: currentRole === 'admin' || currentRole === 'passenger_screen' || currentRole === 'split_screen'
        ? 'rgba(10, 13, 20, 0.95)'
        : 'rgba(255, 255, 255, 0.95)',
      borderBottom: `1px solid ${
        currentRole === 'admin' || currentRole === 'passenger_screen' || currentRole === 'split_screen'
          ? '#1e293b'
          : '#e2e8f0'
      }`,
      padding: '12px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backdropFilter: 'blur(10px)',
    }}>
      {/* Brand & Live Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            fontWeight: 800,
            color: '#fff',
            boxShadow: '0 0 15px rgba(59, 130, 246, 0.4)',
          }}>
            A
          </div>
          <div>
            <div style={{
              fontSize: '15px',
              fontWeight: 800,
              letterSpacing: '-0.3px',
              color: currentRole === 'admin' || currentRole === 'passenger_screen' || currentRole === 'split_screen' ? '#f8fafc' : '#0f172a',
            }}>
              AeroMedia Platform
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Nova International Airport (NVA)
            </div>
          </div>
        </div>

        {/* Live Spine Status Badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: feedStatus === 'live' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
          padding: '4px 10px',
          borderRadius: '9999px',
          border: `1px solid ${feedStatus === 'live' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
          fontSize: '11px',
          fontWeight: 600,
          color: feedStatus === 'live' ? '#34d399' : '#60a5fa',
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: feedStatus === 'live' ? '#10b981' : '#3b82f6',
            boxShadow: `0 0 6px ${feedStatus === 'live' ? '#10b981' : '#3b82f6'}`,
          }} />
          {feedStatus === 'live' ? 'AODB / AIDX / ACRIS LIVE' : 'SIMULATED DATA FEED'}
        </div>
      </div>

      {/* Role Switcher Pill Navigation */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        background: currentRole === 'admin' || currentRole === 'passenger_screen' || currentRole === 'split_screen' ? '#121722' : '#f1f5f9',
        padding: '4px',
        borderRadius: '12px',
        border: `1px solid ${currentRole === 'admin' || currentRole === 'passenger_screen' || currentRole === 'split_screen' ? '#1e293b' : '#cbd5e1'}`,
      }}>
        {roles.map((r) => {
          const isSelected = currentRole === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onSelectRole(r.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: isSelected ? 600 : 500,
                color: isSelected
                  ? '#ffffff'
                  : currentRole === 'admin' || currentRole === 'passenger_screen' || currentRole === 'split_screen' ? '#94a3b8' : '#64748b',
                background: isSelected ? '#3b82f6' : 'transparent',
                boxShadow: isSelected ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none',
              }}
            >
              <span>{r.icon}</span>
              <span>{r.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Airport Simulation Clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          fontFamily: 'var(--font-mono)',
        }}>
          <div style={{
            fontSize: '13px',
            fontWeight: 700,
            color: currentRole === 'admin' || currentRole === 'passenger_screen' || currentRole === 'split_screen' ? '#38bdf8' : '#0284c7',
          }}>
            {airportClock} UTC
          </div>
          <div style={{ fontSize: '10px', color: '#64748b' }}>
            SIM SPEED: {speed}x
          </div>
        </div>
      </div>
    </header>
  );
};
