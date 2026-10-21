import { artElement } from '../art/widget';
import { importSvg } from '../art/import';
import { makeWidget, type Widget } from '../widgets';
import gauge from '../../examples/half-donut-gauge.svg?raw';

/** The art that comes with Dotwork: a half-donut gauge, three tones with a needle, to place or to start from. */
export function builtinArt(): Widget[] {
  const r = importSvg(gauge);
  if (!r.ok) throw new Error(`The built-in gauge art is invalid: ${r.reason}`);
  return [makeWidget('half-donut-gauge', 'Half-donut gauge', [artElement(r.art)])];
}
