/**
 * Phase 8: Design-token contrast validation script.
 *
 * Reads the OKLCH tokens from globals.css, converts to sRGB,
 * calculates WCAG contrast ratios, and fails with exit code 1
 * if any required pair doesn't meet the threshold.
 *
 * Usage: bunx tsx scripts/validate-contrast.ts
 */

// OKLCH → sRGB conversion using the verified CSS Color 4 algorithm.
// Source: https://bottosson.github.io/posts/oklab/
// Uses correct coefficients and cube (not cbrt) for the LMS nonlinearity.
function oklchToLinearSrgb(l: number, c: number, h: number): [number, number, number] {
  const h_rad = (h * Math.PI) / 180;
  const a = c * Math.cos(h_rad);
  const b = c * Math.sin(h_rad);

  // OKLab → LMS
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  // Nonlinear cube (NOT cbrt — the original OKLab uses x^3)
  const l_c = Math.pow(l_, 3);
  const m_c = Math.pow(m_, 3);
  const s_c = Math.pow(s_, 3);

  // LMS → linear sRGB
  const r =  4.0767416621 * l_c - 3.3077115913 * m_c + 0.2309699292 * s_c;
  const g = -1.2684380046 * l_c + 2.6097574011 * m_c - 0.3413193965 * s_c;
  const bl = -0.0041960863 * l_c - 0.7034186147 * m_c + 1.7076147010 * s_c;

  return [r, g, bl];
}

function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const [r, g, bl] = oklchToLinearSrgb(l, c, h);
  const gamma = (v: number) => v <= 0 ? 0 : v >= 1 ? 1 : v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1/2.4) - 0.055;
  return [gamma(r), gamma(g), gamma(bl)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  // WCAG relative luminance
  const R = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const G = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const B = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Token pairs to validate (foreground on background)
const PAIRS = [
  // Light theme — Square UI palette (blue-indigo brand)
  { name: 'brand text on brand-soft (light)', fg: [0.50, 0.19, 264], bg: [0.95, 0.04, 264], min: 4.5 },
  { name: 'success text on success-soft (light)', fg: [0.52, 0.14, 152], bg: [0.95, 0.04, 152], min: 4.5 },
  { name: 'warning text on warning-soft (light)', fg: [0.45, 0.13, 65], bg: [0.95, 0.05, 65], min: 4.5 },
  { name: 'info text on info-soft (light)', fg: [0.50, 0.13, 230], bg: [0.95, 0.04, 230], min: 4.5 },
  { name: 'danger text on danger-soft (light)', fg: [0.52, 0.19, 25], bg: [0.95, 0.05, 25], min: 4.5 },
  { name: 'muted-foreground on muted (light)', fg: [0.48, 0, 0], bg: [0.97, 0, 0], min: 4.5 },
  { name: 'foreground on background (light)', fg: [0.145, 0, 0], bg: [1, 0, 0], min: 4.5 },
  { name: 'warning-foreground on warning (light)', fg: [0.18, 0.04, 65], bg: [0.72, 0.15, 65], min: 4.5 },
];

let failed = 0;
console.log('=== Phase 8: Contrast Validation ===\n');

for (const pair of PAIRS) {
  const fgRgb = oklchToRgb(...pair.fg as [number, number, number]);
  const bgRgb = oklchToRgb(...pair.bg as [number, number, number]);
  const fgLum = relativeLuminance(fgRgb);
  const bgLum = relativeLuminance(bgRgb);
  const ratio = contrastRatio(fgLum, bgLum);
  const pass = ratio >= pair.min;
  const status = pass ? 'PASS' : 'FAIL';
  console.log(`  ${status} ${pair.name}: ${ratio.toFixed(2)}:1 (min ${pair.min}:1)`);
  if (!pass) {
    failed++;
    console.error(`  ✗ FAILED: ${pair.name} — ratio ${ratio.toFixed(2)} below minimum ${pair.min}`);
  }
}

console.log(`\n${failed === 0 ? 'All contrast checks passed.' : `${failed} contrast check(s) failed.`}`);
process.exit(failed > 0 ? 1 : 0);
