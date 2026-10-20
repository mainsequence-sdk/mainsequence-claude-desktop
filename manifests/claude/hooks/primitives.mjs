import { clean, resultText, selectPage } from './model.mjs';

/** Shared drawing helpers over the host's own elements: no custom palette, DOM or CSS. */
export const STATUS = {
  success: { glyph: '●', color: 'success' }, warning: { glyph: '◌', color: 'warning' },
  error: { glyph: '!', color: 'error' }, info: { glyph: '○', color: 'subtle' },
};
export const OPERATION_STATUS = { running: 'Running', success: 'Completed', failure: 'Failed', cancelled: 'Cancelled' };
export const OPERATION_KIND = { running: 'warning', success: 'success', failure: 'error', cancelled: 'info' };

export function primitives(ui, state, actions) {
  const { Box, Text, Button, Input, Select, Code, Markdown, Svg } = ui;
  const text = (value, props = {}) => Text({ ...props, children: [clean(value)] });
  const muted = (value, props = {}) => text(value, { dimColor: true, ...props });
  const caption = (value, props = {}) => text(value, { dimColor: true, size: 'caption', wrap: 'wrap', ...props });
  const heading = (value, props = {}) => text(value, { size: 'heading', weight: 'semibold', ...props });
  const title = (value, props = {}) => text(value, { weight: 'semibold', wrap: 'wrap', ...props });
  const status = (kind, value, props = {}) => text(`${STATUS[kind].glyph} ${value}`, { color: STATUS[kind].color, wrap: 'wrap', ...props });
  const column = (children, props = {}) => Box({ flexDirection: 'column', gap: 1, ...props, children: children.filter(Boolean) });
  const inline = (children, props = {}) => Box({ flexDirection: 'row', alignItems: 'center', gap: 1, ...props, children: children.filter(Boolean) });
  const buttons = children => Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 1, children: children.filter(Boolean) });
  const line = (label, value, kind) => Box({ flexDirection: 'row', justifyContent: 'space-between', gap: 2,
    children: [muted(label), kind ? status(kind, value) : text(value, { wrap: 'wrap' })] });
  const card = (name, children, control) => Box({ flexDirection: 'column', gap: 1, paddingX: 1, paddingY: 1, borderStyle: 'round', borderDimColor: true,
    children: [name && Box({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 1, children: [title(name), control].filter(Boolean) }), ...children].filter(Boolean) });
  const section = (name, children) => column([name && title(name), ...children]);
  /** `available: false` keeps the control visible, dimmed and inert, with the reason beneath it. */
  const button = (key, label, onPress, { primary = false, plain = false, dim = false, available = true, reason = '' } = {}) => {
    if (available) return Button({ key, label: clean(label), onPress, ...(primary ? { variant: 'primary' } : {}), ...(plain ? { plain: true } : {}), ...(dim ? { dimColor: true } : {}) });
    const control = Button({ key, label: clean(label), disabled: true, dimColor: true, plain: true, onPress: () => {} });
    return reason ? column([control, caption(reason)], { gap: 0 }) : control;
  };
  const toggle = (key, label) => Button({ key: `toggle-${key}`, label: `${state.expanded[key] ? '▾' : '▸'} ${label}`, plain: true, dimColor: true, onPress: () => actions.toggle(key) });
  const input = (key, label, placeholder = '', extra = {}) => column([label && caption(label), Input({ key: `field-${key}`, value: state.fields[key] || '', placeholder, ...extra,
    onInput: value => actions.field(key, value), onSubmit: value => actions.field(key, value) })], { gap: 0 });
  /** Pages at 63 entries: Claude refuses a pane whose Select has more than 64 options. */
  const select = (key, label, options, value, onSelect, placeholder = `Choose ${String(label || 'an option').toLowerCase()}`) => {
    const page = selectPage(options, value, state.selectPages[key]);
    if (!page.total) return null;
    const choices = page.entries.some(option => option.value === value) ? page.entries : [page.selected || { value: '', label: placeholder }, ...page.entries];
    return column([label && caption(label), Select({ key, options: choices, value: page.selected ? value : '', onSelect }),
      page.count > 1 && inline([button(`${key}-previous`, 'Previous', () => actions.selectPage(key, page.page - 1), { plain: true, available: page.page > 0 }),
        caption(`${page.start}–${page.end} of ${page.total}`),
        button(`${key}-next`, 'Next', () => actions.selectPage(key, page.page + 1), { plain: true, available: page.page + 1 < page.count })])], { gap: 0 });
  };
  /** A list row: name and metadata on the left, inline controls on the right. */
  const grow = child => Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [child] });
  const row = (key, left, right = [], props = {}) => Box({ key, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 1, paddingY: 0, ...props, children: [
    Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 0, children: left.filter(Boolean) }),
    Box({ flexDirection: 'row', flexShrink: 0, alignItems: 'center', gap: 1, children: right.filter(Boolean) }),
  ] });
  const badge = (value, kind) => text(value, { size: 'caption', ...(kind ? { color: STATUS[kind].color } : { dimColor: true }) });
  const markdown = (value, props = {}) => Markdown ? Markdown({ text: clean(value), ...props }) : text(value, { wrap: 'wrap' });
  /** An operation result: the summary coloured by outcome, partial-effect warnings, and collapsed details. */
  const result = key => {
    const value = state.results[key];
    if (!value) return null;
    const kind = value.status === 'success' ? 'success' : value.status === 'cancelled' ? 'info' : 'error';
    return column([status(kind, value.summary), value.effects && status('warning', value.effects.message),
      value.data !== undefined && toggle(`result-${key}`, 'Details'),
      state.expanded[`result-${key}`] && Code({ source: resultText(value), language: 'json', wrap: 'wrap' })], { gap: 0 });
  };
  const empty = (name, detail, controls = []) => column([title(name), detail && muted(detail), controls.length && buttons(controls)]);
  return { Box, Text, Button, Input, Select, Code, Svg, grow, text, muted, caption, heading, title, status, column, inline, buttons, line, card, section, button, toggle, input, select, row, badge, markdown, result, empty };
}
