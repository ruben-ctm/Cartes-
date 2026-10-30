import { mockCometdAdapter } from './mock-cometd.js';
import { demoAppAdapter } from './demo-app.js';

export const ADAPTER_NAMES = ['mock-cometd', 'demo-app'];

/** Adaptateur par nom (celui de `meta.adapter` d'une session). */
export function getAdapter(name) {
  if (name === 'mock-cometd' || name === undefined) return mockCometdAdapter;
  if (name === 'demo-app') return demoAppAdapter;
  throw new Error(`Adaptateur inconnu : ${name} (disponibles : ${ADAPTER_NAMES.join(', ')})`);
}
