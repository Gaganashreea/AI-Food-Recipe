/**
 * Freshness + expiry helpers
 * --------------------------
 * Combines two signals per food item:
 *   1. VISUAL  - how the food looks (from the AI)
 *   2. DATE    - the printed expiry / best-before date (read from the label)
 * The WORSE of the two decides the final status. No external dependencies.
 */

const FRESHNESS_LEVELS = ["Fresh", "Good", "Fair", "Poor", "Unknown"];
const WASTE_RISKS = ["Low", "Medium", "High", "Unknown"];

const FRESHNESS_SCORE = { Fresh: 95, Good: 75, Fair: 50, Poor: 15, Unknown: null };
const STATUS_ORDER = { discard: 0, "use-soon": 1, good: 2, unknown: 3 };

const SOON_DAYS = 2; // "expiring soon" threshold

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Small utilities ──────────────────────────────────────────

const nameKey = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(es|s)$/, "");

const toTitle = (s) => String(s || "").trim();
const toBool = (v) => v === true || String(v).toLowerCase() === "true";
const toNumberOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// ── Date helpers ─────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");

/** Date -> "YYYY-MM-DD" using local date parts. */
function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Build a valid ISO string or null (rejects 31 Feb etc.). */
function makeISO(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fullYear = (yy) => (yy < 100 ? 2000 + yy : yy);

/**
 * Parse many printed date formats into "YYYY-MM-DD".
 * Ambiguous numeric dates are read as DD/MM/YYYY (Indian / EU convention),
 * unless the month part is clearly > 12.
 * Month-only dates ("12/2026", "DEC 2026") resolve to the LAST day of the month.
 */
function parseDateString(input, now = new Date()) {
  if (input === null || input === undefined) return null;

  let s = String(input)
    .toLowerCase()
    .replace(/\b(exp(?:iry|ires|\.)?|use\s*by|best\s*before|best\s*by|bbe?|date|on)\b\.?:?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  let iso = null;
  let m;

  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    iso = makeISO(+m[1], +m[2], +m[3]);
  } else if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/))) {
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // it was MM/DD
    iso = makeISO(fullYear(+m[3]), mo, d);
  } else if ((m = s.match(/^(\d{1,2})[\s\-\/.]*([a-z]{3,9})[\s\-\/.,]*(\d{2}|\d{4})$/)) && MONTHS[m[2]]) {
    iso = makeISO(fullYear(+m[3]), MONTHS[m[2]], +m[1]);
  } else if ((m = s.match(/^([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{2}|\d{4})$/)) && MONTHS[m[1]]) {
    iso = makeISO(fullYear(+m[3]), MONTHS[m[1]], +m[2]);
  } else if ((m = s.match(/^(\d{1,2})[\/\-.](\d{4})$/)) && +m[1] >= 1 && +m[1] <= 12) {
    iso = makeISO(+m[2], +m[1], lastDayOfMonth(+m[2], +m[1]));
  } else if ((m = s.match(/^([a-z]{3,9})[\s\-\/.,]*(\d{4})$/)) && MONTHS[m[1]]) {
    iso = makeISO(+m[2], MONTHS[m[1]], lastDayOfMonth(+m[2], MONTHS[m[1]]));
  }

  if (!iso) return null;

  // Sanity: reject dates that are clearly misreads.
  const year = +iso.slice(0, 4);
  const thisYear = now.getFullYear();
  if (year < thisYear - 2 || year > thisYear + 10) return null;

  return iso;
}

/** Whole days from today to the ISO date (negative = already passed). */
function daysUntil(iso, now = new Date()) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

function describeExpiry(daysLeft, iso) {
  const when = formatDate(iso);
  if (daysLeft < -1) return `Expired ${Math.abs(daysLeft)} days ago (${when})`;
  if (daysLeft === -1) return `Expired yesterday (${when})`;
  if (daysLeft === 0) return `Expires today (${when})`;
  if (daysLeft === 1) return `Expires tomorrow (${when})`;
  return `Expires in ${daysLeft} days (${when})`;
}

