// Side-effect module: dashboard.jsx imports it first so the link is read and the address bar is
// cleaned before React mounts and before analytics can read the URL.
import { initShareViewFromLocation } from './store.js';

initShareViewFromLocation(window);
