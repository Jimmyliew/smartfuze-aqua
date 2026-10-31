'use strict';
/**
 * SMARTFUZE AQUA - pH calibration math.
 *
 * Piecewise linear interpolation between real buffer calibration points.
 * The PH-4502C output voltage FALLS as pH rises, so RAW decreases as pH increases.
 * Points are sorted by RAW (descending) and each segment is interpolated on its own.
 * Outside the calibrated range the nearest end segment is extended (extrapolation),
 * and the result is clamped to 0..14.
 */

const ADC_MAX = 4095;
const ADC_VREF = 3.3;

function validPoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map(p => ({ ph: Number(p.ph), raw: Number(p.raw) }))
    .filter(p => Number.isFinite(p.ph) && Number.isFinite(p.raw) && p.raw > 0 && p.raw < ADC_MAX)
    .sort((a, b) => b.raw - a.raw); // high raw (acidic) first
}

/** Returns null when calibration is unusable or raw is not a plausible ADC value. */
function rawToPh(raw, points) {
  const r = Number(raw);
  if (!Number.isFinite(r) || r <= 10 || r >= ADC_MAX - 5) return null; // disconnected / saturated
  const pts = validPoints(points);
  if (pts.length < 2) return null;

  let a, b;
  if (r >= pts[0].raw) { a = pts[0]; b = pts[1]; }
  else if (r <= pts[pts.length - 1].raw) { a = pts[pts.length - 2]; b = pts[pts.length - 1]; }
  else {
    for (let i = 0; i < pts.length - 1; i++) {
      if (r <= pts[i].raw && r >= pts[i + 1].raw) { a = pts[i]; b = pts[i + 1]; break; }
    }
  }
  if (!a || !b || a.raw === b.raw) return null;
  const ph = a.ph + (r - a.raw) * (b.ph - a.ph) / (b.raw - a.raw);
  return Math.round(Math.min(14, Math.max(0, ph)) * 100) / 100;
}

/** ESP32 pin voltage from a 12-bit raw value (same formula as firmware). */
function rawToPinVoltage(raw) {
  const r = Number(raw);
  if (!Number.isFinite(r)) return null;
  return Math.round((r / ADC_MAX) * ADC_VREF * 1000) / 1000;
}

/** pH module PO voltage reconstructed through the divider (top / bottom resistors). */
function pinToModuleVoltage(vPin, topOhm, bottomOhm) {
  if (!Number.isFinite(vPin) || !(bottomOhm > 0)) return null;
  return Math.round(vPin * (topOhm + bottomOhm) / bottomOhm * 1000) / 1000;
}

/** Slope summary per segment (pH units per 100 raw counts) - useful to spot a dying probe. */
function describe(points) {
  const pts = validPoints(points);
  const segments = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    segments.push({
      from: a.ph, to: b.ph,
      phPer100Raw: Math.round(((b.ph - a.ph) / (a.raw - b.raw)) * 100 * 1000) / 1000
    });
  }
  return { pointCount: pts.length, segments };
}

module.exports = { rawToPh, rawToPinVoltage, pinToModuleVoltage, describe, validPoints, ADC_MAX, ADC_VREF };
