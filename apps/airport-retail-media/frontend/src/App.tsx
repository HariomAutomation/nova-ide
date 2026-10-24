import React, { useState, useEffect } from 'react';
import { Role, ZoneUI, ScreenUI, FlightUI, CampaignUI } from './types';
import { INITIAL_ZONES, INITIAL_SCREENS, INITIAL_FLIGHTS, INITIAL_CAMPAIGNS } from './services/mockData';
import { Header } from './components/Header';
import { SimulationBar } from './components/SimulationBar';
import { WhyThisAdModal } from './components/WhyThisAdModal';
import { AdminView } from './views/AdminView';
import { RetailerView } from './views/RetailerView';
import { MediaManagerView } from './views/MediaManagerView';
import { AirlineView } from './views/AirlineView';
import { PassengerScreenView } from './views/PassengerScreenView';
import { MobileClaimView } from './views/MobileClaimView';
import { SplitScreenView } from './views/SplitScreenView';

export const App: React.FC = () => {
  // Mobile Claim route detection
  const isClaimRoute = window.location.pathname.startsWith('/claim');
  const claimCode = isClaimRoute ? window.location.pathname.split('/claim/')[1] || 'AURA-DXB-20' : '';

  const [currentRole, setCurrentRole] = useState<Role>('admin');
  const [zones, setZones] = useState<ZoneUI[]>(INITIAL_ZONES);
  const [screens, setScreens] = useState<ScreenUI[]>(INITIAL_SCREENS);
  const [flights, setFlights] = useState<FlightUI[]>(INITIAL_FLIGHTS);
  const [campaigns, setCampaigns] = useState<CampaignUI[]>(INITIAL_CAMPAIGNS);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>('SCR-T1-G42');
  const [whyThisAdScreen, setWhyThisAdScreen] = useState<ScreenUI | null>(null);

  // Simulation Clock & Speed
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 10 | 60>(1);
  const [simMinutes, setSimMinutes] = useState(850); // 14:10 UTC (Worked example time)
  const [feedStatus, setFeedStatus] = useState<'live' | 'mock'>('mock');
  const [lastEventNotice, setLastEventNotice] = useState<string | null>(
    'Telemetry connected: Gate 42 Perfume rule active'
  );

  // Format sim minutes to HH:MM
  const formatClock = (mins: number) => {
    const h = Math.floor((mins % 1440) / 60).toString().padStart(2, '0');
    const m = (mins % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  // Clock progression loop
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setSimMinutes((prev) => prev + 1);
    }, 1000 / speed);
    return () => clearInterval(interval);
  }, [isPlaying, speed]);

  // Adjust theme class on body based on role
  useEffect(() => {
    const isLightRole = currentRole === 'retailer' || currentRole === 'media_manager' || currentRole === 'airline';
    if (isLightRole) {
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
    }
  }, [currentRole]);

  // SSE Live Feed Listener with automatic graceful fallback
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/events');
      es.onopen = () => {
        setFeedStatus('live');
        setLastEventNotice('Connected to live backend SSE stream (/api/events)');
      };
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'flight_delay') {
            setLastEventNotice(`AIDX Event: Flight ${data.flightNumber} delayed +${data.delayMinutes}m`);
          }
        } catch {
          // ignore parse errors
        }
      };
      es.onerror = () => {
        setFeedStatus('mock');
      };
    } catch {
      setFeedStatus('mock');
    }

    return () => {
      if (es) es.close();
    };
  }, []);

  // Event Injection Handler (The Brief's Headline Cause-and-Effect Demo)
  const handleInjectEvent = (type: 'delay_dxb' | 'gate_change' | 'queue_surge' | 'screen_offline') => {
    if (type === 'delay_dxb') {
      // 1. Update Flight SL882 DXB with 45 min delay
      setFlights((prev) =>
        prev.map((f) =>
          f.id === 'FL-SL882'
            ? { ...f, status: 'delayed', delayMinutes: 45, estimatedDeparture: '15:20' }
            : f
        )
      );

      // 2. Increase Gate 40-48 ZonePresence pax and dwell time
      setZones((prev) =>
        prev.map((z) =>
          z.id === 'T1-Z2'
            ? { ...z, passengerCount: 310, dwellMinutes: 52, internationalShare: 0.85 }
            : z
        )
      );

      // 3. Trigger Decision Engine: Aura Perfume Oud Royale wins Gate 42 screen with +1.5x boost
      setScreens((prev) =>
        prev.map((s) =>
          s.id === 'SCR-T1-G42'
            ? {
                ...s,
                currentAd: {
                  campaignId: 'CAMP-PERFUME-01',
                  campaignTitle: 'Aura Élixir Oud Royale 20% Off',
                  advertiser: 'Aura Luxury Duty Free',
                  headline: 'Aura Élixir Oud Royale',
                  bodyText: 'Exclusive 20% off for international travelers heading to Gulf destinations. Show this code at Gate 42 Duty Free boutique.',
                  imageUrl: 'https://images.unsplash.com/photo-1547887537-6158d64c35b3?w=800&q=80',
                  promoCode: 'AURA-DXB-20',
                  discount: '20% OFF',
                  audienceMatchScore: 0.85,
                  winningReason: 'International Long-Haul + Gulf Destination + High Dwell (52m) + Delay Rule Triggered (+1.5x boost)',
                },
              }
            : s
        )
      );

      setLastEventNotice('⚡ AIDX Event: Flight SL882 (DXB) Delayed +45m → Gate 42 switched to Aura Perfume (< 2s)');
    } else if (type === 'gate_change') {
      setFlights((prev) =>
        prev.map((f) =>
          f.id === 'FL-SL882' ? { ...f, gate: 'Gate 44' } : f
        )
      );
      setLastEventNotice('🚪 AIDX Event: Flight SL882 moved from Gate 42 to Gate 44');
    } else if (type === 'queue_surge') {
      setZones((prev) =>
        prev.map((z) =>
          z.id === 'T1-Z3' ? { ...z, passengerCount: z.passengerCount + 60 } : z
        )
      );
      setLastEventNotice('📈 ACRIS Event: Queue surge at Security North (+60 pax)');
    } else if (type === 'screen_offline') {
      setScreens((prev) =>
        prev.map((s) =>
          s.id === 'SCR-T2-G12'
            ? { ...s, status: s.status === 'offline' ? 'online' : 'offline' }
            : s
        )
      );
      setLastEventNotice('⚠️ Hardware Event: Screen SCR-T2-G12 status toggled');
    }
  };

  // Record redemption
  const handleRecordRedemption = (code: string) => {
    setCampaigns((prev) =>
      prev.map((c) =>
        c.promoCode === code
          ? { ...c, redemptionsCount: c.redemptionsCount + 1 }
          : c
      )
    );
    setLastEventNotice(`🎉 Live Redemption Recorded: ${code} claimed in-store!`);
  };

  // If navigating directly to a mobile claim URL
  if (isClaimRoute) {
    return (
      <MobileClaimView
        promoCode={claimCode}
        onBackToApp={() => {
          window.history.pushState({}, '', '/');
          setCurrentRole('passenger_screen');
        }}
        onRecordRedemption={handleRecordRedemption}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Global Header */}
      <Header
        currentRole={currentRole}
        onSelectRole={setCurrentRole}
        airportClock={formatClock(simMinutes)}
        speed={speed}
        feedStatus={feedStatus}
      />

      {/* Global Simulation Bar with WOW Trigger Buttons */}
      <SimulationBar
        isPlaying={isPlaying}
        speed={speed}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        onSelectSpeed={setSpeed}
        onInjectEvent={handleInjectEvent}
        lastEventNotice={lastEventNotice}
      />

      {/* Active Role Persona View */}
      <main style={{ flex: 1 }}>
        {currentRole === 'admin' && (
          <AdminView
            zones={zones}
            screens={screens}
            flights={flights}
            selectedScreenId={selectedScreenId}
            onSelectScreen={setSelectedScreenId}
            onOpenWhyThisAd={setWhyThisAdScreen}
          />
        )}

        {currentRole === 'retailer' && (
          <RetailerView
            campaigns={campaigns}
            zones={zones}
            flights={flights}
          />
        )}

        {currentRole === 'media_manager' && (
          <MediaManagerView
            screens={screens}
            campaigns={campaigns}
          />
        )}

        {currentRole === 'airline' && (
          <AirlineView
            flights={flights}
            onTriggerDelayVoucher={() => {
              setLastEventNotice('✈️ Airline Care: $10 Goodwill coffee vouchers pushed to delayed passengers');
            }}
          />
        )}

        {currentRole === 'passenger_screen' && (
          <PassengerScreenView
            screens={screens}
            selectedScreenId={selectedScreenId}
            onSelectScreen={setSelectedScreenId}
            onOpenWhyThisAd={setWhyThisAdScreen}
            flights={flights}
          />
        )}

        {currentRole === 'split_screen' && (
          <SplitScreenView
            zones={zones}
            screens={screens}
            flights={flights}
            selectedScreenId={selectedScreenId}
            onSelectScreen={setSelectedScreenId}
            onOpenWhyThisAd={setWhyThisAdScreen}
          />
        )}

        {currentRole === 'mobile_claim' && (
          <MobileClaimView
            promoCode="AURA-DXB-20"
            onBackToApp={() => setCurrentRole('passenger_screen')}
            onRecordRedemption={handleRecordRedemption}
          />
        )}
      </main>

      {/* "Why This Ad?" Audit Trail Drawer */}
      <WhyThisAdModal
        screen={whyThisAdScreen}
        onClose={() => setWhyThisAdScreen(null)}
      />
    </div>
  );
};
