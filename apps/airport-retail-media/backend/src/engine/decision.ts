/**
 * The decision pipeline — evidence-first crowd-to-screen matching.
 *
 * The brief fixes both the order and the output shape, so both are implemented
 * literally rather than approximated:
 *
 *   Profile -> Filter (hard rules) -> Score -> Business rules -> Choose & log
 *
 * The audit record is the deliverable as much as the decision is. The brief says
 * the crowd profile, the rules, the scores and the reason must be visible in every
 * role, and names the record shape directly. So `DecisionRecord` below mirrors it
 * field for field, and every candidate — including the filtered-out ones — carries
 * the reason it lost. A panel cannot explain a decision the engine did not record.
 *
 * A note on the score arithmetic. The brief states
 *
 *     AudienceMatch = sum(segmentShare * segmentWeight)
 *     FinalScore    = AudienceMatch * TriggerBoost
 *
 * and then gives a worked example whose numbers do not follow it: a match of 0.71
 * with a 1.5 boost is 1.065, but the example reports 0.86. The formula as written is
 * implemented here, because inventing a curve to hit three published numbers would
 * make every other decision unexplainable. If the example is meant to include a
 * normalisation the brief did not state, that belongs in the formula, not in a
 * magic constant here.
 */

import type { Provenance } from '../model/canonical.js';
import { CrowdProfile, SegmentKey, share } from './crowd.js';

/** How much each segment counts toward an audience match, 0..1. */
export type SegmentWeights = Partial<Record<SegmentKey, number>>;

/** A campaign, reduced to what a decision needs. */
export interface CampaignCandidate {
  campaignId: string;
  advertiserId: string;
  /** Which zones it may run in. Empty means anywhere. */
  zoneIds: string[];
  status: 'draft' | 'active' | 'paused' | 'ended';
  startAt: string;
  endAt: string;
  /** Segment weights describe what this campaign is trying to reach. */
  target: SegmentWeights;
  /** Prefer international (true) / domestic (false). Null means either. */
  international: boolean | null;
  minAudience: number;
  /** Creative readiness — an unapproved creative cannot play. */
  creativeApproved: boolean;
  brandSafetyOk: boolean;
  /** Category, for competitor separation ("perfume", "coffee", ...). */
  category: string;
  /** Remaining budget in minor units; null means uncapped. */
  remainingBudgetMinorUnits: number | null;
  /** Hourly pacing cap in minor units; null means uncapped. */
  hourlyCapMinorUnits: number | null;
  /** Spend already made this hour, in minor units. */
  spentThisHourMinorUnits: number;
  /** True when the advertiser is the airline whose flight is boarding here. */
  isHomeAirline: boolean;
}

/** Everything a decision needs that is not the campaign list. */
export interface DecisionInput {
  screenId: string;
  zoneId: string;
  /** ISO 8601 — the moment being decided for. */
  at: string;
  profile: CrowdProfile;
  campaigns: CampaignCandidate[];
  /** Minutes until the next boarding in this zone; drives the airline priority. */
  minutesToBoarding: number | null;
  /** Median delay feeding this zone, for the goodwill trigger. */
  medianDelayMinutes: number | null;
  /** Campaigns that played recently, most recent first, for frequency capping. */
  recentPlays: { campaignId: string; playedAt: string }[];
  /** Category of the immediately previous ad, for competitor separation. */
  previousCategory: string | null;
  /** How many times a campaign may play on a screen within the window. */
  frequencyCap: number;
  /** Window for the frequency cap, in minutes. */
  frequencyWindowMinutes: number;
}

/** One candidate's outcome, kept whether it won, lost or was filtered. */
export interface DecisionCandidate {
  campaignId: string;
  /** Final score. Null when the campaign never reached scoring. */
  score: number | null;
  /** 1-based rank among scored candidates. Null when filtered. */
  rank: number | null;
  audienceMatch: number | null;
  triggerBoost: number;
  /** Set when a hard rule removed it, and the human-readable reason why. */
  filteredBy: string | null;
  reason: string;
}

/** The audit record. Field names mirror the brief's shape. */
export interface DecisionRecord {
  screenId: string;
  timestamp: string;
  crowdProfile: CrowdProfile;
  candidates: DecisionCandidate[];
  winnerId: string | null;
  winningReason: string;
  evidence: Provenance[];
}

