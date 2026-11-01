import './style.css';
import { App } from './app';

const app = new App();
// Handy for poking at the simulation from the browser console.
(window as unknown as { astrarium: App }).astrarium = app;
