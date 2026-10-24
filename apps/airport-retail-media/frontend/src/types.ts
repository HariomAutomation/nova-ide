export type Role =
  | 'admin'
  | 'retailer'
  | 'media_manager'
  | 'airline'
  | 'passenger_screen'
  | 'split_screen'
  | 'mobile_claim';

export interface FlightUI {
  id: string;
  flightNumber: string;
  airline: string;
  airlineName: string;
  destination: string;
  destinationCity: string;
  origin: string;
  gate: string;
  terminal: string;
  scheduledDeparture: string;
  estimatedDeparture: string;
  status: 'scheduled' | 'boarding' | 'delayed' | 'departed' | 'cancelled';
  delayMinutes: number;
  passengerCount: number;
  international: boolean;
}

export interface ZoneUI {
  id: string;
  name: string;
  terminal: string;
  concourse: string;
  passengerCount: number;
  confidence: number;
  dwellMinutes: number;
  internationalShare: number;
  businessShare: number;
  familyShare: number;
  leisureShare: number;
  topDestinations: { code: string; count: number }[];
  activeScreens: number;
}

export interface ScreenUI {
  id: string;
  name: string;
  terminal: string;
  zoneId: string;
  zoneName: string;
  gate?: string;
  orientation: 'landscape' | 'portrait';
  status: 'online' | 'warning' | 'offline';
  resolution: string;
  currentAd?: {
    campaignId: string;
    campaignTitle: string;
    advertiser: string;
    headline: string;
    bodyText: string;
    imageUrl: string;
    promoCode: string;
    discount: string;
    audienceMatchScore: number;
    winningReason: string;
  };
}

export interface CampaignUI {
  id: string;
  advertiserId: string;
  advertiserName: string;
  title: string;
  status: 'active' | 'scheduled' | 'paused' | 'pending_approval';
  targetZones: string[];
  triggerType?: 'delay' | 'gate_change' | 'high_dwell' | 'boarding';
  headline: string;
  body: string;
  promoCode: string;
  discount: string;
  budgetTotal: number;
  budgetSpent: number;
  impressionsCount: number;
  scansCount: number;
  redemptionsCount: number;
  audienceMatchScore: number;
  cpm: number;
}

export interface DecisionRecordUI {
  screenId: string;
  timestamp: string;
  crowdProfile: {
    zoneId: string;
    paxCount: number;
    dwellMinutes: number;
    internationalShare: number;
    segments: Record<string, number>;
  };
  candidates: {
    campaignId: string;
    campaignTitle: string;
    advertiser: string;
    score: number;
    matchScore: number;
    triggerBoost: number;
    rank: number;
    rejectedReason?: string;
  }[];
  winnerId: string;
  winnerTitle: string;
  winningReason: string;
  evidence: string[];
}

export interface SimulationState {
  isPlaying: boolean;
  speed: 1 | 10 | 60;
  clockIso: string;
  injectedEventsCount: number;
}
