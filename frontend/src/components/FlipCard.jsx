// One card of the flip clock (e.g. "08").
//
// How the flip works, like a real split-flap clock:
//   - The card is two halves. When the value changes, the static TOP half
//     already shows the new value and the static BOTTOM half still shows the old one.
//   - A top flap showing the OLD value falls forward (rotateX 0 -> -90deg),
//     uncovering the new top half.
//   - Then a bottom flap showing the NEW value swings down (90deg -> 0),
//     covering the old bottom half. When it lands, the flip is done.

import { useState } from "react";
import { motion } from "framer-motion";

const HALF_FLIP = 0.22; // seconds for each half of the flip

function Half({ position, value }) {
  return (
    <div className={`half half-${position}`}>
      <span className="digits">{value}</span>
    </div>
  );
}

export default function FlipCard({ value, corner, label }) {
  // `previous` lags behind `current` until the flip animation finishes.
  const [flip, setFlip] = useState({ current: value, previous: value, id: 0 });

  // Updating state during render when a prop changes is React's recommended
  // way to "remember the old prop" (no extra render pass with stale data).
  if (value !== flip.current) {
    setFlip({ current: value, previous: flip.current, id: flip.id + 1 });
  }
  const flipping = flip.previous !== flip.current;

  return (
    <div className="card" role="img" aria-label={label}>
      <Half position="top" value={flip.current} />
      <Half position="bottom" value={flipping ? flip.previous : flip.current} />

      {flipping && (
        <>
          {/* key = flip id, so a new change mid-flip restarts the animation cleanly */}
          <motion.div
            key={`top-${flip.id}`}
            className="half half-top flap"
            initial={{ rotateX: 0 }}
            animate={{ rotateX: -90 }}
            transition={{ duration: HALF_FLIP, ease: "easeIn" }}
          >
            <span className="digits">{flip.previous}</span>
          </motion.div>
          <motion.div
            key={`bottom-${flip.id}`}
            className="half half-bottom flap"
            initial={{ rotateX: 90 }}
            animate={{ rotateX: 0 }}
            transition={{ duration: HALF_FLIP, ease: "easeOut", delay: HALF_FLIP }}
            onAnimationComplete={() =>
              setFlip((f) => (f.id === flip.id ? { ...f, previous: f.current } : f))
            }
          >
            <span className="digits">{flip.current}</span>
          </motion.div>
        </>
      )}

      <div className="hinge" aria-hidden="true" />
      {corner && <span className="corner" aria-hidden="true">{corner}</span>}
    </div>
  );
}
