'use strict';
/**
 * SMARTFUZE AQUA - aquaculture calculations (Pacific white shrimp, low-salinity RAS).
 * Every result is derived from values a person or a sensor actually measured.
 */
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** Fraction of total ammonia present as toxic un-ionised NH3 (Emerson et al., 1975, freshwater).
 *  At the low salinities used here (< ~15 ppt) the salinity correction is small and ignored. */
function nh3Fraction(ph, tempC) {
  if (!isNum(ph) || !isNum(tempC)) return null;
  const pKa = 0.09018 + 2729.92 / (tempC + 273.15);
  return 1 / (1 + Math.pow(10, pKa - ph));
}
function nh3n(tanMgL, ph, tempC) {
  const f = nh3Fraction(ph, tempC);
  return f === null || !isNum(tanMgL) ? null : round(tanMgL * f, 4);
}

/** Sodium bicarbonate needed to raise alkalinity (as CaCO3).
 *  1 mg/L alkalinity needs ~1.68 mg/L NaHCO3; mg/L x m3 = g. */
function bicarbDoseG(currentAlk, targetAlk, volumeM3) {
  if (!isNum(currentAlk) || !isNum(targetAlk) || !isNum(volumeM3) || volumeM3 <= 0 || currentAlk >= targetAlk) return null;
  return Math.round((targetAlk - currentAlk) * 1.68 * volumeM3);
}

/** Nernst temperature compensation around the isopotential point (pH 7). */
function phTempCompensate(phAtCalTemp, tempC, calTempC) {
  if (!isNum(phAtCalTemp) || !isNum(tempC) || !isNum(calTempC)) return null;
  const p = 7 + (phAtCalTemp - 7) * (calTempC + 273.15) / (tempC + 273.15);
  return round(Math.min(14, Math.max(0, p)), 2);
}

function classify(v, lim) {
  if (!isNum(v) || !lim) return null;
  if (isNum(lim.critLow) && v < lim.critLow) return 'crit';
  if (isNum(lim.critHigh) && v > lim.critHigh) return 'crit';
  if (isNum(lim.warnLow) && v < lim.warnLow) return 'warn';
  if (isNum(lim.warnHigh) && v > lim.warnHigh) return 'warn';
  return 'ok';
}

const DAY = 86400000;
const dayMs = s => Date.parse(s + 'T00:00:00');

/** Production cycle summary.
 *  Before the cycle is closed, survival / biomass / FCR are ESTIMATES (counted mortality is always
 *  lower than real mortality). "Verified" survival and final FCR exist only after the cycle is closed
 *  with harvest records. Partial harvests are subtracted from the shrimp still in the tank; a partial
 *  harvest without a count makes the remaining population unknown instead of guessed.
 *  One stocking event per cycle is supported (multiple stockings: start a new cycle). */
function cycleSummary(c, volumeM3, now = Date.now()) {
  const recs = c.records || [];
  const start = dayMs(c.startDate);
  const end = c.endDate ? dayMs(c.endDate) : now;
  const doc = Math.max(0, Math.floor((end - start) / DAY));
  const sum = (type, key) => recs.filter(r => r.type === type).reduce((a, r) => a + (isNum(r[key]) ? r[key] : 0), 0);
  const mortality = sum('mortality', 'count');
  const feedKg = round(sum('feed', 'kg'), 2);
  const samples = recs.filter(r => r.type === 'sample' && isNum(r.avgWeightG)).sort((a, b) => a.date.localeCompare(b.date));
  const last = samples.at(-1), prev = samples.at(-2);
  const harvest = recs.filter(r => r.type === 'harvest');
  const harvestKg = harvest.length ? round(harvest.reduce((a, r) => a + (isNum(r.kg) ? r.kg : 0), 0), 2) : null;
  const harvestCountKnown = harvest.length > 0 && harvest.every(r => isNum(r.count));
  const harvestCount = harvestCountKnown ? harvest.reduce((a, r) => a + r.count, 0) : null;
  const closed = c.status === 'closed';
  const stocked = isNum(c.stockedCount) ? c.stockedCount : null;
  const w0 = isNum(c.initialWeightG) ? c.initialWeightG : 0;
  const initialKg = stocked !== null ? stocked * w0 / 1000 : 0;
  // shrimp believed to be still in the tank
  let aliveEst = null, remainingUnknown = false;
  if (stocked !== null) {
    if (harvest.length && !harvestCountKnown) remainingUnknown = true;
    else aliveEst = Math.max(0, stocked - mortality - (harvestCount || 0));
  }
  const abw = last ? last.avgWeightG : null;
  const biomassEstKg = !closed && aliveEst !== null && abw !== null ? round(aliveEst * abw / 1000, 1) : null;
  const producedKg = (biomassEstKg || 0) + (harvestKg || 0);
  const gainKg = producedKg > 0 ? producedKg - initialKg : null;
  return {
    doc, mortality, feedKg, stocked, aliveEst, remainingUnknown,
    survivalEstPct: stocked && aliveEst !== null ? round((aliveEst + (harvestCount || 0)) / stocked * 100, 1) : null,
    abwG: abw, lastSampleDate: last ? last.date : null,
    biomassEstKg,
    fcrEst: !closed && gainKg > 0 && feedKg > 0 && !remainingUnknown ? round(feedKg / gainKg, 2) : null,
    adgG: last ? round((abw - w0) / Math.max(1, (dayMs(last.date) - start) / DAY), 3) : null,
    weeklyGainG: last && prev ? round((last.avgWeightG - prev.avgWeightG) / Math.max(1, (dayMs(last.date) - dayMs(prev.date)) / DAY) * 7, 2) : null,
    densityPerM3: isNum(volumeM3) && volumeM3 > 0 && aliveEst !== null ? Math.round(aliveEst / volumeM3) : null,
    biomassKgPerM3: isNum(volumeM3) && volumeM3 > 0 && biomassEstKg !== null ? round(biomassEstKg / volumeM3, 2) : null,
    harvestKg, harvestCount, partialHarvest: harvest.length > 0 && !closed,
    // verified only when the cycle is closed and the harvest was counted / weighed
    survivalPct: closed && stocked && harvestCountKnown ? round(harvestCount / stocked * 100, 1) : null,
    fcr: closed && harvestKg && feedKg && harvestKg > initialKg ? round(feedKg / (harvestKg - initialKg), 2) : null
  };
}

module.exports = { nh3Fraction, nh3n, bicarbDoseG, phTempCompensate, classify, cycleSummary, isNum, round };
