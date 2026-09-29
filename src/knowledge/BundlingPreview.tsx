import { curveBundle, line } from "d3-shape";

/** Preview draft settings without reading notes or changing saved preferences. */
export function BundlingPreview({ strength }: { strength: number }) {
  const curve = line<[number, number]>().curve(curveBundle.beta(strength));
  return (
    <svg
      className="bundling-preview"
      viewBox="0 0 430 150"
      role="img"
      aria-label={`Bundling strength preview at ${Math.round(strength * 100)} percent`}
    >
      <title>
        Higher strength gathers connections along shared folder routes.
      </title>
      {[25, 55, 95, 125].map((y, i) => (
        <g key={y}>
          <path
            d={
              curve([
                [25, y],
                [100, 75],
                [215, 45],
                [330, 75],
                [405, 25 + i * 33],
              ]) ?? ""
            }
          />
          <circle cx="25" cy={y} r="4" />
          <circle cx="405" cy={25 + i * 33} r="4" />
        </g>
      ))}
    </svg>
  );
}
