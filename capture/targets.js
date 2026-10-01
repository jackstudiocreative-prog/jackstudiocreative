// Capture plan: where the phone should point for each photo.
// Rings tuned for a phone held upright (portrait), where the main camera sees roughly 37–45° across
// and 58–67° top-to-bottom. Neighbouring photos overlap by ~15°, enough to align and blend.

export function buildTargets() {
  const t = [];
  const ring = (count, pitchDeg, offsetDeg = 0) => {
    for (let k = 0; k < count; k++) {
      t.push({ yaw: ((offsetDeg + (360 / count) * k + 180) % 360) - 180, pitch: pitchDeg });
    }
  };
  ring(16, 0);          // eye level
  ring(10, 45, 18);     // upper ring
  ring(10, -45, 18);    // lower ring
  t.push({ yaw: 0, pitch: 88 });   // ceiling
  t.push({ yaw: 0, pitch: -88 });  // floor
  return t.map((x, i) => ({ ...x, id: i }));
}
