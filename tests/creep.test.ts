import { describe, expect, it } from 'vitest';
import { PRINT_LIMITS } from '../src/book/book';
import { SPINE_WARN_MM, bindingFromReadings, coverMarginAt, creepResult, innermostSpineMargin, marginAt, predictedMargins } from '../src/book/creep';
import { DEFAULT_PRINT, FOLD_X_MM, checkPrintSettings, impose, pageOrigin, TRIM_ZONE_MM } from '../src/book/impose';
import { GRID_X_MM, PAGE_W_MM } from '../src/format/types';

const printed = { creep: 0.14, foreEdgeShift: 0, coverShift: 0, target: 3.5 };
const owner = { cover: 5.7, outermost: 5.5, innermost: 3.6 };

describe('the creep test’s readings', () => {
  it('turns the owner’s readings into the settings worked out by hand', () => {
    const r = creepResult(printed, 13, owner);
    expect(r.creep).toBeCloseTo(0.2983, 4);
    expect(r.foreEdgeShift).toBeCloseTo(2.0, 9);
    expect(r.coverShift).toBeCloseTo(2.2, 9);
  });

  it('a margin bigger than the target moves the content toward the fore-edge: a bigger shift', () => {
    expect(creepResult(printed, 13, { cover: 3.5, outermost: 4.0, innermost: 4.0 }).foreEdgeShift).toBeCloseTo(0.5, 9);
    expect(creepResult(printed, 13, { cover: 3.5, outermost: 3.0, innermost: 3.0 }).foreEdgeShift).toBeCloseTo(-0.5, 9);
    expect(creepResult(printed, 13, { cover: 4.1, outermost: 3.5, innermost: 3.5 }).coverShift).toBeCloseTo(0.6, 9);
    expect(creepResult(printed, 13, { cover: 3.0, outermost: 3.5, innermost: 3.5 }).coverShift).toBeCloseTo(-0.5, 9);
  });

  it('an innermost sheet with a bigger margin than the outermost was moved in too far: less creep; a smaller one, more', () => {
    expect(creepResult(printed, 13, { cover: 3.5, outermost: 3.5, innermost: 3.62 }).creep).toBeCloseTo(0.13, 9);
    expect(creepResult(printed, 13, { cover: 3.5, outermost: 3.5, innermost: 3.38 }).creep).toBeCloseTo(0.15, 9);
    expect(creepResult(printed, 13, { cover: 3.5, outermost: 3.5, innermost: 3.5 }).creep).toBeCloseTo(0.14, 9);
  });

  it('starts from the values the test was PRINTED with, not whatever is set now', () => {
    const was = { creep: 0.2, foreEdgeShift: 1, coverShift: 1.5, target: 3.5 };
    const r = creepResult(was, 13, { cover: 4.5, outermost: 4.5, innermost: 4.5 });
    expect(r.creep).toBeCloseTo(0.2, 9);
    expect(r.foreEdgeShift).toBeCloseTo(2, 9);
    expect(r.coverShift).toBeCloseTo(2.5, 9);
    // the same readings from a test printed with nothing give other answers
    expect(creepResult(printed, 13, { cover: 4.5, outermost: 4.5, innermost: 4.5 }).foreEdgeShift).toBeCloseTo(1, 9);
  });

  it('leaves the cover shift alone without a cover reading', () => {
    expect(creepResult({ ...printed, coverShift: 1.2 }, 13, { ...owner, cover: null }).coverShift).toBe(1.2);
  });

  it('predicts every margin to be the target, from any binding', () => {
    for (const [A, g] of [[5.5, 0.30], [4.2, 0.12], [3.9, 0.2]]) {
      const sheets = 13, was = { creep: 0.14, foreEdgeShift: 0.5, coverShift: 0.7, target: 3.5 };
      const read = { cover: coverMarginAt(0.7, A + 0.2), outermost: marginAt(0, was.creep, was.foreEdgeShift, { A, g }), innermost: marginAt(sheets - 1, was.creep, was.foreEdgeShift, { A, g }) };
      const next = creepResult(was, sheets, read);
      expect(next.creep).toBeCloseTo(g, 9);
      const m = predictedMargins(was, sheets, read, next);
      for (const v of [m.cover!, m.outermost, m.innermost]) expect(v).toBeCloseTo(3.5, 9);
      expect(bindingFromReadings(was, sheets, read).A).toBeCloseTo(A, 9);
    }
  });

  it('predicts a different margin where the settings were held back from the answer', () => {
    const m = predictedMargins(printed, 13, owner, { creep: 0.2983, foreEdgeShift: 1, coverShift: 2.2 });
    expect(m.outermost).toBeCloseTo(4.5, 9);
    expect(m.cover).toBeCloseTo(3.5, 9);
  });

  it('gives the innermost page’s spine-side margin on the paper', () => {
    expect(innermostSpineMargin(13, { creep: 0.3, foreEdgeShift: 2, coverShift: 2.2 })).toBeCloseTo(GRID_X_MM - (12 * 0.3 - 2), 9);
    expect(innermostSpineMargin(13, { creep: 0.3, foreEdgeShift: 2, coverShift: 2.2 })).toBeGreaterThan(SPINE_WARN_MM);
    expect(innermostSpineMargin(13, { creep: 0.3, foreEdgeShift: 0, coverShift: 0 })).toBeLessThan(SPINE_WARN_MM);
  });
});