function normalizeDateType(raw) {
  const s = String(raw || "").toLowerCase();
  if (/use/.test(s)) return "use-by";
  if (/best|quality|bb/.test(s)) return "best-before";
  if (/exp/.test(s)) return "expiry";
  return "unknown";
}

/**
 * Work out the printed-date info for one item.
 * Precedence: manualExpiry (user edit) > expiryDate (AI) > expiry (previous result).
 */
function resolveExpiry(raw, now) {
  let iso = null;
  let text = "";
  let source = "label";
  let type = normalizeDateType(raw.dateType ?? raw.expiry?.type);

  if (raw.manualExpiry !== undefined && raw.manualExpiry !== null) {
    iso = parseDateString(raw.manualExpiry.date, now);
    if (!iso) return null; // user cleared it (or typed junk)
    source = "manual";
    if (type === "unknown") type = "expiry";
    text = formatDate(iso);
  } else {
    const rawDate = raw.expiryDate ?? raw.expiry?.date;
    const rawText = raw.expiryDateText ?? raw.expiry?.text;
    iso = parseDateString(rawDate, now) || parseDateString(rawText, now);
    if (!iso) return null;
    source = raw.expiry?.source || "label";
    text = toTitle(raw.expiryDateText) || toTitle(raw.expiry?.printedText) || formatDate(iso);
  }

  const daysLeft = daysUntil(iso, now);
  const state = daysLeft < 0 ? "expired" : daysLeft <= SOON_DAYS ? "soon" : "ok";

  return {
    date: iso,
    printedText: text,          // what was printed / entered
    text: describeExpiry(daysLeft, iso), // human sentence for the UI
    daysLeft,
    type,
    state,
    source,                     // "label" | "manual"
  };
}

// ── Visual-only helpers ──────────────────────────────────────

function normalizeFreshnessLevel(raw) {
  const s = String(raw || "").toLowerCase();

  if (!s) return "Unknown";
  if (/(spoil|rot|mold|mould|bad|poor|slimy|off\b|expired)/.test(s)) return "Poor";
  if (/(cannot|can't|unknown|n\/a|unable|not sure|undetermin)/.test(s)) return "Unknown";
  if (/not\s+(very\s+)?(fresh|good)/.test(s)) return "Fair";
  if (/(fair|ok\b|okay|average|moderate|aging|declin)/.test(s)) return "Fair";
  if (/good/.test(s)) return "Good";
  if (/fresh/.test(s)) return "Fresh";
  return "Unknown";
}

function normalizeWasteRisk(raw, freshness) {
  const s = String(raw || "").toLowerCase();
  if (/high/.test(s)) return "High";
  if (/med/.test(s)) return "Medium";
  if (/low/.test(s)) return "Low";
  return { Fresh: "Low", Good: "Low", Fair: "Medium", Poor: "High", Unknown: "Unknown" }[freshness];
}

function parseShelfLifeDays(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return null;

  const unitDays = (unit) => {
    if (unit.startsWith("hour") || unit.startsWith("hr")) return 1 / 24;
    if (unit.startsWith("week")) return 7;
    if (unit.startsWith("month")) return 30;
    return 1;
  };

  const range = s.match(
    /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|days?|weeks?|months?)/
  );
  if (range) {
    const f = unitDays(range[3]);
    return { min: Number(range[1]) * f, max: Number(range[2]) * f };
  }

  const single = s.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|days?|weeks?|months?)/);
  if (single) {
    const v = Number(single[1]) * unitDays(single[2]);
    return { min: v, max: v };
  }

  if (/(today|immediately|right away|use now|asap)/.test(s)) return { min: 0, max: 1 };
  return null;
}

