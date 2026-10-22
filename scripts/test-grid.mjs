import { JSDOM } from 'jsdom';
import { initGrid } from '../src/ui/grid.js';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const dom = new JSDOM(
  '<!doctype html><body><nav id="tabs"></nav><section id="filters"></section><section id="grid"></section></body>',
);
globalThis.document = dom.window.document;
globalThis.HTMLImageElement = dom.window.HTMLImageElement;

const { window } = dom;
const tabsRoot = document.querySelector('#tabs');
const filtersRoot = document.querySelector('#filters');
const gridRoot = document.querySelector('#grid');

const grid = initGrid({ tabsRoot, filtersRoot, gridRoot, saveSettlement: async () => {} });

const products = [
  { fsn: 'F1', sku: 'S1', title: 'UTHRA Nighty Floral', brand: 'UTHRA', category: 'night_dress_nighty', sizes: ['L'], mrp: 400, selling_price: 380, settlement_price: 300, stock: 5, is_shopsy: false, status: 'new', image_src: [] },
  { fsn: 'F2', sku: 'S2', title: 'UTHRA Nighty Striped', brand: 'UTHRA', category: 'night_dress_nighty', sizes: ['XL'], mrp: 500, selling_price: 450, settlement_price: 350, stock: 0, is_shopsy: false, status: 'existing', image_src: [] },
  { fsn: 'F3', sku: 'S3', title: 'KALKI Petticoat Black', brand: 'KALKI', category: 'petticoat', sizes: ['Free'], mrp: 300, selling_price: 250, settlement_price: 200, stock: 2, is_shopsy: true, status: 'new', image_src: ['https://img.fkcdn.com/x.jpeg'], image_paths: ['F3/0.jpg'] },
  { fsn: 'F4', sku: 'S4', title: 'HONEY Petticoat White', brand: 'HONEY', category: 'petticoat', sizes: ['M'], mrp: 280, selling_price: 240, settlement_price: 180, stock: 0, is_shopsy: true, status: 'inactive', image_src: [] },
  { fsn: 'F5', sku: 'S5', title: 'ROSE Nighty Cotton', brand: 'ROSE', category: 'night_dress_nighty', sizes: ['L'], mrp: 420, selling_price: 390, settlement_price: 310, stock: 9, is_shopsy: false, status: 'existing', image_src: [] },
  { fsn: 'F6', sku: 'S6', title: 'UTHRA Nightdress Silk', brand: 'UTHRA', category: 'night_dress_nighty', sizes: ['XXL'], mrp: 600, selling_price: 550, settlement_price: 400, stock: 1, is_shopsy: true, status: 'new', image_src: [] },
];

grid.update(products);

const tabCount = (tab) =>
  tabsRoot.querySelector(`button[data-tab="${tab}"] .tab-count`).textContent;
const cardCount = () => gridRoot.querySelectorAll('.card').length;
const chipCount = (container, value) =>
  filtersRoot
    .querySelector(`#${container} .chip[data-value="${value}"] .chip-count`)
    ?.textContent;

const clickTab = (tab) =>
  tabsRoot.querySelector(`button[data-tab="${tab}"]`).dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }),
  );
const clickChip = (container, value) =>
  filtersRoot
    .querySelector(`#${container} .chip[data-value="${value}"]`)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

console.log('--- initial ---');
check('6 cards', cardCount() === 6, `got ${cardCount()}`);
check('tab counts All/Flipkart/Shopsy = 6/3/3', tabCount('all') === '6' && tabCount('flipkart') === '3' && tabCount('shopsy') === '3', `${tabCount('all')}/${tabCount('flipkart')}/${tabCount('shopsy')}`);
check('brand chip counts UTHRA=3, KALKI=1', chipCount('brand-chips', 'UTHRA') === '3' && chipCount('brand-chips', 'KALKI') === '1');

console.log('\n--- Shopsy tab ---');
clickTab('shopsy');
check('3 cards', cardCount() === 3, `got ${cardCount()}`);
check('flipkart count still 3 under shopsy-tab context', tabCount('flipkart') === '3');

