# AeroMedia — Airport Retail Media Platform

> **TopCoder Development Challenge Deliverable**  
> Challenge ID: `75cc9178-1789-4870-82dc-821bd5491f11`

A locally runnable, production-ready prototype of an airport retail media platform: dynamic advertising on airport screens timed to the passengers physically in front of them, triggered in real-time by live flight telemetry, passenger queue density, and audience dwell profiling.

---

## ⚡ Quickstart (One Command)

### Option A: Local Docker (Recommended)

Brings up the backend server, builds the frontend, seeds the fictional airport telemetry, and serves everything on `localhost:4000`:

```bash
docker compose up --build
```

Open your browser at **[http://localhost:4000](http://localhost:4000)**.

### Option B: Local Node (No Docker Required)

Requires Node.js 20+:

```bash
npm install
npm run build
npm start
```

Open **[http://localhost:4000](http://localhost:4000)**.

---

## 🧪 Verification & Acceptance Tests

Run the full automated test suite (7 test suites, 0 dependencies):

```bash
npm run test:backend
```

```
✓ worked example: PASSED (Perfume 0.847 winner, Toy Store 0.278, Lounge Daypass filtered)
✓ aodb adapter:   PASSED (40 flight legs parsed from CSV text, A-CDM honesty verified)
✓ presence:       PASSED (Continuous boarding curve, queues + flights blend, monotonicity)
✓ aidx adapter:   PASSED (IATA_AIDX_FlightLegNotifRQ stream parsed, delay & gate changes)
✓ acris adapter:  PASSED (FIWARE NGSI-LD JSON queues, unwrapped properties & relationships)
✓ loop:           PASSED (Cause-and-effect: Injected delay flips Coffee -> Perfume in 0.8ms)
✓ server:         PASSED (HTTP + SSE broadcast, SPA static serving, path traversal blocked)
```

---

## 🏛️ Architecture & Data Spine

The core principle mandated by the brief is **source decoupling**: *"going live means writing one new adapter and nothing else. The app core only ever sees a canonical internal model."*

```
   ┌────────────────────────────────────────────────────────┐
   │                  AIRPORT DATA SOURCES                  │
   └────────────────────────────────────────────────────────┘
          │                       │                     │
   [AODB Snapshot]         [AIDX XML Stream]    [ACRIS NGSI-LD]
     Flight Legs             Delays & Gates       Queue Sensors
          │                       │                     │
          ▼                       ▼                     ▼
   ┌─────────────┐         ┌─────────────┐      ┌─────────────┐
   │AODB Adapter │         │AIDX Adapter │      │ACRIS Adapter│
   └─────────────┘         └─────────────┘      └─────────────┘
          │                       │                     │
          └───────────────────────┼─────────────────────┘
                                  ▼
                    ┌───────────────────────────┐
                    │  Canonical Domain Model   │
                    │   Flight / Zone / Screen  │
                    └───────────────────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │    ZonePresence Engine    │
                    │  5-min rolling window     │
                    │  Pax × Proximity curve    │
                    │  + Checkpoint queues      │
                    └───────────────────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │  Evidence Decision Engine │
                    │  Hard Filters             │
                    │  Audience Match Scoring   │
                    │  Per-Campaign Delay Boost │
                    └───────────────────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │ HTTP + SSE Event Bus      │
                    │ Zero-dependency node:http │
                    │ <2s cause-and-effect      │
                    └───────────────────────────┘
                                  │
                   ┌──────────────┴──────────────┐
                   ▼                             ▼
       ┌───────────────────────┐     ┌───────────────────────┐
       │ Operator Control Room │     │ Passenger Totem 9:16  │
       │ Interactive SVG Plan  │     │ Live FIDS + QR Coupon │
       └───────────────────────┘     └───────────────────────┘
```

---

## 🎯 The Worked Example (Gate 42, 14:10 UTC)

The brief specifies a concrete worked example:
- **Flight**: SkyLink flight `SL882` to Dubai at **Gate 42** delayed by **45 minutes**.
- **Passengers**: 280 international travelers with 52 minutes of dwell time near Duty Free.
- **Decision Outcome**:
  1. **Aura Luxury Perfume** (`CAMP-PERFUME-01`): Base match 0.565 $\times$ 1.5 delay boost = **0.847** $\to$ **WINNER (Rank 1)**.
  2. **Wonderland Travel Toys** (`CAMP-TOY-02`): Family match = **0.278** $\to$ **Rank 2**.
  3. **Caelum Premium Lounge** (`CAMP-CAELUM-02`): Hard-filtered (Terminal Plaza zone only).

Every ad decision carries an explicit audit record matching the brief's schema:
```json
{
  "screenId": "SCR-T1-G42",
  "timestamp": "2026-10-24T14:10:00.000Z",
  "crowdProfile": { "zoneId": "T1-Z2", "paxCount": 280, "dwellMinutes": 52 },
  "candidates": [
    { "campaignId": "perfume", "score": 0.847, "rank": 1 },
    { "campaignId": "toys", "score": 0.278, "rank": 2 }
  ],
  "winnerId": "perfume",
  "winningReason": "International Long-Haul + Gulf Destination + Delay Rule Triggered (+1.5x boost)",
  "evidence": ["pax: 280", "mttb: 52", "destination: DXB", "boost: 1.5"]
}
```

---

## 🔌 Data Adapter Guide (Adding a New Source)

Adding a real-world airport vendor requires modifying **only** the adapter layer:

### 1. AODB Flight Movements Adapter (`backend/src/adapters/aodb.ts`)
Map your vendor's CSV or JSON column headers to the canonical fields in `COLUMN_MAP`:
```typescript
export const COLUMN_MAP: Record<string, keyof Flight | 'ignore'> = {
  vendor_flight_number: 'flightNumber',
  vendor_pax_load: 'passengerCount',
  tobt: 'tobt',
  tsat: 'tsat',
};
```

### 2. AIDX Flight-Leg Notification Adapter (`backend/src/adapters/aidx.ts`)
Converts standard `IATA_AIDX_FlightLegNotifRQ` XML payloads into `FlightEvent` objects for status changes, delays, and gate moves.

### 3. ACRIS Sensor Adapter (`backend/src/adapters/acris.ts`)
Unwraps FIWARE Smart Data Models NGSI-LD entities (`urn:ngsi-ld:Checkpoint`, `urn:ngsi-ld:QueueMeasurement`) into canonical checkpoint queues.

---

## 👥 Five Persona Role Views (Zero-Auth Header Switcher)

Switch personas instantly using the top navigation pill bar:

1. **Platform Admin**: Control-room dark theme with an interactive SVG blueprint of Terminal 1 & 2, dynamic heat map density overlay, screen health dots, and feed telemetry.
2. **Retailer**: Store sales KPIs, 2-hour upcoming passenger flow forecast by destination, campaign builder with live audience match estimator, and active promo code tracking.
3. **Media Manager**: Screen $\times$ Hour slot occupancy matrix, dynamic yield pricing heatmap ($18–$32/CPM), and creative approval queue.
4. **Airline Representative**: Flight turnaround timeline, gate media overrides, and automated delay goodwill care ($10 vouchers).
5. **Passenger Screen Simulator**: Responsive 16:9 landscape and 9:16 portrait totem with live FIDS flight ticker, targeted creative, dynamic QR coupon, and **"Why this ad?"** audit drawer.
6. **Split-Screen Demo**: Side-by-side view (Operator floor plan on left, Passenger totem on right) showcasing <2s cause-and-effect.
7. **Mobile Claim Page (`/claim/:code`)**: Mobile view for scanning QR codes from a smartphone camera and claiming coupons in-store.

---

## 🌐 Playground Deployment (1-Click Cloud)

The repository includes a ready-to-use `render.yaml` blueprint and multi-stage `Dockerfile`:

1. **Render.com**:
   - Create a new **Web Service** on Render.
   - Connect the repository and select **Docker** environment.
   - Port: `4000`.
   - Your playground URL will be live at `https://<service-name>.onrender.com`.

2. **Railway / Fly.io**:
   - Run `railway up` or `fly launch` — automatically builds the root `Dockerfile`.

---

## 📖 API Reference

See [`openapi.yaml`](./openapi.yaml) for the full OpenAPI 3.1 specification.

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Healthcheck, simulation clock, subscriber count |
| `/api/events` | GET | Live Server-Sent Events (SSE) telemetry stream |
| `/api/inject` | POST | Inject AIDX delay, gate change, or queue surge |
| `/api/decision/:screenId` | GET | Retrieve latest ad decision audit trail |
| `/api/redeem` | POST | Redeem promo code voucher |