/** Judge ONE item from its visual data only (no date). */
function assessVisual(raw) {
  const freshness = normalizeFreshnessLevel(raw.freshness);
  const shelfText = toTitle(raw.estimatedShelfLife) || "Unknown";

  let min = toNumberOrNull(raw.estimatedDaysMin);
  let max = toNumberOrNull(raw.estimatedDaysMax);
  if (min === null && max === null) {
    const parsed = parseShelfLifeDays(shelfText);
    if (parsed) ({ min, max } = parsed);
  }
  if (min !== null && max !== null && min > max) [min, max] = [max, min];

  const wasteRisk = normalizeWasteRisk(raw.wasteRisk, freshness);
  const expiringSoon = max !== null && max <= SOON_DAYS;
  const useFirst =
    toBool(raw.useFirst) ||
    freshness === "Fair" ||
    freshness === "Poor" ||
    wasteRisk === "High" ||
    expiringSoon;

  let status = "good";
  let reason = "Looks fine";
  if (freshness === "Poor") {
    status = "discard";
    reason = "Visible signs of spoilage";
  } else if (useFirst) {
    status = "use-soon";
    reason = "Should be used soon";
  } else if (freshness === "Unknown") {
    status = "unknown";
    reason = "Condition can't be judged from the photo";
  }

  return {
    condition: toTitle(raw.condition) || "No visible details",
    freshness,
    estimatedShelfLife: shelfText,
    estimatedDaysMin: min,
    estimatedDaysMax: max,
    wasteRisk,
    useFirst,
    status,
    reason,
  };
}

// ── Main normaliser ──────────────────────────────────────────

/**
 * @param {string[]} ingredients
 * @param {object[]} freshnessAnalysis raw AI items OR previously-normalised items
 * @param {Date}     now               injectable for tests
 */
function normalizeFreshness(ingredients = [], freshnessAnalysis = [], now = new Date()) {
  const names = (Array.isArray(ingredients) ? ingredients : []).map(toTitle).filter(Boolean);
  const rawItems = (Array.isArray(freshnessAnalysis) ? freshnessAnalysis : []).filter(
    (r) => r && typeof r === "object"
  );

  const rawByKey = new Map();
  for (const r of rawItems) {
    if (r.name) rawByKey.set(nameKey(r.name), r);
  }

  const allNames = [...names];
  const seen = new Set(names.map(nameKey));
  for (const r of rawItems) {
    if (r.name && !seen.has(nameKey(r.name))) {
      allNames.push(toTitle(r.name));
      seen.add(nameKey(r.name));
    }
  }

  const items = allNames.map((name) => {
    const raw = rawByKey.get(nameKey(name));

    if (!raw) {
      return {
        name,
        condition: "Not assessed",
        freshness: "Unknown",
        freshnessScore: null,
        estimatedShelfLife: "Unknown",
        estimatedDaysMin: null,
        estimatedDaysMax: null,
        wasteRisk: "Unknown",
        useFirst: false,
        status: "unknown",
        statusReason: "Not assessed",
        expiry: null,
        visual: null,
      };
    }

    // If this item was normalised before, start again from its VISUAL-only
    // values so an edited date can't be polluted by an old date decision.
    const base = raw.visual ? { ...raw, ...raw.visual } : raw;
    const visual = assessVisual(base);
    const expiry = resolveExpiry(raw, now);

    let status = visual.status;
    let statusReason = visual.reason;
    let wasteRisk = visual.wasteRisk;
    let min = visual.estimatedDaysMin;
    let max = visual.estimatedDaysMax;
    let shelfText = visual.estimatedShelfLife;

    if (expiry) {
      const hardDate = expiry.type !== "best-before";

      if (expiry.state === "expired") {
        if (hardDate) {
          status = "discard";
          statusReason = "Past its printed expiry date";
        } else if (status !== "discard") {
          status = "use-soon";
          statusReason = "Past its best-before date, check carefully before using";
        }
        wasteRisk = "High";
      } else if (expiry.state === "soon") {
        if (status !== "discard") {
          status = "use-soon";
          statusReason = "Printed date is very close";
        }
        wasteRisk = "High";
      } else if (status === "unknown") {
        status = "good";
        statusReason = "Printed date is still a way off";
      }

      // Effective days left = the stricter of visual and printed date.
      const dl = Math.max(0, expiry.daysLeft);
      min = min !== null ? Math.min(min, dl) : dl;
      max = max !== null ? Math.min(max, dl) : dl;

      const visualIsStricter = visual.estimatedDaysMax !== null && visual.estimatedDaysMax < dl;
      shelfText = visualIsStricter && expiry.state === "ok" ? visual.estimatedShelfLife : expiry.text;
    }

    return {
      name,
      condition: visual.condition,
      freshness: visual.freshness,
      freshnessScore: FRESHNESS_SCORE[visual.freshness],
      estimatedShelfLife: shelfText,
      estimatedDaysMin: min,
      estimatedDaysMax: max,
      wasteRisk,
      useFirst: status === "use-soon" || status === "discard",
      status,
      statusReason,
      expiry,
      visual: {
        condition: visual.condition,
        freshness: visual.freshness,
        estimatedShelfLife: visual.estimatedShelfLife,
        estimatedDaysMin: visual.estimatedDaysMin,
        estimatedDaysMax: visual.estimatedDaysMax,
        wasteRisk: visual.wasteRisk,
        useFirst: visual.useFirst,
      },
    };
  });

  items.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return (a.estimatedDaysMin ?? Infinity) - (b.estimatedDaysMin ?? Infinity);
  });

  return { ingredients: allNames, items, summary: summarize(items) };
}

