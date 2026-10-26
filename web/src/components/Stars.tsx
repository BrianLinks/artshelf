import { starParts } from "../lib/format";

export function Stars({ average, count }: { average: number | null; count?: number }) {
  const { full, half, empty } = starParts(average);
  const label = average === null ? "No reviews yet" : `${average.toFixed(1)} out of 5`;
  return (
    <span className="stars" role="img" aria-label={label}>
      {"★".repeat(full)}
      {half ? <span className="half">★</span> : null}
      {"☆".repeat(empty)}
      {count !== undefined ? <span className="muted"> ({count})</span> : null}
    </span>
  );
}
