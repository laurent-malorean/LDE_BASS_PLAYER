export const NS = 'http://www.w3.org/2000/svg';
export function el(nom, attrs = {}, enfants = []) {
  const n = document.createElementNS(NS, nom);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  for (const c of [].concat(enfants)) n.append(c);
  return n;
}
export const texte = (x, y, s, attrs = {}) => el('text', { x, y, ...attrs }, [document.createTextNode(s)]);
