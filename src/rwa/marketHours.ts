// SPDX-License-Identifier: MIT
/* ============================================================================
   CHAINLINK'S MARKET-HOURS PROFILE -> `MarketHoursHook`'s SESSION CONFIGURATION.

   Every tokenised-equity feed in `deployments/stockFeeds.ts` carries a profile name
   Chainlink publishes verbatim: today `us_equities_24/5`, `NYSE` or `LSE`. This module
   turns one of those into the three fields `MarketHoursModule.configureMarket` takes —
   `weekdayMask`, `openSecondOfDay`, `closeSecondOfDay` — and is explicit about the two
   places where the translation is lossy, because both are load-bearing.

   ------------------------------------------------------------------------------
   1. THE MODULE KEEPS UTC. AN EXCHANGE KEEPS LOCAL TIME WITH DAYLIGHT SAVING.
   ------------------------------------------------------------------------------
   `MarketHoursModule` stores a session as seconds since UTC midnight. New York and
   London both shift by an hour twice a year, so ONE profile needs TWO configurations
   and somebody has to switch between them. The module's own comment says who: the
   per-pool `issuer`, through `setSessionHours`, and deliberately not governance,
   because a schedule change queued behind a timelock arrives after the session it
   describes.

   So every profile here resolves to a `standard` and a `daylight` variant, and
   `marketSessionFor` will not pick one for you unless you hand it a date. The rules
   used to pick are statutory and computed exactly, never guessed:

     US Eastern   daylight from the SECOND Sunday in March 02:00 local
                  to the FIRST Sunday in November 02:00 local (15 U.S.C. §260a as
                  amended 2007).
     UK           BST from the LAST Sunday in March 01:00 UTC
                  to the LAST Sunday in October 01:00 UTC.

   Both are the rule as it stands in 2026. Permanent daylight time has been proposed
   more than once in the US; if it passes, this file is wrong and the pools it
   configured are wrong with it. That is why `MarketSession.rule` names the rule it
   applied — a caller can assert on it instead of trusting it.

   ------------------------------------------------------------------------------
   2. `open == close` IS REFUSED, SO A 24-HOUR DAY COSTS ONE SECOND
   ------------------------------------------------------------------------------
   `_validateWindowTimes` rejects `open == close` on purpose: it would be readable as
   "closed" or as "always open" and the module refuses to pick. A `us_equities_24/5`
   session is not continuous either — it shuts for the weekend — so it cannot use the
   `sessionEnabled = false` escape.

   The encoding below is therefore a 23:59:59 window repeated Monday to Friday, which
   reproduces the real weekly open and the real weekly close EXACTLY and costs a
   one-second closure once a day, at the instant of the daily rollover (19:59:59 New
   York time). That second is recorded on every session as `gapSeconds` and
   `gapAtSecondOfDay` rather than being left for somebody to discover in production.
   A swap landing in it reverts `MarketClosed`.

   ------------------------------------------------------------------------------
   3. WHAT THIS MODULE DOES NOT KNOW
   ------------------------------------------------------------------------------
   Holidays. Chainlink's profile name says which session a feed follows, not which
   days that exchange is shut, and no holiday calendar is shipped here — inventing
   one would be inventing data about when somebody's money can move. Holidays are the
   issuer's to write with `setHolidays`, and `dayIndexOf` below is the only help this
   module gives. Read the attribution rule in `holidayRecipe` before writing one: an
   override on day D governs the session that OPENS on D, which on a wrapping schedule
   is not the same as "all of UTC day D".
   ============================================================================ */

/** Bit `i` = weekday `i` is a trading day, 0 = Sunday. Monday..Friday. */
export const WEEKDAYS_MON_FRI = 0x3e;

/** `MarketHoursModule.SECONDS_PER_DAY`. */
export const SECONDS_PER_DAY = 86_400;

/** `MarketHoursModule.PPM`. */
export const PPM = 1_000_000;

/** Which half of the year a session is configured for. */
export type DaylightPhase = "standard" | "daylight";

/**
 * A session as `MarketHoursModule` stores it, plus everything the translation had to
 * approximate. Nothing here is a recommendation; it is what the three numbers mean.
 */
