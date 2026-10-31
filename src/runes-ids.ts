// Rune ids as a const object — typo-proof keys shared by the effect module,
// the scene's applyRune switch, and config's content table.
export const RuneId = {
  emberChains: 'emberChains',
  focusLens: 'focusLens',
  slowBurn: 'slowBurn',
  volatile: 'volatile',
  overcharge: 'overcharge',
  greed: 'greed',
  sturdy: 'sturdy',
  swift: 'swift',
  farsight: 'farsight',
  coldHeart: 'coldHeart',
  fortune: 'fortune',
  quickspark: 'quickspark',
  wideLens: 'wideLens',
  powderKeg: 'powderKeg',
  deepRoots: 'deepRoots',
  oldGrowth: 'oldGrowth',
} as const;

export type RuneId = (typeof RuneId)[keyof typeof RuneId];
