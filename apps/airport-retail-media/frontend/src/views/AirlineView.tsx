import React, { useState } from 'react';
import { FlightUI } from '../types';

interface AirlineViewProps {
  flights: FlightUI[];
  onTriggerDelayVoucher: (flightId: string) => void;
}

export const AirlineView: React.FC<AirlineViewProps> = ({ flights, onTriggerDelayVoucher }) => {
  const [selectedAirline, setSelectedAirline] = useState('SL');
  const [voucherSent, setVoucherSent] = useState(false);

  const airlineFlights = flights.filter((f) => f.airline === selectedAirline);

  const handleSendVoucher = (flightId: string) => {
    setVoucherSent(true);
    onTriggerDelayVoucher(flightId);
    setTimeout(() => setVoucherSent(false), 4000);
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto', color: '#0f172a' }}>
      {/* Top Airline Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '24px',
      }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Airline Operations & Passenger Experience</h1>
          <p style={{ fontSize: '13px', color: '#64748b' }}>
            Flight turnaround timeline, gate media overrides, and automated delay goodwill care
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Carrier Account:</label>
          <select
            value={selectedAirline}
            onChange={(e) => setSelectedAirline(e.target.value)}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <option value="SL">SkyLink Global (SL)</option>
            <option value="HZ">Horizon Air (HZ)</option>
            <option value="NV">Nordica Express (NV)</option>
            <option value="MH">MetroHop Regional (MH)</option>
          </select>
        </div>
      </div>

      {/* Flight Timeline & Delay Goodwill Care */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '24px' }}>
        {/* Flights Departure Board */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '14px' }}>
            Active Departure Flights (A-CDM Milestones)
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {airlineFlights.map((f) => (
              <div key={f.id} style={{
                background: f.status === 'delayed' ? 'rgba(254, 242, 242, 0.8)' : '#f8fafc',
                border: `1px solid ${f.status === 'delayed' ? '#fecaca' : '#e2e8f0'}`,
                borderRadius: '12px',
                padding: '16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>{f.flightNumber}</span>
                    <span style={{ marginLeft: '10px', fontSize: '14px', fontWeight: 600, color: '#475569' }}>
                      To {f.destinationCity} ({f.destination})
                    </span>
                  </div>
                  <span className={`badge ${f.status === 'delayed' ? 'badge-warning' : 'badge-success'}`}>
                    {f.status.toUpperCase()}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginTop: '14px', fontSize: '12px' }}>
                  <div>
                    <div style={{ color: '#64748b' }}>Departure Gate</div>
                    <div style={{ fontWeight: 700, fontSize: '14px' }}>{f.gate}</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748b' }}>Scheduled / Est.</div>
                    <div style={{ fontWeight: 700, fontSize: '14px' }}>{f.scheduledDeparture} → {f.estimatedDeparture}</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748b' }}>Booked Pax</div>
                    <div style={{ fontWeight: 700, fontSize: '14px', fontFamily: 'var(--font-mono)' }}>{f.passengerCount} pax</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748b' }}>Delay Code</div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: f.delayMinutes > 0 ? '#dc2626' : '#16a34a' }}>
                      {f.delayMinutes > 0 ? `IATA 89 (+${f.delayMinutes}m)` : 'On Schedule'}
                    </div>
                  </div>
                </div>

                {f.status === 'delayed' && (
                  <div style={{
                    marginTop: '14px',
                    padding: '12px',
                    background: '#ffffff',
                    borderRadius: '8px',
                    border: '1px solid #fee2e2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#991b1b' }}>
                        Automated Delay Care Rule Triggered
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Delay exceeds 30m threshold. Offer co-funded $10 café voucher on Gate 42 screens.
                      </div>
                    </div>
                    <button
                      onClick={() => handleSendVoucher(f.id)}
                      style={{
                        background: '#dc2626',
                        color: '#ffffff',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        fontWeight: 700,
                        fontSize: '12px',
                      }}
                    >
                      {voucherSent ? '✓ Sent to Gate Screens' : 'Push Care Vouchers'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Gate Messaging Scheduler */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '14px' }}>
            Gate Media Takeover
          </h2>
          <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>
            Preempt commercial ad loop for critical passenger boarding broadcasts
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>
                Preset Announcement
              </label>
              <select style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                <option>Now Boarding Zone 1 & Business Class</option>
                <option>Final Boarding Call — All Passengers</option>
                <option>Gate Area Seating Maintenance Notice</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>
                Duration of Takeover
              </label>
              <select style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                <option>2 Minutes (1 Full Ad Slot Cycle)</option>
                <option>5 Minutes</option>
                <option>Until Boarding Complete</option>
              </select>
            </div>

            <button
              style={{
                background: '#0f172a',
                color: '#ffffff',
                padding: '12px',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '13px',
                marginTop: '10px',
              }}
            >
              Trigger Immediate Gate Screen Takeover
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