export interface MarketSession {
  /** Chainlink's profile name, verbatim. */
  readonly profile: string;
  readonly phase: DaylightPhase;
  /** `MarketSettings.weekdayMask`. */
  readonly weekdayMask: number;
  /** `MarketSettings.openSecondOfDay`, seconds since UTC midnight, inclusive. */
  readonly openSecondOfDay: number;
  /** `MarketSettings.closeSecondOfDay`, seconds since UTC midnight, exclusive. Less
   *  than `openSecondOfDay` means the session wraps past midnight. */
  readonly closeSecondOfDay: number;
  /** True when `closeSecondOfDay < openSecondOfDay`. */
  readonly wraps: boolean;
  /** The exchange-local session this encodes, for a human to check the numbers against. */
  readonly localHours: string;
  /** The offset from UTC of the exchange's local time in this phase, in seconds. */
  readonly utcOffsetSeconds: number;
  /** Seconds per day the encoding closes that the real session does not. 0 or 1 today. */
  readonly gapSeconds: number;
  /** Where that gap falls, seconds since UTC midnight; `null` when `gapSeconds` is 0. */
  readonly gapAtSecondOfDay: number | null;
  /** The statutory rule used to choose `phase`, when a date chose it. */
  readonly rule: string;
  /** Anything a deployer must know before signing this configuration. */
  readonly notes: readonly string[];
}

interface ProfileDefinition {
  readonly profile: string;
  readonly exchangeName: string;
  readonly rule: string;
  readonly localHours: string;
  readonly variants: Readonly<Record<DaylightPhase, Omit<MarketSession, "profile" | "phase" | "wraps" | "rule" | "localHours">>>;
}

/* ----------------------------------------------------------------- profiles */

const US_24_5_NOTES = [
  "Weekly open Sunday 20:00 New York; weekly close Friday 20:00 New York. Chainlink's own schedule for us_equities_24/5 (pre-market 04:00, regular 09:30-16:00, post 16:00-20:00, overnight 20:00-04:00, weekend Fri 20:00 - Sun 20:00 ET).",
  "The encoding closes for ONE SECOND a day at the daily rollover. A swap in that second reverts MarketClosed. There is no encoding without it: the module refuses open == close.",
  "The feed STOPS PUBLISHING over the weekend. A pool banded on it will revert AnswerTooOld from the Friday close until the feed prints again after the Sunday open, at any heartbeat under about 65 hours. That is the session doing its job, not a fault - but the first swap of the week can fail even though the session is open.",
];

const NYSE_NOTES = [
  "Regular session only: 09:30-16:00 New York. Pre-market, post-market and overnight trading are NOT included, so a pool on this profile is shut for about 17.5 hours a day even though its feed keeps publishing through part of that.",
  "Holidays are NOT included. NYSE shuts roughly nine full days and closes early on several more; each is a setHolidays / setSpecialSessions call by the issuer.",
];

const LSE_NOTES = [
  "08:00-16:30 London, regular session, no auction extensions and no holidays.",
  "Every LSE-profile feed in the shipped table FAILED on-chain verification (its ABI methods revert) and is in STOCK_FEED_REJECTIONS. This profile is defined so the mapping is complete, not because anything uses it.",
];

const PROFILES: Readonly<Record<string, ProfileDefinition>> = {
  "us_equities_24/5": {
    profile: "us_equities_24/5",
    exchangeName: "US equities, 24/5",
    rule: "US Eastern: daylight from the second Sunday in March to the first Sunday in November (15 U.S.C. 260a, as amended 2007)",
    localHours: "continuous, Sunday 20:00 to Friday 20:00 New York",
    variants: {
      // EST, UTC-5. Weekly open Mon 01:00 UTC, weekly close Sat 01:00 UTC.
      standard: {
        weekdayMask: WEEKDAYS_MON_FRI,
        openSecondOfDay: 3_600,
        closeSecondOfDay: 3_599,
        utcOffsetSeconds: -5 * 3_600,
        gapSeconds: 1,
        gapAtSecondOfDay: 3_599,
        notes: US_24_5_NOTES,
      },
      // EDT, UTC-4. Weekly open Mon 00:00 UTC, weekly close Sat 00:00 UTC.
      daylight: {
        weekdayMask: WEEKDAYS_MON_FRI,
        openSecondOfDay: 0,
        closeSecondOfDay: 86_399,
        utcOffsetSeconds: -4 * 3_600,
        gapSeconds: 1,
        gapAtSecondOfDay: 86_399,
        notes: US_24_5_NOTES,
      },
    },
  },
  NYSE: {
    profile: "NYSE",
    exchangeName: "New York Stock Exchange, regular session",
    rule: "US Eastern: daylight from the second Sunday in March to the first Sunday in November (15 U.S.C. 260a, as amended 2007)",
    localHours: "09:30-16:00 New York, Monday to Friday",
    variants: {
      standard: {
        weekdayMask: WEEKDAYS_MON_FRI,
        openSecondOfDay: 14 * 3_600 + 30 * 60, // 14:30 UTC
        closeSecondOfDay: 21 * 3_600, // 21:00 UTC
        utcOffsetSeconds: -5 * 3_600,
        gapSeconds: 0,
        gapAtSecondOfDay: null,
        notes: NYSE_NOTES,
      },
      daylight: {
        weekdayMask: WEEKDAYS_MON_FRI,
        openSecondOfDay: 13 * 3_600 + 30 * 60, // 13:30 UTC
        closeSecondOfDay: 20 * 3_600, // 20:00 UTC
        utcOffsetSeconds: -4 * 3_600,
        gapSeconds: 0,
        gapAtSecondOfDay: null,
        notes: NYSE_NOTES,
      },
    },
  },
  LSE: {
    profile: "LSE",
    exchangeName: "London Stock Exchange, regular session",
    rule: "UK: BST from the last Sunday in March 01:00 UTC to the last Sunday in October 01:00 UTC",
    localHours: "08:00-16:30 London, Monday to Friday",
    variants: {
      standard: {
        weekdayMask: WEEKDAYS_MON_FRI,
        openSecondOfDay: 8 * 3_600,
        closeSecondOfDay: 16 * 3_600 + 30 * 60,
        utcOffsetSeconds: 0,
        gapSeconds: 0,
        gapAtSecondOfDay: null,
        notes: LSE_NOTES,
      },
      daylight: {
        weekdayMask: WEEKDAYS_MON_FRI,
        openSecondOfDay: 7 * 3_600,
        closeSecondOfDay: 15 * 3_600 + 30 * 60,
        utcOffsetSeconds: 1 * 3_600,
        gapSeconds: 0,
        gapAtSecondOfDay: null,
        notes: LSE_NOTES,
      },
    },
  },
};

