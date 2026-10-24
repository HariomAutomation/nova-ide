import React, { useState } from 'react';
import { ScreenUI, CampaignUI } from '../types';

interface MediaManagerViewProps {
  screens: ScreenUI[];
  campaigns: CampaignUI[];
}

export const MediaManagerView: React.FC<MediaManagerViewProps> = ({ screens, campaigns }) => {
  const [selectedTerminal, setSelectedTerminal] = useState<'T1' | 'T2'>('T1');
  const hours = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];

  return (
    <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto', color: '#0f172a' }}>
      {/* Top Media Inventory KPIs */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
        marginBottom: '24px',
      }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Inventory Slot Occupancy
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#0f172a', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            88.4%
          </div>
          <div style={{ fontSize: '12px', color: '#10b981', marginTop: '2px' }}>
            +6.2% vs last week
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Average Network eCPM
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#2563eb', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            $26.80
          </div>
          <div style={{ fontSize: '12px', color: '#2563eb', marginTop: '2px' }}>
            Yield algorithm active
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Pending Creative Approvals
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#f59e0b', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            2 <span style={{ fontSize: '14px', fontWeight: 500 }}>creatives</span>
          </div>
          <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '2px' }}>
            Resolution & policy review
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Active Advertisers
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#10b981', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            14
          </div>
          <div style={{ fontSize: '12px', color: '#10b981', marginTop: '2px' }}>
            Retail, Lounges, Tech
          </div>
        </div>
      </div>

      {/* Screen x Hour Slot Inventory Calendar Matrix */}
      <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Screen × Hour Slot Occupancy & Yield Heatmap</h2>
            <p style={{ fontSize: '12px', color: '#64748b' }}>
              Real-time slot utilization by gate screen across departure peak hours
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setSelectedTerminal('T1')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                background: selectedTerminal === 'T1' ? '#2563eb' : '#f1f5f9',
                color: selectedTerminal === 'T1' ? '#fff' : '#64748b',
              }}
            >
              Terminal 1 (International)
            </button>
            <button
              onClick={() => setSelectedTerminal('T2')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                background: selectedTerminal === 'T2' ? '#2563eb' : '#f1f5f9',
                color: selectedTerminal === 'T2' ? '#fff' : '#64748b',
              }}
            >
              Terminal 2 (Domestic)
            </button>
          </div>
        </div>

        {/* Matrix Grid */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                <th style={{ padding: '10px 8px', color: '#475569', minWidth: '180px' }}>Screen Hardware</th>
                {hours.map((h) => (
                  <th key={h} style={{ padding: '10px 8px', color: '#475569', textAlign: 'center' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {screens.map((scr) => (
                <tr key={scr.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 8px', fontWeight: 700, color: '#0f172a' }}>
                    <div>{scr.name}</div>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 400 }}>{scr.zoneName}</div>
                  </td>
                  {hours.map((h, idx) => {
                    // Yield price calculation
                    const isPeak = idx >= 3 && idx <= 6;
                    const cpm = isPeak ? '$32/CPM' : '$18/CPM';
                    const fill = isPeak ? 'rgba(37, 99, 235, 0.15)' : 'rgba(16, 185, 129, 0.12)';
                    const textColor = isPeak ? '#1d4ed8' : '#047857';

                    return (
                      <td key={h} style={{ padding: '8px', textAlign: 'center' }}>
                        <div style={{
                          background: fill,
                          borderRadius: '6px',
                          padding: '6px 4px',
                          border: `1px solid ${isPeak ? '#bfdbfe' : '#a7f3d0'}`,
                        }}>
                          <div style={{ fontWeight: 700, color: textColor, fontSize: '11px' }}>
                            {cpm}
                          </div>
                          <div style={{ fontSize: '9px', color: '#64748b' }}>
                            {isPeak ? '98% Booked' : '75% Booked'}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Creative Approval Queue */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '14px' }}>
          Creative Approval Queue
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '8px', overflow: 'hidden' }}>
                <img
                  src="https://images.unsplash.com/photo-1547887537-6158d64c35b3?w=200&q=80"
                  alt="Thumb"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>Aura Luxury Perfume — Spring Oud Special</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  Advertiser: Aura Duty Free • Resolution: 1080x1920 (9:16 Portrait) • Target: Gate 40-48
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={{ background: '#10b981', color: '#fff', padding: '6px 14px', borderRadius: '6px', fontWeight: 600, fontSize: '12px' }}>
                ✓ Approve Creative
              </button>
              <button style={{ background: '#f1f5f9', color: '#64748b', padding: '6px 14px', borderRadius: '6px', fontWeight: 600, fontSize: '12px' }}>
                Reject
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
