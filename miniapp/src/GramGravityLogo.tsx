import "./GramGravityLogo.css";

const GEM_PATH =
  "M 43.5,54.1 Q 50,44 62,44 L 138,44 Q 150,44 156.5,54.1 L 169.5,73.9 Q 176,84 172.8,95.6 L 159.2,144.4 Q 156,156 145.3,161.4 L 110.7,178.6 Q 100,184 89.3,178.6 L 54.7,161.4 Q 44,156 40.8,144.4 L 27.2,95.6 Q 24,84 30.5,73.9 L 43.5,54.1 Z";

const STAR_PATH =
  "M 115,67 C 120,88 120,88 141,93 C 120,98 120,98 115,119 C 110,98 110,98 89,93 C 110,88 110,88 115,67 Z";

type Props = {
  size?: number;
  animated?: boolean;
};

export function GramGravityLogo({ size = 120, animated = true }: Props) {
  const padding = size * 0.27;

  return (
    <div className="logo-wrap" style={{ width: size, padding, overflow: "visible" }}>
      <svg
        viewBox="0 0 200 200"
        overflow="visible"
        style={{ width: "100%", display: "block" }}
        aria-hidden
      >
        <defs>
          <radialGradient
            id="ggr"
            cx="100"
            cy="107"
            r="82"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#2d2d3c" />
            <stop offset="40%" stopColor="#161622" />
            <stop offset="72%" stopColor="#080810" />
            <stop offset="100%" stopColor="#000000" />
          </radialGradient>
          <filter id="gga" x="-55%" y="-55%" width="210%" height="210%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
          <filter id="ggh" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="w" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="n" />
            <feMerge>
              <feMergeNode in="w" />
              <feMergeNode in="n" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="ggs" x="-90%" y="-90%" width="280%" height="280%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="og" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="ig" />
            <feMerge>
              <feMergeNode in="og" />
              <feMergeNode in="ig" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d={GEM_PATH}
          fill="white"
          filter="url(#gga)"
          style={{ opacity: 0.08 }}
          className={animated ? "gg-au" : undefined}
        />
        <path
          d={GEM_PATH}
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          filter="url(#ggh)"
          style={{ opacity: 0.5 }}
          className={animated ? "gg-ho" : undefined}
        />
        <path
          d={GEM_PATH}
          fill="url(#ggr)"
          stroke="white"
          strokeWidth="1.5"
        />
        <path
          d={STAR_PATH}
          fill="white"
          filter="url(#ggs)"
          style={{ opacity: 0.9 }}
          className={animated ? "gg-sp" : undefined}
        />
      </svg>
    </div>
  );
}
