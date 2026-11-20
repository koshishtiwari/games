// Assembles games/delivery/index.html from src/*. Markers in game.js: /*__NAME__*/ -> src/<name>.js
import fs from 'fs';
const d = new URL('./src/', import.meta.url).pathname;
const rd = (f) => fs.readFileSync(d + f, 'utf8');
const three = rd('three.r162.js');
if (/<\/script/i.test(three)) throw new Error('three contains </script');
let game = rd('game.js');
for (const m of game.match(/\/\*__[A-Z0-9]+__\*\//g) || []) {
  const f = m.slice(4, -4).toLowerCase() + '.js';
  if (fs.existsSync(d + f)) game = game.replace(m, () => rd(f)); else console.log('missing module', f);
}
if (/<\/script/i.test(game)) throw new Error('game contains </script');
let html = rd('shell.html').replace('__CSS__', () => rd('style.css')).replace('__THREE__', () => three).replace('__GAME__', () => game);
const out = new URL('../../games/delivery/index.html', import.meta.url).pathname;
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB');
