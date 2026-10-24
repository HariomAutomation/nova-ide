import React from 'react';
import { ScreenUI } from '../types';

interface WhyThisAdModalProps {
  screen: ScreenUI | null;
  onClose: () => void;
}

export const WhyThisAdModal: React.FC<WhyThisAdModalProps> = ({ screen, onClose }) => {
  if (!screen || !screen.currentAd) return null;

  const ad = screen.currentAd;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px',
    }}>
      <div style={{
        background: '#121722',
        border: '1px solid #1e293b',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '680px',
        maxHeight: '90vh',
        overflowY: 'auto',
        padding: '24px',
        color: '#f8fafc',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
              Decision Engine Audit Trail • {screen.id}
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginTop: '2px' }}>
              Why This Ad Was Selected
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#1e293b',
              color: '#94a3b8',
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Selected Winner Banner */}
        <div style={{
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="badge badge-success" style={{ marginBottom: '6px' }}>WINNING CREATIVE (RANK 1)</span>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>{ad.campaignTitle}</div>
              <div style={{ fontSize: '13px', color: '#94a3b8' }}>Advertiser: {ad.advertiser}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                {(ad.audienceMatchScore * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Final Match Score</div>
            </div>
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#cbd5e1', background: '#0a0d14', padding: '8px 12px', borderRadius: '6px' }}>
            <strong>Reason:</strong> {ad.winningReason}
          </div>
        </div>

        {/* Audience Matching Logic Breakdown */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px', color: '#e2e8f0' }}>
            Audience Match Scoring Breakdown
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            <div style={{ background: '#0a0d14', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Flight Proximity Curve</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8' }}>1.0x (100%)</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>At Gate 42 (&lt;15m)</div>
            </div>
            <div style={{ background: '#0a0d14', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Flight Delay Boost</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#fbbf24' }}>+1.5x Boost</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>SL882 DXB Delayed +45m</div>
            </div>
            <div style={{ background: '#0a0d14', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Zone Dwell Quality</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399' }}>52 Minutes</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Passes &ge;15m threshold</div>
            </div>
          </div>
        </div>

        {/* Competitor Bids Table */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px', color: '#e2e8f0' }}>
            Decision Pipeline Candidate Rankings
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e293b', color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>Rank</th>
                <th style={{ padding: '8px' }}>Campaign</th>
                <th style={{ padding: '8px' }}>Target Segment</th>
                <th style={{ padding: '8px' }}>Base Match</th>
                <th style={{ padding: '8px' }}>Final Score</th>
                <th style={{ padding: '8px' }}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #1e293b', background: 'rgba(59, 130, 246, 0.05)' }}>
                <td style={{ padding: '10px 8px', fontWeight: 700, color: '#34d399' }}>#1</td>
                <td style={{ padding: '10px 8px', fontWeight: 600 }}>Aura Luxury Perfume</td>
                <td style={{ padding: '10px 8px', color: '#94a3b8' }}>Gulf Destinations</td>
                <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)' }}>0.565</td>
                <td style={{ padding: '10px 8px', fontWeight: 700, color: '#34d399', fontFamily: 'var(--font-mono)' }}>0.847</td>
                <td style={{ padding: '10px 8px' }}><span className="badge badge-success">Selected</span></td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '10px 8px', fontWeight: 700, color: '#94a3b8' }}>#2</td>
                <td style={{ padding: '10px 8px', fontWeight: 600 }}>Wonderland Travel Toys</td>
                <td style={{ padding: '10px 8px', color: '#94a3b8' }}>Family Travellers</td>
                <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)' }}>0.278</td>
                <td style={{ padding: '10px 8px', fontWeight: 700, color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>0.278</td>
                <td style={{ padding: '10px 8px' }}><span className="badge badge-warning">Outbid</span></td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e293b', opacity: 0.6 }}>
                <td style={{ padding: '10px 8px', color: '#ef4444' }}>—</td>
                <td style={{ padding: '10px 8px', textDecoration: 'line-through' }}>Caelum Priority Lounge</td>
                <td style={{ padding: '10px 8px', color: '#94a3b8' }}>Business Plaza Only</td>
                <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)' }}>—</td>
                <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)' }}>0.000</td>
                <td style={{ padding: '10px 8px' }}><span className="badge badge-danger">Hard Filter: Wrong Zone</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              background: '#3b82f6',
              color: '#fff',
              padding: '8px 18px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '13px',
            }}
          >
            Close Audit Trail
          </button>
        </div>
      </div>
    </div>
  );
};
