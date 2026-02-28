// Unit conversion module. DB always stores metric. Frontend converts on display.

const units = (() => {
  const STORAGE_KEY = 'kitchenaid_units';

  // currentSystem: 'metric' | 'imperial'
  let currentSystem = localStorage.getItem(STORAGE_KEY) || 'metric';

  // Conversion factors: metric → imperial
  const toImperial = {
    g:  { factor: 0.035274,  unit: 'oz' },
    ml: { factor: 0.033814,  unit: 'fl oz' },
  };

  // Conversion factors: imperial → metric (for values stored with imperial units)
  const toMetric = {
    'oz':     { factor: 28.3495, unit: 'g' },
    'fl oz':  { factor: 29.5735, unit: 'ml' },
    'lb':     { factor: 453.592, unit: 'g' },
    'lbs':    { factor: 453.592, unit: 'g' },
    'pint':   { factor: 473.176, unit: 'ml' },
    'quart':  { factor: 946.353, unit: 'ml' },
    'gallon': { factor: 3785.41, unit: 'ml' },
  };

  // Metric units that should display as plain rounded numbers (no fractions)
  const metricUnits = new Set(['g', 'ml', 'kg', 'l', 'mg']);

  function roundMetric(v) {
    if (v >= 100) return Math.round(v / 5) * 5;
    if (v >= 10)  return Math.round(v);
    return Math.round(v * 10) / 10;
  }

  // Smart fraction display (for imperial / cup / tsp / tbsp)
  const FRACTIONS = [
    [1,   '1'],    [0.875, '⅞'],  [0.75, '¾'],  [0.667, '⅔'],
    [0.5, '½'],   [0.333, '⅓'],  [0.25, '¼'],  [0.125, '⅛'],
  ];

  function toFraction(n) {
    if (n === 0) return '0';
    const whole = Math.floor(n);
    const frac = n - whole;
    if (frac < 0.05) return String(whole || 0);

    for (const [val, sym] of FRACTIONS) {
      if (Math.abs(frac - val) < 0.07) {
        return whole > 0 ? `${whole} ${sym}` : sym;
      }
    }
    // Fallback: round to 1 decimal
    return n < 10 ? n.toFixed(1) : Math.round(n).toString();
  }

  function formatMetric(amount) {
    const v = roundMetric(amount);
    return v >= 10 ? String(v) : String(v);
  }

  function formatAmount(amount, unit) {
    if (amount === 0) return '';

    let displayAmount = amount;
    let displayUnit = unit || '';

    if (currentSystem === 'imperial') {
      // g/ml → imperial
      const conv = toImperial[displayUnit];
      if (conv) {
        displayAmount = amount * conv.factor;
        displayUnit = conv.unit;
        return `${toFraction(displayAmount)} ${displayUnit}`.trim();
      }
      // °C → °F
      if (displayUnit === '°C') {
        displayAmount = (amount * 9 / 5) + 32;
        displayUnit = '°F';
        return `${Math.round(displayAmount)} ${displayUnit}`.trim();
      }
      // Already-imperial units stored in DB (e.g. oz, fl oz): show as-is with fractions
      if (toMetric[displayUnit]) {
        return `${toFraction(displayAmount)} ${displayUnit}`.trim();
      }
    } else {
      // metric mode: convert any imperial unit stored in DB to metric
      const conv = toMetric[displayUnit];
      if (conv) {
        displayAmount = roundMetric(amount * conv.factor);
        displayUnit = conv.unit;
        return `${displayAmount} ${displayUnit}`.trim();
      }
    }

    // Pass-through units (tsp, tbsp, cup, piece, pinch, etc.)
    // Use fractions for cooking units, plain number for metric units
    if (metricUnits.has(displayUnit)) {
      return `${formatMetric(displayAmount)} ${displayUnit}`.trim();
    }
    return `${toFraction(displayAmount)} ${displayUnit}`.trim();
  }

  // Replace °C in step text when imperial
  function convertStepText(text) {
    if (currentSystem !== 'imperial') return text;
    return text.replace(/(\d+(?:\.\d+)?)\s*°C/g, (_, n) => {
      const f = Math.round((parseFloat(n) * 9 / 5) + 32);
      return `${f} °F`;
    });
  }

  function getSystem() { return currentSystem; }

  function setSystem(sys) {
    currentSystem = sys;
    localStorage.setItem(STORAGE_KEY, sys);
    document.dispatchEvent(new CustomEvent('unitsChanged', { detail: { system: sys } }));
  }

  function toggle() {
    setSystem(currentSystem === 'metric' ? 'imperial' : 'metric');
  }

  return { formatAmount, convertStepText, getSystem, setSystem, toggle };
})();
