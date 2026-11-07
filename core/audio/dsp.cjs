// @ts-check
const { dbToGain } = require("./engine.cjs");
/** Streaming stereo DSP. State is retained across decoder chunks. @param {import('zod').infer<typeof import('./schema.cjs').effectsSchema>} effects @param {number} rate */
function createProcessor(effects, rate) {
  const gains = [dbToGain(effects.lowDb), dbToGain(effects.midDb), dbToGain(effects.highDb)];
  const previous = [0, 0],
    hp = [0, 0],
    low = [0, 0],
    lowHigh = [0, 0];
  let envelope = 0,
    reduction = 1,
    gate = 1;
  const hpA = effects.highpass ? Math.exp((-2 * Math.PI * effects.highpass) / rate) : 0,
    lowA = 1 - Math.exp((-2 * Math.PI * 250) / rate),
    highA = 1 - Math.exp((-2 * Math.PI * 4000) / rate);
  /** @param {number} left @param {number} right @returns {[number,number]} */
  return (left, right) => {
    if (effects.bypass) return [left, right];
    const values = [left, right];
    for (let c = 0; c < 2; c++) {
      let x = values[c];
      if (effects.highpass) {
        const y = hpA * (hp[c] + x - previous[c]);
        previous[c] = x;
        hp[c] = y;
        x = y;
      }
      low[c] += lowA * (x - low[c]);
      lowHigh[c] += highA * (x - lowHigh[c]);
      values[c] =
        low[c] * gains[0] + (lowHigh[c] - low[c]) * gains[1] + (x - lowHigh[c]) * gains[2];
    }
    const peak = Math.max(Math.abs(values[0]), Math.abs(values[1]));
    envelope +=
      (peak - envelope) *
      (peak > envelope ? 1 - Math.exp(-1 / (0.005 * rate)) : 1 - Math.exp(-1 / (0.1 * rate)));
    const db = 20 * Math.log10(Math.max(1e-10, envelope));
    const target =
      effects.compressor && db > effects.thresholdDb
        ? dbToGain(effects.thresholdDb + (db - effects.thresholdDb) / effects.ratio - db)
        : 1;
    reduction += (target - reduction) * (target < reduction ? 0.02 : 0.0003);
    const gateTarget = effects.noiseGate && db < effects.noiseFloorDb ? 0 : 1;
    gate += (gateTarget - gate) * (gateTarget > gate ? 0.02 : 0.0003);
    const ceiling = dbToGain(effects.ceilingDb);
    /** @param {number} x */
    const limit = (x) => (effects.limiter ? Math.max(-ceiling, Math.min(ceiling, x)) : x);
    return [limit(values[0] * reduction * gate), limit(values[1] * reduction * gate)];
  };
}
module.exports = { createProcessor };
