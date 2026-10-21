// Chemins, config et variables d'environnement partagés par les scripts.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

// En local on lit .env ; sur GitHub Actions les variables viennent des secrets.
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// trim() : un espace ou retour à la ligne collé avec un secret le rend invalide.
export const env = (name) => process.env[name]?.trim() || '';