/** Every Chainlink profile name this module can translate. */
export const KNOWN_MARKET_HOURS_PROFILES: readonly string[] = Object.keys(PROFILES);

/** Whether `profile` has a mapping here. An unknown profile is not an error to swallow:
 *  Chainlink can add one, and configuring a pool on a guess is worse than refusing. */
export function isKnownMarketHoursProfile(profile: string): boolean {
  return profile in PROFILES;
}

/* ------------------------------------------------------- daylight-saving rules */

/** UTC midnight of the `n`-th `weekday` of `month` (0-11) in `year`; `n` is 1-based. */
function nthWeekdayUtc(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + shift + (n - 1) * 7));
}

/** UTC midnight of the last `weekday` of `month` (0-11) in `year`. */
function lastWeekdayUtc(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const shift = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, last.getUTCDate() - shift));
}

/**
 * Is US Eastern on daylight time at `when`?
 *
 * Second Sunday in March 02:00 local standard (07:00 UTC) to first Sunday in November
 * 02:00 local daylight (06:00 UTC). The two boundary instants are computed, not
 * tabulated, so the answer is right for any year the rule holds for.
 */
export function usEasternIsDaylight(when: Date): boolean {
  const y = when.getUTCFullYear();
  const start = nthWeekdayUtc(y, 2, 0, 2).getTime() + 7 * 3_600_000;
  const end = nthWeekdayUtc(y, 10, 0, 1).getTime() + 6 * 3_600_000;
  const t = when.getTime();
  return t >= start && t < end;
}

/** Is the UK on BST at `when`? Last Sunday in March 01:00 UTC to last Sunday in October 01:00 UTC. */
export function ukIsDaylight(when: Date): boolean {
  const y = when.getUTCFullYear();
  const start = lastWeekdayUtc(y, 2, 0).getTime() + 1 * 3_600_000;
  const end = lastWeekdayUtc(y, 9, 0).getTime() + 1 * 3_600_000;
  const t = when.getTime();
  return t >= start && t < end;
}

/** Which phase `profile` is in at `when`, by that exchange's own statutory rule. */
export function daylightPhaseFor(profile: string, when: Date): DaylightPhase {
  const def = PROFILES[profile];
  if (!def) throw new Error(`unknown market-hours profile "${profile}"`);
  const daylight = profile === "LSE" ? ukIsDaylight(when) : usEasternIsDaylight(when);
  return daylight ? "daylight" : "standard";
}

/* -------------------------------------------------------------- the mapping */

/**
 * The session fields for `profile`.
 *
 * `phase` may be given explicitly, or as a `Date` to have the statutory rule choose. It
 * is REQUIRED either way: there is no sensible default, and a pool configured for the
 * wrong half of the year trades an hour early or shuts an hour late every day until
 * somebody notices.
 */
