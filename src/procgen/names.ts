import { Rng, intRange, pick } from './rng';

const START = ['Ar', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Hes', 'Ir', 'Jor', 'Kae', 'Lyr', 'Mor', 'Nel', 'Or', 'Pyr', 'Quo', 'Rhe', 'Sol', 'Tir', 'Ul', 'Vey', 'Wyr', 'Xan', 'Yl', 'Zeph'];
const MIDDLE = ['a', 'e', 'i', 'o', 'u', 'ae', 'io', 'ar', 'en', 'is', 'or', 'ul', 'yn', 'ath', 'el', 'om'];
const END = ['ra', 'nis', 'tor', 'lia', 'mon', 'rax', 'dun', 'vel', 'thys', 'cus', 'ion', 'ara', 'eth', 'ix', 'os', 'une'];
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function properName(rng: Rng): string {
  const parts = [pick(rng, START)];
  const middles = intRange(rng, 0, 1);
  for (let i = 0; i < middles; i++) parts.push(pick(rng, MIDDLE));
  parts.push(pick(rng, END));
  return capitalize(parts.join(''));
}

export function starName(rng: Rng): string {
  const r = rng();
  if (r < 0.55) return properName(rng);
  if (r < 0.8) return `${pick(rng, GREEK)} ${properName(rng)}`;
  const letters = 'ABCDEFGHJKLMNPRSTVWXYZ';
  return `${letters[intRange(rng, 0, letters.length - 1)]}${letters[intRange(rng, 0, letters.length - 1)]}-${intRange(rng, 100, 9999)}`;
}

export function galaxyName(rng: Rng): string {
  const kinds = ['Spiral', 'Expanse', 'Reach', 'Cluster', 'Veil', 'Wheel', 'Cloud'];
  return `${properName(rng)} ${pick(rng, kinds)}`;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function planetName(star: string, index: number): string {
  return `${star} ${String.fromCharCode(98 + index)}`;
}

export function moonName(planet: string, index: number): string {
  return `${planet} ${ROMAN[index] ?? index + 1}`;
}
