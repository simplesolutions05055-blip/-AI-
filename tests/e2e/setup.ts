// before every run: the test organisations go back to their saved starting state (same screens, same pictures)
import { qa } from './helpers';
export default async function () { await qa('reset'); }