export function marketSessionFor(profile: string, phase: DaylightPhase | Date): MarketSession {
  const def = PROFILES[profile];
  if (!def) {
    throw new Error(
      `unknown market-hours profile "${profile}"; known: ${KNOWN_MARKET_HOURS_PROFILES.join(", ")}. ` +
        "Chainlink can publish a profile this SDK has not met; configure the pool by hand rather than by guess.",
    );
  }
  const resolved = phase instanceof Date ? daylightPhaseFor(profile, phase) : phase;
  const v = def.variants[resolved];
  return {
    profile: def.profile,
    phase: resolved,
    weekdayMask: v.weekdayMask,
    openSecondOfDay: v.openSecondOfDay,
    closeSecondOfDay: v.closeSecondOfDay,
    wraps: v.closeSecondOfDay < v.openSecondOfDay,
    localHours: def.localHours,
    utcOffsetSeconds: v.utcOffsetSeconds,
    gapSeconds: v.gapSeconds,
    gapAtSecondOfDay: v.gapAtSecondOfDay,
    rule: def.rule,
    notes: v.notes,
  };
}

/**
 * When the pool's session configuration must be changed next, and to what. The issuer
 * calls `setSessionHours` at (or before) `at`; nothing on chain does it for them.
 *
 * @returns `null` for a profile with no daylight shift — none exists today.
 */
export function nextSessionChange(
  profile: string,
  after: Date,
): { readonly at: Date; readonly from: DaylightPhase; readonly to: DaylightPhase } | null {
  if (!PROFILES[profile]) throw new Error(`unknown market-hours profile "${profile}"`);
  const from = daylightPhaseFor(profile, after);
  // Walk forward a day at a time for at most 400 days. Cheap, exact, and it cannot be
  // wrong about a boundary the way closed-form arithmetic on two different rules can.
  for (let i = 1; i <= 400; i++) {
    const probe = new Date(after.getTime() + i * 86_400_000);
    if (daylightPhaseFor(profile, probe) !== from) {
      // Narrow to the hour.
      let lo = probe.getTime() - 86_400_000;
      let hi = probe.getTime();
      while (hi - lo > 3_600_000) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (daylightPhaseFor(profile, new Date(mid)) === from) lo = mid;
        else hi = mid;
      }
      return { at: new Date(hi), from, to: from === "daylight" ? "standard" : "daylight" };
    }
  }
  return null;
}

/* ---------------------------------------------------------------- holidays */

/** `MarketHoursModule.dayIndexOf`: `timestamp / 86400`, floored. */
export function dayIndexOf(when: Date | number): number {
  const seconds = when instanceof Date ? Math.floor(when.getTime() / 1000) : when;
  return Math.floor(seconds / SECONDS_PER_DAY);
}

/** `MarketHoursModule.weekdayOf`: 0 = Sunday. */
export function weekdayOf(dayIndex: number): number {
  return (dayIndex + 4) % 7;
}

/**
 * How to shut a whole UTC day on a WRAPPING schedule, spelled out because the naive
 * call does not do it and the module's own documentation flags this as a design point
 * somebody will get wrong.
 *
 * An override on day D governs the session that OPENS on D. On a wrapping schedule
 * (which `us_equities_24/5` is, in the standard-time phase) the session that opened on
 * D-1 is still running into D, and a holiday on D does not touch it. Closing all of
 * UTC day D therefore takes BOTH calls below.
 */
export function holidayRecipe(
  session: MarketSession,
  day: Date | number,
): {
  readonly setHolidays: readonly number[];
  readonly setSpecialSessions: readonly { readonly dayIndex: number; readonly openSecondOfDay: number; readonly closeSecondOfDay: number }[];
  readonly note: string;
} {
  const d = dayIndexOf(day);
  if (!session.wraps) {
    return {
      setHolidays: [d],
      setSpecialSessions: [],
      note: "Non-wrapping schedule: the session that opens on this day is the only one that touches it, so one holiday closes the day.",
    };
  }
  return {
    setHolidays: [d],
    setSpecialSessions: [
      // Truncate the previous day's wrapping session so its tail does not run into D.
      // `close = open + 1` is the shortest legal window; `open == close` is refused.
      { dayIndex: d - 1, openSecondOfDay: session.openSecondOfDay, closeSecondOfDay: session.openSecondOfDay + 1 },
    ],
    note:
      "Wrapping schedule: the holiday on D stops a session OPENING on D, but the session that opened on D-1 still runs into D until its close. " +
      "The special session on D-1 truncates that tail. Check the truncation against the exchange's real early-close time before sending it - this is the shortest legal window, not a market rule.",
  };
}
