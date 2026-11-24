// Génération de motifs mélodiques (utilisé quand une piste mélodique apparaît sans que le
// joueur ait encore composé). Les hauteurs sont des indices de tons de l'accord
// (voir CHORD_TONES) : le motif suit l'harmonie quelle que soit la tonalité.

const pickWeighted = (rng, table) => rng.weighted(table.map(([v, weight]) => ({ v, weight }))).v;

/**
 * Mélodie : marche aléatoire par petits intervalles (conjoints) avec quelques sauts,
 * qui commence et retombe sur des notes stables (fondamentale, tierce, quinte).
 * @returns {number[]} indices 0..7, un par pas fourni
 */
export function leadMotif(rng, steps) {
  const out = [];
  let p = pickWeighted(rng, [[0, 2], [1, 2], [2, 3], [4, 1]]);
  steps.forEach((s, i) => {
    if (i > 0) {
      const move = pickWeighted(rng, [[0, 1.5], [1, 3], [-1, 3], [2, 1.2], [-2, 1.2], [3, 0.4]]);
      p += move;
      if (p < 0) p = -p;
      if (p > 6) p = 12 - p;
    }
    // le premier temps de la mesure appelle une note stable
    if (s === 0 && ![0, 1, 2, 4].includes(p)) p = 2;
    out.push(p);
  });
  // résolution : la dernière note retombe sur un ton stable
  if (out.length > 1 && ![0, 2, 4].includes(out[out.length - 1])) out[out.length - 1] = rng.pick([0, 2, 4]);
  return out;
}

/** Basse : fondamentale sur le « 1 », puis quinte / octave / tierce. */
export function bassMotif(rng, steps) {
  return steps.map((s) => (s === 0 ? 0 : pickWeighted(rng, [[0, 4], [2, 3], [4, 2], [1, 1], [3, 0.6]])));
}
