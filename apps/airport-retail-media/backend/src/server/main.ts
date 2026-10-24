/**
 * Production server entry point.
 *
 * Runs `createApp` with seeded airport state and serves the static frontend
 * on `process.env.PORT || 4000`.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { emptyState, SimulationState } from './simulation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function seedProductionWorld(nowIso = new Date().toISOString()): SimulationState {
  const state = emptyState();

  state.zones = [
    { id: 'T1-Z1', name: 'T1 Central Plaza & Duty Free Walkway', terminalId: 'T1', kind: 'retail', adjacentZoneIds: ['T1-Z2', 'T1-Z3'] },
    { id: 'T1-Z2', name: 'T1 Gate 40-48 Concourse Pier', terminalId: 'T1', kind: 'gate-area', adjacentZoneIds: ['T1-Z1'] },
    { id: 'T1-Z3', name: 'T1 Security North & Checkpoints', terminalId: 'T1', kind: 'security', adjacentZoneIds: ['T1-Z1'] },
    { id: 'T2-Z1', name: 'T2 Domestic Concourse B', terminalId: 'T2', kind: 'gate-area', adjacentZoneIds: [] },
  ];

  state.gateToZone = new Map([
    ['Gate 42', 'T1-Z2'],
    ['Gate 44', 'T1-Z2'],
    ['Gate 38', 'T1-Z1'],
    ['Gate 12', 'T2-Z1'],
  ]);

  state.screens = [
    { id: 'SCR-T1-G42', name: 'Gate 42 Boarding Totem', zoneId: 'T1-Z2', terminalId: 'T1', orientation: '9:16', resolution: { width: 1080, height: 1920 }, online: true, lastHeartbeat: nowIso },
    { id: 'SCR-T1-PLAZA-01', name: 'Central Plaza Grand Billboard', zoneId: 'T1-Z1', terminalId: 'T1', orientation: '16:9', resolution: { width: 3840, height: 2160 }, online: true, lastHeartbeat: nowIso },
    { id: 'SCR-T1-SEC-03', name: 'Security North Exit Totem', zoneId: 'T1-Z3', terminalId: 'T1', orientation: '9:16', resolution: { width: 1080, height: 1920 }, online: true, lastHeartbeat: nowIso },
    { id: 'SCR-T2-G12', name: 'T2 Gate 12 Domestic Display', zoneId: 'T2-Z1', terminalId: 'T2', orientation: '16:9', resolution: { width: 1920, height: 1080 }, online: true, lastHeartbeat: nowIso },
  ];

  state.flights = [
    {
      id: 'FL-SL882',
      flightNumber: 'SL882',
      airline: 'SL',
      origin: 'NVA',
      destination: 'DXB',
      scheduledDeparture: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
      scheduledArrival: null,
      estimatedDeparture: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
      actualDeparture: null,
      estimatedArrival: null,
      actualArrival: null,
      tobt: null,
      tsat: null,
      aibt: null,
      aobt: null,
      status: 'scheduled',
      delayMinutes: 0,
      delayCode: null,
      passengerCount: 280,
      international: true,
      aircraftType: 'B77W',
      gate: 'Gate 42',
      stand: 'S42',
      checkInCounters: ['10', '11', '12'],
      belt: 'B4',
      provenance: { source: 'aodb', observedAt: nowIso, ingestedAt: nowIso },
    },
    {
      id: 'FL-HZ401',
      flightNumber: 'HZ401',
      airline: 'HZ',
      origin: 'NVA',
      destination: 'LHR',
      scheduledDeparture: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      scheduledArrival: null,
      estimatedDeparture: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      actualDeparture: null,
      estimatedArrival: null,
      actualArrival: null,
      tobt: null,
      tsat: null,
      aibt: null,
      aobt: null,
      status: 'boarding',
      delayMinutes: 0,
      delayCode: null,
      passengerCount: 245,
      international: true,
      aircraftType: 'A359',
      gate: 'Gate 38',
      stand: 'S38',
      checkInCounters: ['20', '21'],
      belt: 'B2',
      provenance: { source: 'aodb', observedAt: nowIso, ingestedAt: nowIso },
    },
    {
      id: 'FL-NV109',
      flightNumber: 'NV109',
      airline: 'NV',
      origin: 'NVA',
      destination: 'FRA',
      scheduledDeparture: new Date(Date.now() + 75 * 60 * 1000).toISOString(),
      scheduledArrival: null,
      estimatedDeparture: new Date(Date.now() + 75 * 60 * 1000).toISOString(),
      actualDeparture: null,
      estimatedArrival: null,
      actualArrival: null,
      tobt: null,
      tsat: null,
      aibt: null,
      aobt: null,
      status: 'scheduled',
      delayMinutes: 0,
      delayCode: null,
      passengerCount: 190,
      international: true,
      aircraftType: 'A321',
      gate: 'Gate 44',
      stand: 'S44',
      checkInCounters: ['30'],
      belt: 'B1',
      provenance: { source: 'aodb', observedAt: nowIso, ingestedAt: nowIso },
    },
    {
      id: 'FL-MH304',
      flightNumber: 'MH304',
      airline: 'MH',
      origin: 'NVA',
      destination: 'BOM',
      scheduledDeparture: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scheduledArrival: null,
      estimatedDeparture: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      actualDeparture: null,
      estimatedArrival: null,
      actualArrival: null,
      tobt: null,
      tsat: null,
      aibt: null,
      aobt: null,
      status: 'boarding',
      delayMinutes: 0,
      delayCode: null,
      passengerCount: 160,
      international: false,
      aircraftType: 'A320',
      gate: 'Gate 12',
      stand: 'S12',
      checkInCounters: ['40'],
      belt: 'B3',
      provenance: { source: 'aodb', observedAt: nowIso, ingestedAt: nowIso },
    },
  ];

  state.candidates = [
    {
      campaignId: 'CAMP-PERFUME-01',
      advertiserId: 'ADV-AURA',
      zoneIds: ['T1-Z1', 'T1-Z2'],
      status: 'active',
      startAt: '2026-10-01T00:00:00.000Z',
      endAt: '2026-11-01T00:00:00.000Z',
      target: { international: 0.8, business: 0.4, holiday: 0.3 },
      international: true,
      minAudience: 100,
      creativeApproved: true,
      brandSafetyOk: true,
      category: 'perfume',
      remainingBudgetMinorUnits: 500000,
      hourlyCapMinorUnits: null,
      spentThisHourMinorUnits: 0,
      isHomeAirline: false,
      triggers: { delay: 1.5 },
    },
    {
      campaignId: 'CAMP-COFFEE-03',
      advertiserId: 'ADV-ROAST',
      zoneIds: ['T1-Z1', 'T1-Z2', 'T1-Z3'],
      status: 'active',
      startAt: '2026-10-01T00:00:00.000Z',
      endAt: '2026-11-01T00:00:00.000Z',
      target: { international: 0.4, business: 0.7, holiday: 0.4 },
      international: false,
      minAudience: 50,
      creativeApproved: true,
      brandSafetyOk: true,
      category: 'coffee',
      remainingBudgetMinorUnits: 300000,
      hourlyCapMinorUnits: null,
      spentThisHourMinorUnits: 0,
      isHomeAirline: false,
    },
    {
      campaignId: 'CAMP-CAELUM-02',
      advertiserId: 'ADV-CAELUM',
      zoneIds: ['T1-Z1'],
      status: 'active',
      startAt: '2026-10-01T00:00:00.000Z',
      endAt: '2026-11-01T00:00:00.000Z',
      target: { international: 0.6, business: 0.8 },
      international: true,
      minAudience: 80,
      creativeApproved: true,
      brandSafetyOk: true,
      category: 'lounge',
      remainingBudgetMinorUnits: 800000,
      hourlyCapMinorUnits: null,
      spentThisHourMinorUnits: 0,
      isHomeAirline: false,
    },
    {
      campaignId: 'CAMP-TOY-02',
      advertiserId: 'ADV-WONDER',
      zoneIds: ['T1-Z2', 'T2-Z1'],
      status: 'active',
      startAt: '2026-10-01T00:00:00.000Z',
      endAt: '2026-11-01T00:00:00.000Z',
      target: { family: 0.7, holiday: 0.5 },
      international: false,
      minAudience: 60,
      creativeApproved: true,
      brandSafetyOk: true,
      category: 'toys',
      remainingBudgetMinorUnits: 300000,
      hourlyCapMinorUnits: null,
      spentThisHourMinorUnits: 0,
      isHomeAirline: false,
    },
  ];

  return state;
}

function resolveStaticDir(): string | undefined {
  if (process.env.STATIC_DIR && fs.existsSync(process.env.STATIC_DIR)) {
    return process.env.STATIC_DIR;
  }
  // Check relative to cwd
  const cwdDist = path.resolve(process.cwd(), 'frontend/dist');
  if (fs.existsSync(cwdDist)) return cwdDist;

  // Check relative to compiled dist/server/main.js
  const relativeDist = path.resolve(__dirname, '../../../frontend/dist');
  if (fs.existsSync(relativeDist)) return relativeDist;

  return undefined;
}

const PORT = Number(process.env.PORT || 4000);
const HOST = '0.0.0.0';

const staticDir = resolveStaticDir();
const state = seedProductionWorld();
const app = createApp(state, { staticDir });

app.server.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(` AeroMedia Platform (TopCoder Development Deliverable) `);
  console.log(` Running on: http://${HOST}:${PORT}`);
  console.log(` Static frontend dir: ${staticDir || '(API only mode)'}`);
  console.log(` Live Telemetry SSE: http://${HOST}:${PORT}/api/events`);
  console.log(`=======================================================`);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down server...');
  await app.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await app.close();
  process.exit(0);
});