/** Trigger boosts. A delay is the one the brief calls out by name. */
export const DELAY_TRIGGER_BOOST = 1.5;
export const BOARDING_TRIGGER_BOOST = 1.2;

/** Audience match: sum of share x weight over the segments the campaign targets. */
export function audienceMatch(profile: CrowdProfile, target: SegmentWeights): number {
  let sum = 0;
  for (const [k, w] of Object.entries(target)) {
    if (typeof w !== 'number' || w <= 0) continue;
    sum += share(profile, k as SegmentKey) * w;
  }
  // Clamp: a target whose weights sum above 1 must not produce a match above 1,
  // or one over-specified campaign would outrank everything for the wrong reason.
  return Math.min(1, sum);
}

/** The trigger boost for a decision. Delay beats boarding; otherwise no boost. */
export function triggerBoost(input: Pick<DecisionInput, 'minutesToBoarding' | 'medianDelayMinutes'>): {
  boost: number;
  reason: string | null;
} {
  if (typeof input.medianDelayMinutes === 'number' && input.medianDelayMinutes >= 30) {
    return { boost: DELAY_TRIGGER_BOOST, reason: `delay of ${input.medianDelayMinutes} min in this zone` };
  }
  if (typeof input.minutesToBoarding === 'number' && input.minutesToBoarding <= 30) {
    return { boost: BOARDING_TRIGGER_BOOST, reason: `boarding in ${input.minutesToBoarding} min` };
  }
  return { boost: 1, reason: null };
}

/** Hard rules, in the brief's order. Returns the rule name, or null to pass. */
export function hardRuleFailure(
  c: CampaignCandidate,
  input: DecisionInput
): { rule: string; reason: string } | null {
  const at = Date.parse(input.at);

  if (c.status !== 'active') {
    return { rule: 'schedule', reason: `campaign is ${c.status}, not active` };
  }
  if (Date.parse(c.startAt) > at || Date.parse(c.endAt) < at) {
    return { rule: 'schedule', reason: 'outside its booked window' };
  }
  if (c.zoneIds.length && !c.zoneIds.includes(input.zoneId)) {
    // The brief's own wording for this case, so the UI can reuse the phrase.
    return { rule: 'placement', reason: 'filtered to other gates' };
  }
  if (!c.creativeApproved) {
    return { rule: 'creative', reason: 'creative not approved' };
  }
  if (!c.brandSafetyOk) {
    return { rule: 'brand-safety', reason: 'brand safety checklist failed' };
  }
  if (c.international !== null) {
    // The crowd leans international when more than half of it is.
    const crowdIsInternational = input.profile.internationalShare >= 0.5;
    if (c.international !== crowdIsInternational) {
      return {
        rule: 'international',
        reason: `targets ${c.international ? 'international' : 'domestic'}, crowd is ${crowdIsInternational ? 'international' : 'domestic'}`,
      };
    }
  }
  if (input.profile.estimatedCount < c.minAudience) {
    return {
      rule: 'min-audience',
      reason: `needs ${c.minAudience} people, ${input.profile.estimatedCount} in front of the screen`,
    };
  }
  if (c.remainingBudgetMinorUnits !== null && c.remainingBudgetMinorUnits <= 0) {
    return { rule: 'budget', reason: 'budget exhausted' };
  }
  if (c.hourlyCapMinorUnits !== null && c.spentThisHourMinorUnits >= c.hourlyCapMinorUnits) {
    return { rule: 'budget-pacing', reason: 'hourly pacing cap reached' };
  }
  return null;
}

/**
 * Run the pipeline and return the audit record.
 *
 * Nothing is discarded: filtered candidates stay in the record with their reason,
 * because "why did my campaign not play?" is the question every role asks and the
 * one the brief requires to be answerable.
 */
