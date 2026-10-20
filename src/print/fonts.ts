// The bundled Courier Prime, fetched when a PDF is about to be made.
import regularUrl from '../fonts/CourierPrime-Regular.ttf?url';
import boldUrl from '../fonts/CourierPrime-Bold.ttf?url';
import type { FontBytes } from './export';

export async function loadFontBytes(): Promise<FontBytes> {
  const [regular, bold] = await Promise.all([regularUrl, boldUrl].map(async (u) => (await fetch(u)).arrayBuffer()));
  return { regular, bold };
}