function summarize(items) {
  const summary = { total: items.length, discard: 0, useSoon: 0, good: 0, unknown: 0 };
  for (const it of items) {
    if (it.status === "discard") summary.discard++;
    else if (it.status === "use-soon") summary.useSoon++;
    else if (it.status === "good") summary.good++;
    else summary.unknown++;
  }
  return summary;
}

// ── Recipe-generation helpers ────────────────────────────────

function partitionIngredients(ingredients, freshnessAnalysis, now = new Date()) {
  const { items } = normalizeFreshness(ingredients, freshnessAnalysis, now);
  const given = new Set((ingredients || []).map(nameKey));
  const relevant = items.filter((i) => given.has(nameKey(i.name)));

  return {
    usable: relevant.filter((i) => i.status !== "discard"),
    prioritized: relevant.filter((i) => i.status === "use-soon"),
    excluded: relevant.filter((i) => i.status === "discard"),
  };
}

function buildFreshnessPromptSection(prioritized = [], excluded = []) {
  if (!prioritized.length && !excluded.length) return "";

  const lines = ["FRESHNESS CONTEXT (from visual inspection and printed dates):"];

  if (prioritized.length) {
    const list = prioritized
      .map((i) => {
        if (i.expiry) return `${i.name} (${i.expiry.text.replace(/\s*\(.*\)$/, "").toLowerCase()})`;
        if (i.estimatedShelfLife && i.estimatedShelfLife !== "Unknown") {
          return `${i.name} (~${i.estimatedShelfLife} left)`;
        }
        return i.name;
      })
      .join(", ");
    lines.push(
      `- USE THESE FIRST, they are close to spoiling: ${list}.`,
      "- Build the recipe around these ingredients wherever it makes culinary sense, so food waste is reduced."
    );
  }

  if (excluded.length) {
    lines.push(
      `- DO NOT use these, they appear spoiled or are past their date and were removed: ${excluded
        .map((i) => i.name)
        .join(", ")}.`
    );
  }

  return lines.join("\n");
}

module.exports = {
  FRESHNESS_LEVELS,
  WASTE_RISKS,
  nameKey,
  todayISO,
  parseDateString,
  daysUntil,
  normalizeFreshnessLevel,
  parseShelfLifeDays,
  normalizeFreshness,
  partitionIngredients,
  buildFreshnessPromptSection,
};