describe('the fore-edge shifts, in the imposition and the files', () => {
  it('a shift moves a left page left and a right page right; creep moves them toward the fold', () => {
    const l = pageOrigin(false, 1, 2), r = pageOrigin(true, 1, 2);
    expect(l.x).toBeCloseTo(TRIM_ZONE_MM + 1 - 2, 9);
    expect(r.x).toBeCloseTo(FOLD_X_MM - 1 + 2, 9);
    expect(pageOrigin(false, 0, 2).x).toBeCloseTo(TRIM_ZONE_MM - 2, 9);
    expect(pageOrigin(true, 0, 2).x).toBeCloseTo(FOLD_X_MM + 2, 9);
    expect(pageOrigin(true, 0).x).toBe(FOLD_X_MM);
  });

  it('sheet k’s content is k × creep − shift toward the fold, on the sheet and in the margin read from the fold', () => {
    const s = { ...DEFAULT_PRINT, creep_per_sheet_mm: 0.3, fore_edge_shift_mm: 2 };
    const [sig] = impose(52, s);
    for (const k of [0, 6, 12]) {
      const toward = sig.sheets[k].creep - s.fore_edge_shift_mm;
      expect(pageOrigin(true, sig.sheets[k].creep, s.fore_edge_shift_mm).x + GRID_X_MM).toBeCloseTo(FOLD_X_MM + GRID_X_MM - toward, 9);
    }
  });
});

describe('checkPrintSettings with the shifts', () => {
  const S = { ...DEFAULT_PRINT };
  it('accepts the owner’s defaults on 13 sheets', () => {
    expect(checkPrintSettings(S, 13)).toBeNull();
    expect(checkPrintSettings(S, 5)).toBeNull();
  });
  it('refuses content that would cross the fold on the innermost sheet, with the reason', () => {
    expect(checkPrintSettings({ ...S, creep_per_sheet_mm: 0.35, fore_edge_shift_mm: 0 }, 13)).toMatch(/sheet 13.*past the fold/);
    expect(checkPrintSettings({ ...S, creep_per_sheet_mm: 0.5 }, 13)).toMatch(/past the fold/);
  });
  it('a bigger fore-edge shift gives it room back', () => {
    expect(checkPrintSettings({ ...S, creep_per_sheet_mm: 0.4, fore_edge_shift_mm: 0 }, 13)).toMatch(/past the fold/);
    expect(checkPrintSettings({ ...S, creep_per_sheet_mm: 0.4, fore_edge_shift_mm: 2 }, 13)).toBeNull();
  });
  it('refuses a cover shift that would push the cover past the fold', () => {
    expect(checkPrintSettings({ ...S, cover_fore_edge_shift_mm: -4 }, 13)).toMatch(/the cover.*past the fold/);
  });
  it('refuses a shift that would push content off the paper at the fore-edge', () => {
    // the content box's outer edge is PAGE_W − GRID_X from the fold; the sheet ends FOLD_X from it
    const room = FOLD_X_MM - (PAGE_W_MM - GRID_X_MM);
    expect(checkPrintSettings({ ...S, fore_edge_shift_mm: room + 1 }, 13)).toMatch(/off the paper/);
    expect(checkPrintSettings({ ...S, cover_fore_edge_shift_mm: room + 1 }, 13)).toMatch(/the cover.*off the paper/);
    expect(checkPrintSettings({ ...S, fore_edge_shift_mm: room - 0.1 }, 1)).toBeNull();
  });
  it('refuses settings that are not numbers', () => {
    expect(checkPrintSettings({ ...S, fore_edge_shift_mm: NaN }, 13)).toMatch(/numbers/);
    expect(checkPrintSettings({ ...S, target_fore_edge_margin_mm: NaN }, 13)).toMatch(/numbers/);
  });
  it('has limits for each new setting, and the defaults are inside them', () => {
    for (const key of ['fore_edge_shift_mm', 'cover_fore_edge_shift_mm', 'target_fore_edge_margin_mm'] as const) {
      expect(PRINT_LIMITS[key].min).toBeLessThan(PRINT_LIMITS[key].max);
      expect(DEFAULT_PRINT[key]).toBeGreaterThanOrEqual(PRINT_LIMITS[key].min);
      expect(DEFAULT_PRINT[key]).toBeLessThanOrEqual(PRINT_LIMITS[key].max);
    }
  });
});

describe('the owner’s calibration as the defaults', () => {
  it('is locked in', () => {
    expect(DEFAULT_PRINT.layouts.half_letter.hand.inside).toEqual({ front_offset_x_mm: 1.7, front_offset_y_mm: -0.05, back_offset_x_mm: 1.5, back_offset_y_mm: 0.05, scale_x_pct: 100, scale_y_pct: 100, back_rotation_deg: 0, line_weight_x_pct: 100 });
    expect(DEFAULT_PRINT).toMatchObject({
      shade_light_pct: 6.3, shade_medium_pct: 13.7, shade_dark_pct: 25.9, gray_text_pct: 49.8,
      creep_per_sheet_mm: 0.3, fore_edge_shift_mm: 2.0, cover_fore_edge_shift_mm: 2.2, target_fore_edge_margin_mm: 3.5,
    });
  });
});
