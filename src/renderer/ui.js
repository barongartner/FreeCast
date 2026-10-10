'use strict';
// Small DOM helpers. Dropdowns and colour pickers are built from plain
// elements on purpose: native <select> lists, colour dialogs and tooltips are
// separate OS windows, which the capture exclusion does not cover, so they
// would show up in the recording.
const UI = (() => {
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

  let openMenu = null;
  function closeMenus() {
    if (openMenu) openMenu.remove();
    openMenu = null;
  }
  document.addEventListener('click', closeMenus);
  window.addEventListener('blur', closeMenus);
  window.addEventListener('resize', closeMenus);
  document.addEventListener('wheel', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenus(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

  // options: values, or { value, label } pairs.
  function dropdown(options, value, onChange) {
    let opts = [];
    let cur = value;
    const label = h('span', {});
    const btn = h('button', { class: 'select', type: 'button' }, label, h('i', { class: 'caret' }));
    const paint = () => {
      const o = opts.find((x) => x.value === cur);
      label.textContent = o ? o.label : '';
    };
    btn.setOptions = (list) => {
      opts = list.map((o) => (o !== null && typeof o === 'object' ? o : { value: o, label: String(o) }));
      paint();
    };
    btn.set = (v) => { cur = v; paint(); };
    btn.get = () => cur;
    btn.setOptions(options);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = openMenu && openMenu.owner === btn;
      closeMenus();
      if (wasOpen) return;
      const menu = h('div', { class: 'menu drop' }, opts.map((o) =>
        h('button', { class: o.value === cur ? 'active' : '', onclick: () => { cur = o.value; paint(); onChange(cur); } }, o.label)));
      menu.owner = btn;
      document.body.append(menu);
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = menu.offsetHeight > below && above > below;
      menu.style.minWidth = r.width + 'px';
      menu.style.maxHeight = Math.max(120, up ? above : below) + 'px';
      menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
      menu.style.top = (up ? Math.max(8, r.top - Math.min(menu.offsetHeight, above) - 4) : r.bottom + 4) + 'px';
      openMenu = menu;
    });
    return btn;
  }

  const COLORS = ['#ffffff', '#000000', '#ff4a3d', '#ffb020', '#3ddc84', '#4aa8ff', '#b06cff', '#ff6ad5'];
  function swatches(value, onChange) {
    const hex = h('input', { type: 'text', class: 'hex', value, maxlength: 7, spellcheck: 'false' });
    const row = h('div', { class: 'swatches' });
    const paint = () => [...row.children].forEach((b) => b.classList.toggle('active', b.dataset.c === hex.value.toLowerCase()));
    for (const c of COLORS) {
      row.append(h('button', { class: 'swatch', 'data-c': c, style: `background:${c}`, onclick: () => { hex.value = c; paint(); onChange(c); } }));
    }
    hex.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(hex.value)) { paint(); onChange(hex.value); }
    });
    paint();
    return h('div', { class: 'color' }, row, hex);
  }

  // KeyboardEvent -> Electron accelerator, or null if the press is not a
  // usable combo yet. Letters, digits and punctuation need a modifier so a
  // binding cannot eat normal typing; function, numpad and navigation keys
  // can stand alone.
  const NAMED = {
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
    ScrollLock: 'Scrolllock', PrintScreen: 'PrintScreen',
  };
  const NEEDS_MOD = {
    Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  };
  function accelFrom(e) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
    const c = e.code;
    let key = null;
    let alone = false;
    if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
    else if (/^Digit\d$/.test(c)) key = c.slice(5);
    else if (/^F\d{1,2}$/.test(c)) { key = c; alone = true; }
    else if (/^Numpad\d$/.test(c)) { key = 'num' + c.slice(6); alone = true; }
    else if (NAMED[c]) { key = NAMED[c]; alone = true; }
    else if (NEEDS_MOD[c]) key = NEEDS_MOD[c];
    if (!key) return null;
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
    if (!mods.length && !alone) return null;
    return [...mods, key].join('+');
  }

  return { h, dropdown, swatches, accelFrom, closeMenus };
})();
