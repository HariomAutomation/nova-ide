import React, { useState } from 'react';
import { CampaignUI, ZoneUI, FlightUI } from '../types';

interface RetailerViewProps {
  campaigns: CampaignUI[];
  zones: ZoneUI[];
  flights: FlightUI[];
}

export const RetailerView: React.FC<RetailerViewProps> = ({ campaigns, zones, flights }) => {
  const [targetDestination, setTargetDestination] = useState('DXB');
  const [minDwell, setMinDwell] = useState(15);
  const [selectedZone, setSelectedZone] = useState('T1-Z2');

  // Estimate audience match preview in real-time
  const zone = zones.find(z => z.id === selectedZone) || zones[0];
  const estAudienceMatch = Math.min(100, Math.round(
    ((zone.internationalShare * 0.4) + (Math.min(zone.dwellMinutes, 60) / 60 * 0.4) + 0.2) * 100
  ));

  return (
    <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto', color: '#0f172a' }}>
      {/* Top Shop KPI Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
        marginBottom: '24px',
      }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Store Redemptions Today
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#0f172a', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            312 <span style={{ fontSize: '14px', color: '#10b981', fontWeight: 600 }}>+18%</span>
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
            Top: AURA-DXB-20 (Gate 42 Duty Free)
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Attributed Media Revenue
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#0f172a', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            $18,450.00
          </div>
          <div style={{ fontSize: '12px', color: '#10b981', marginTop: '2px' }}>
            ROAS: 3.69x on media spend
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Upcoming 2h Passenger Flow
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#3b82f6', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            1,240 <span style={{ fontSize: '14px', fontWeight: 500 }}>pax</span>
          </div>
          <div style={{ fontSize: '12px', color: '#3b82f6', marginTop: '2px' }}>
            Top: 490 Gulf-bound international
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Avg Dwell at Shop Gates
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#f59e0b', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            52 <span style={{ fontSize: '14px', fontWeight: 500 }}>min</span>
          </div>
          <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '2px' }}>
            Flight delay bonus dwell active
          </div>
        </div>
      </div>

      {/* Main Retailer Workflow: 2-Hour Passenger Flow Forecast + Campaign Builder */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '24px' }}>
        {/* Campaign Builder with Live Audience Match Estimator */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '6px' }}>
            Launch Dynamic Flight-Triggered Campaign
          </h2>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>
            Define audience rules and flight delay triggers with live match preview
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                Campaign Title & Offer
              </label>
              <input
                type="text"
                defaultValue="Aura Élixir Oud Royale 20% Off"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                Target Concourse Zone
              </label>
              <select
                value={selectedZone}
                onChange={(e) => setSelectedZone(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                }}
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.passengerCount} pax • {Math.round(z.internationalShare * 100)}% Int'l)
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                  Target Destination
                </label>
                <select
                  value={targetDestination}
                  onChange={(e) => setTargetDestination(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                  }}
                >
                  <option value="DXB">DXB (Dubai / Gulf)</option>
                  <option value="LHR">LHR (London Heathrow)</option>
                  <option value="FRA">FRA (Frankfurt)</option>
                  <option value="ALL">Any Long-Haul International</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                  Minimum Dwell Threshold
                </label>
                <select
                  value={minDwell}
                  onChange={(e) => setMinDwell(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                  }}
                >
                  <option value={15}>&ge; 15 Minutes</option>
                  <option value={30}>&ge; 30 Minutes</option>
                  <option value={45}>&ge; 45 Minutes (High Intent)</option>
                </select>
              </div>
            </div>

            {/* Delay Rule Trigger Toggle */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>AIDX Delay Trigger Boost (+1.5x)</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    Auto-boost bidding rank if target flight is delayed &gt; 30 min
                  </div>
                </div>
                <input type="checkbox" defaultChecked style={{ width: '18px', height: '18px' }} />
              </div>
            </div>

            {/* Real-time Audience Match Preview */}
            <div style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '10px',
              padding: '16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase' }}>
                    Audience Match Preview
                  </div>
                  <div style={{ fontSize: '13px', color: '#1e40af', marginTop: '2px' }}>
                    Based on live {zone.name} telemetry
                  </div>
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#2563eb', fontFamily: 'var(--font-mono)' }}>
                  {estAudienceMatch}%
                </div>
              </div>
              <div style={{ fontSize: '11px', color: '#60a5fa', marginTop: '6px' }}>
                High affinity: 280 pax at Gate 42 matches Gulf destination target.
              </div>
            </div>

            <button
              style={{
                background: '#2563eb',
                color: '#ffffff',
                padding: '12px',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '14px',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
              }}
            >
              Deploy Campaign to Media Network
            </button>
          </div>
        </div>

        {/* 2-Hour Passenger Flow Forecast & Active Campaigns Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Upcoming Flight Gate Pipeline */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 800, marginBottom: '12px' }}>
              Upcoming Departure Flights near Gate 40-48
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '8px' }}>Flight</th>
                  <th style={{ padding: '8px' }}>Dest</th>
                  <th style={{ padding: '8px' }}>Gate</th>
                  <th style={{ padding: '8px' }}>Status</th>
                  <th style={{ padding: '8px' }}>Pax</th>
                  <th style={{ padding: '8px' }}>Delay</th>
                </tr>
              </thead>
              <tbody>
                {flights.map((f) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 8px', fontWeight: 700 }}>{f.flightNumber}</td>
                    <td style={{ padding: '10px 8px', fontWeight: 600, color: '#0f172a' }}>
                      {f.destination} ({f.destinationCity})
                    </td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{f.gate}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span className={`badge ${f.status === 'delayed' ? 'badge-warning' : 'badge-success'}`}>
                        {f.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono)' }}>{f.passengerCount}</td>
                    <td style={{ padding: '10px 8px', color: f.delayMinutes > 0 ? '#ef4444' : '#64748b', fontWeight: 600 }}>
                      {f.delayMinutes > 0 ? `+${f.delayMinutes}m` : 'On Time'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Active Promo Codes & Redemption Performance */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 800, marginBottom: '12px' }}>
              Live Store Promo Codes & Redemptions
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {campaigns.map((c) => (
                <div key={c.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px' }}>{c.title}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                      Code: <code style={{ fontWeight: 700, color: '#2563eb' }}>{c.promoCode}</code> • Discount: {c.discount}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                      {c.redemptionsCount} claims
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      {(c.redemptionsCount / (c.scansCount || 1) * 100).toFixed(1)}% conversion
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