console.log('\n--- Shopsy + in-stock ---');
filtersRoot.querySelector('#in-stock').checked = true;
filtersRoot.querySelector('#in-stock').dispatchEvent(new window.Event('change', { bubbles: true }));
check('2 cards (F3, F6)', cardCount() === 2, `got ${cardCount()}`);

console.log('\n--- search within filters ---');
const q = filtersRoot.querySelector('#q');
q.value = 'petticoat';
q.dispatchEvent(new window.Event('input', { bubbles: true }));
check('1 card (F3)', cardCount() === 1, `got ${cardCount()}`);
q.value = '';
q.dispatchEvent(new window.Event('input', { bubbles: true }));

console.log('\n--- clear all ---');
filtersRoot.querySelector('#clear-filters').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('back to 6 cards', cardCount() === 6, `got ${cardCount()}`);
check('tab back to All', tabsRoot.querySelector('button.on').dataset.tab === 'all');

console.log('\n--- brand filter AND category filter ---');
clickChip('brand-chips', 'UTHRA');
check('3 UTHRA cards', cardCount() === 3, `got ${cardCount()}`);
clickChip('category-chips', 'petticoat');
check('UTHRA + petticoat = 0 cards', cardCount() === 0, `got ${cardCount()}`);
clickChip('brand-chips', 'UTHRA');
clickChip('category-chips', 'petticoat');
check('deselect both → 6 cards', cardCount() === 6, `got ${cardCount()}`);

console.log('\n--- search by FSN and SKU ---');
q.value = 'f5';
q.dispatchEvent(new window.Event('input', { bubbles: true }));
check('FSN search finds 1', cardCount() === 1);
q.value = 's6';
q.dispatchEvent(new window.Event('input', { bubbles: true }));
check('SKU search finds 1', cardCount() === 1);

console.log('\n--- update() resets filters ---');
grid.update(products.slice(0, 4));
check('4 cards after update', cardCount() === 4, `got ${cardCount()}`);
check('search cleared', q.value === '');
check('tab reset to all', tabsRoot.querySelector('button.on').dataset.tab === 'all');

console.log('\n--- status badges ---');
const html = gridRoot.innerHTML;
check('New badge present', html.includes('st-new'));
check('Inactive badge present', html.includes('st-inactive'));

console.log('\n--- self-hosted image preferred ---');
check('supabase image URL used when image_paths present', html.includes('/storage/v1/object/public/product-images/F3/0.jpg'));
check('mirrored image no longer uses flipkart URL', !html.includes('https://img.fkcdn.com/x.jpeg'));

console.log('\n--- settlement price editing ---');
{
  const saved = [];
  const grid2 = initGrid({
    tabsRoot,
    filtersRoot,
    gridRoot,
    saveSettlement: async (fsn, v) => saved.push([fsn, v]),
  });
  grid2.update(products);

  const settleRow = () => gridRoot.querySelector('.settle[data-fsn="F1"]');
  check('edit button present on active card', Boolean(settleRow().querySelector('.edit-settle')));
  check('no edit button on inactive card', !gridRoot.querySelector('.settle[data-fsn="F4"] .edit-settle'));

  settleRow().querySelector('.edit-settle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('input replaces value on edit', Boolean(settleRow().querySelector('.settle-input')));
  check('input starts at current value', settleRow().querySelector('.settle-input').value === '300');

  settleRow().querySelector('.cancel-settle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('cancel restores display', settleRow().textContent.includes('₹300') && !settleRow().querySelector('.settle-input'));

  settleRow().querySelector('.edit-settle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  settleRow().querySelector('.settle-input').value = '321';
  settleRow().querySelector('.save-settle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  check('save called with new value', saved.length === 1 && saved[0][0] === 'F1' && saved[0][1] === 321, JSON.stringify(saved));
  check('card shows updated value', settleRow().textContent.includes('₹321'));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL GRID CHECKS PASSED');
process.exit(failures ? 1 : 0);
