import './style.css';
import { App } from './app';
import { loadSolarData } from './sim/solarSystemData';
import { loadGalacticExtras } from './sim/galacticExtras';

// Real Solar System data (JPL) is small and used by the opening scene, so fetch it first. If it
// is slow or missing, start anyway: the scenes fall back to built-in values.
// The Milky Way extras (S-stars for the Galactic Centre scene) load alongside, without waiting.
void loadGalacticExtras().catch((err: unknown) => console.warn(err));
await Promise.race([loadSolarData().catch((err: unknown) => console.warn(err)), new Promise((r) => setTimeout(r, 5000))]);

const app = new App();
// Handy for poking at the simulation from the browser console.
(window as unknown as { astrarium: App }).astrarium = app;