export function decide(input: DecisionInput): DecisionRecord {
  const { boost, reason: boostReason } = triggerBoost(input);
  const candidates: DecisionCandidate[] = [];

  // ---- Filter + Score ----------------------------------------------------
  for (const c of input.campaigns) {
    const failed = hardRuleFailure(c, input);
    if (failed) {
      candidates.push({
        campaignId: c.campaignId,
        score: null,
        rank: null,
        audienceMatch: null,
        triggerBoost: 1,
        filteredBy: failed.rule,
        reason: failed.reason,
      });
      continue;
    }
    const match = audienceMatch(input.profile, c.target);
    // Clamp the final score too. A boost can push Match x Boost above 1, and a score
    // that outruns its own range is not comparable across screens. Clamping is
    // monotonic, so it cannot change the ordering — only the numbers shown.
    const score = Math.min(1, match * boost);
    candidates.push({
      campaignId: c.campaignId,
      score,
      rank: null,
      audienceMatch: match,
      triggerBoost: boost,
      filteredBy: null,
      reason: `audience match ${(match * 100).toFixed(0)}%${boost !== 1 ? ` x ${boost} (${boostReason})` : ''}`,
    });
  }

  // ---- Business rules ----------------------------------------------------
  const capSince = Date.parse(input.at) - input.frequencyWindowMinutes * 60_000;
  const playsInWindow = input.recentPlays.filter((p) => Date.parse(p.playedAt) >= capSince);
  const playCount = new Map<string, number>();
  for (const p of playsInWindow) playCount.set(p.campaignId, (playCount.get(p.campaignId) ?? 0) + 1);

  for (const cand of candidates) {
    if (cand.filteredBy) continue;
    const c = input.campaigns.find((x) => x.campaignId === cand.campaignId)!;

    // Frequency cap: the same ad must not repeat past the limit on one screen.
    if ((playCount.get(c.campaignId) ?? 0) >= input.frequencyCap) {
      cand.filteredBy = 'frequency-cap';
      cand.reason = `already played ${playCount.get(c.campaignId)} times in the last ${input.frequencyWindowMinutes} min`;
      cand.score = null;
      continue;
    }
    // Competitor separation: no two ads from the same category back to back.
    if (input.previousCategory && c.category === input.previousCategory) {
      cand.filteredBy = 'competitor-separation';
      cand.reason = `same category (${c.category}) as the ad before it`;
      cand.score = null;
      continue;
    }
  }

  // Airline priority during the boarding window: the home airline's own messaging
  // jumps the queue, which is a rule rather than a boost so it cannot be outscored.
  const scored = candidates.filter((c) => !c.filteredBy && c.score !== null);
  let priority: DecisionCandidate | null = null;
  if (typeof input.minutesToBoarding === 'number' && input.minutesToBoarding <= 30) {
    priority = scored.find((cand) => {
      const c = input.campaigns.find((x) => x.campaignId === cand.campaignId)!;
      return c.isHomeAirline;
    }) ?? null;
  }

  // ---- Choose ------------------------------------------------------------
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  scored.forEach((c, i) => (c.rank = i + 1));

  let winner: DecisionCandidate | null = null;
  let winningReason = 'no campaign passed the rules for this screen and crowd';
  if (priority) {
    winner = priority;
    winningReason = `airline priority: boarding in ${input.minutesToBoarding} min, home airline messaging takes the slot`;
  } else if (scored.length) {
    winner = scored[0];
    winningReason = `${winner.reason}; highest of ${scored.length} eligible`;
  }

  return {
    screenId: input.screenId,
    timestamp: input.at,
    crowdProfile: input.profile,
    candidates,
    winnerId: winner ? winner.campaignId : null,
    winningReason,
    evidence: input.profile.evidence,
  };
}

/**
 * Online feedback: redemptions nudge segment weights.
 *
 * Deliberately a pure function returning a new target rather than a mutation, so
 * the learning step is testable and a decision can be replayed against the weights
 * it actually used.
 */
export function nudgeWeights(
  target: SegmentWeights,
  profile: CrowdProfile,
  converted: boolean,
  rate = 0.02
): SegmentWeights {
  const out: SegmentWeights = { ...target };
  const dir = converted ? 1 : -1;
  for (const [k, w] of Object.entries(target)) {
    if (typeof w !== 'number') continue;
    const key = k as SegmentKey;
    const observed = share(profile, key);
    if (observed <= 0) continue;
    // Nudge toward what was actually in front of the screen when it converted.
    const next = (w as number) + dir * rate * observed;
    out[key] = Math.max(0, Math.min(1, next));
  }
  return out;
}
