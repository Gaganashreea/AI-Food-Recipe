import { useMemo } from "react";
import { useRecipe } from "../context/RecipeContext";

const STATUS_META = {
  discard:    { label: "Looks spoiled", icon: "⛔" },
  "use-soon": { label: "Use soon",      icon: "⏰" },
  good:       { label: "Good",          icon: "✅" },
  unknown:    { label: "Can't tell",    icon: "❔" },
};

const nameKey = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(es|s)$/, "");

const DATE_TYPE_LABEL = {
  "use-by": "Use by",
  "best-before": "Best before",
  expiry: "Expiry",
  unknown: "Date",
};

function FreshnessCard({ item, onDateChange }) {
  const meta = STATUS_META[item.status] || STATUS_META.unknown;
  const expiry = item.expiry;

  return (
    <div className={`freshness-card status-${item.status}`}>
      <div className="freshness-card-header">
        <h4>{item.name}</h4>
        <span className={`freshness-badge status-${item.status}`}>
          {meta.icon} {meta.label}
        </span>
      </div>

      {item.freshnessScore !== null && (
        <div className="freshness-meter" role="img" aria-label={`Freshness ${item.freshness}`}>
          <div
            className={`freshness-meter-fill status-${item.status}`}
            style={{ width: `${item.freshnessScore}%` }}
          />
        </div>
      )}

      <p className="freshness-condition">{item.condition}</p>

      <div className="freshness-meta">
        <span><strong>Freshness:</strong> {item.freshness}</span>
        <span><strong>Shelf life:</strong> {item.estimatedShelfLife}</span>
        <span><strong>Waste risk:</strong> {item.wasteRisk}</span>
      </div>

      {/* Printed date section */}
      <div className={`expiry-box${expiry ? ` expiry-${expiry.state}` : ""}`}>
        {expiry ? (
          <>
            <div className="expiry-main">
              📅 {expiry.text}
            </div>
            <div className="expiry-sub">
              {DATE_TYPE_LABEL[expiry.type] || "Date"} ·{" "}
              {expiry.source === "manual" ? "set by you" : `read from label: ${expiry.printedText}`}
            </div>
          </>
        ) : (
          <div className="expiry-sub">📅 No printed date detected</div>
        )}

        <label className="expiry-edit">
          <span>{expiry ? "Wrong date? Fix it:" : "Add the date:"}</span>
          <input
            type="date"
            value={expiry?.date || ""}
            onChange={(e) => onDateChange(item.name, e.target.value)}
          />
        </label>
      </div>

      {item.statusReason && <p className="freshness-reason">{item.statusReason}</p>}

      {item.status === "discard" && (
        <p className="freshness-warning">
          Check this item carefully and throw it away if in doubt. It won&apos;t be
          used in recipes.
        </p>
      )}
    </div>
  );
}

function FreshnessReport() {
  const { ingredients, freshness, prioritizeFresh, setPrioritizeFresh, updateExpiryDate } =
    useRecipe();

  const items = useMemo(() => {
    const current = new Set(ingredients.map(nameKey));
    return freshness.filter((i) => current.has(nameKey(i.name)));
  }, [ingredients, freshness]);

  const counts = useMemo(() => {
    const c = { discard: 0, "use-soon": 0, good: 0, unknown: 0 };
    items.forEach((i) => {
      c[i.status] = (c[i.status] || 0) + 1;
    });
    return c;
  }, [items]);

  if (items.length === 0) return null;

  const hasAttention = counts.discard > 0 || counts["use-soon"] > 0;

  return (
    <div className="freshness-report">
      <h3>Freshness Check</h3>

      <div className="freshness-summary">
        {Object.entries(STATUS_META).map(([status, meta]) =>
          counts[status] > 0 ? (
            <span key={status} className={`freshness-pill status-${status}`}>
              {meta.icon} {counts[status]} {meta.label.toLowerCase()}
            </span>
          ) : null
        )}
      </div>

      {hasAttention && (
        <label className="freshness-toggle">
          <input
            type="checkbox"
            checked={prioritizeFresh}
            onChange={(e) => setPrioritizeFresh(e.target.checked)}
          />
          Build recipes around items I should use soon
        </label>
      )}

      <div className="freshness-grid">
        {items.map((item) => (
          <FreshnessCard key={item.name} item={item} onDateChange={updateExpiryDate} />
        ))}
      </div>

      <p className="freshness-disclaimer">
        Freshness is estimated from the photo, and dates are read by AI, so they can be
        misread. Please check the date on the package yourself. This can&apos;t detect
        bacteria, smell or taste, so always use your own judgment.
      </p>
    </div>
  );
}

export default FreshnessReport;