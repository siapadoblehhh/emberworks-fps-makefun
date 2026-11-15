// The look plan, in one place. Night shift at a foundry yard: a cold blue
// moonlit sky, slate and rusted steel, one molten-orange accent for the
// attackers, one pale teal for the defenders. The same names are the CSS
// custom properties in index.html, so the HUD and the 3D scene agree.
export const PALETTE = {
  canvas: '#0e1622',
  surface: '#232c38',
  hairline: '#46545f',
  ink: '#f2ede2',
  muted: '#8fa0ae',
  accent: '#ff8c1a',
  attacker: '#ffb020',
  defender: '#2fd4c0',
  danger: '#e5484d',
  money: '#7fce62',
};

export function tint(name) {
  return PALETTE[name];
}
