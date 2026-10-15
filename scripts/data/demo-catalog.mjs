// Fictional development inventory only. Prices are USD; photos are illustrative.
const pexels = (id, slug, creditName, alt) => ({
  src: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=800`,
  alt,
  creditName,
  creditUrl: `https://www.pexels.com/photo/${slug}-${id}/`,
  licenseUrl: 'https://www.pexels.com/license/',
});
const unsplash = (imageId, slug, creditName, alt) => ({
  src: `https://images.unsplash.com/${imageId}?auto=format&fit=crop&w=800&q=80`,
  alt,
  creditName,
  creditUrl: `https://unsplash.com/photos/${slug}`,
  licenseUrl: 'https://unsplash.com/license',
});

export const photos = {
  mouse: unsplash('photo-1770479592099-464241a3ad3a', 'a-black-computer-mouse-on-a-white-desk--0Wqx50_W7g', 'Krunal Lakhatariya', 'Illustrative black ergonomic computer mouse on a white desk'),
  gamingMouse: pexels(13870514, 'close-up-of-a-computer-mouse', 'Matheus Bertelli', 'Illustrative black computer mouse with an illuminated scroll wheel'),
  keyboard: unsplash('photo-1612383401597-cdfb8bdfa0d9', 'black-computer-keyboard-on-black-surface-oj7Z1ucRxcs', 'Christian Lue', 'Illustrative black keyboard with illuminated keys'),
  keyboardDesk: pexels(7265920, 'black-computer-keyboard-on-the-table', 'Lucian Petrean', 'Illustrative black wireless keyboard on an office desk'),
  headphones: pexels(3394652, 'white-headphones', 'Sound On', 'Illustrative white over-ear headphones'),
  blackHeadphones: pexels(30428610, 'black-studio-headphones-on-white-background', 'Vladislav Anchuk', 'Illustrative black studio headphones against a white background'),
  speaker: pexels(7772558, 'speaker-in-white-background', 'Caleb Oquendo', 'Illustrative compact portable speaker against a white background'),
  cable: pexels(914915, 'close-up-photo-of-white-usb-cable', 'Matthias Zomer', 'Illustrative white USB cable connector'),
  chargingCable: pexels(12997240, 'white-usb-cable-in-close-up-photography', 'Srattha Nualsate', 'Illustrative white charging cable against a white background'),
  hub: pexels(7742586, 'a-usb-hub-plugged-into-a-laptop', 'Rann Vijay', 'Illustrative USB hub connected to a laptop'),
  notebook: unsplash('photo-1477125804055-781b73bcd980', 'notebook-opened-IThpmszqH7Y', 'Dana Marin (Amsterdamian)', 'Illustrative open ruled notebook'),
  blackNotebook: pexels(31480649, 'minimalist-black-notebook-and-pen-on-white-background', 'Adrian Regeci', 'Illustrative black notebook and pen on a white background'),
  pencils: unsplash('photo-1513542789411-b6a5d4f31634', 'colored-pencil-lined-up-on-top-of-white-surface-l3N9Q27zULw', 'Jess Bailey', 'Illustrative row of colored wooden pencils'),
  pen: pexels(5594344, 'black-pen-in-close-up-shot', 'Mike Murray', 'Illustrative black pen on a geometric stand'),
  mug: pexels(12122888, 'white-ceramic-mug-in-close-up-photography', 'Irina P', 'Illustrative white ceramic mug on a wooden table'),
  bottle: pexels(7531578, 'bottle-on-top-of-a-desk', 'Furknsaglam', 'Illustrative clear water bottle on a white desk'),
};

export const profiles = [
  { key: 'supply-northstar', name: 'Maya Chen · Demo', email: 'maya.northstar@stockflow.example.test', role: 'SUPPLIER', companyName: 'Northstar Workspace · Demo', contactNumber: '+1-202-555-0101', address: 'Demo address — 100 Workspace Avenue', category: 'Electronics' },
  { key: 'supply-circuit', name: 'Arjun Mehta · Demo', email: 'arjun.circuit@stockflow.example.test', role: 'SUPPLIER', companyName: 'Circuit & Co. · Demo', contactNumber: '+1-202-555-0102', address: 'Demo address — 200 Circuit Lane', category: 'Electronics' },
  { key: 'supply-paper', name: 'Elena Ruiz · Demo', email: 'elena.paper@stockflow.example.test', role: 'SUPPLIER', companyName: 'Paper & Form · Demo', contactNumber: '+1-202-555-0103', address: 'Demo address — 300 Stationery Street', category: 'Office Supplies' },
  { key: 'supply-daylight', name: 'Jordan Brooks · Demo', email: 'jordan.daylight@stockflow.example.test', role: 'SUPPLIER', companyName: 'Daylight Office Goods · Demo', contactNumber: '+1-202-555-0104', address: 'Demo address — 400 Daylight Drive', category: 'Office Supplies' },
  { key: 'customer-avery', name: 'Avery Morgan · Demo', email: 'avery.morgan@stockflow.example.test', role: 'CUSTOMER' },
  { key: 'customer-priya', name: 'Priya Shah · Demo', email: 'priya.shah@stockflow.example.test', role: 'CUSTOMER' },
  { key: 'customer-noah', name: 'Noah Williams · Demo', email: 'noah.williams@stockflow.example.test', role: 'CUSTOMER' },
  { key: 'customer-sofia', name: 'Sofia Rossi · Demo', email: 'sofia.rossi@stockflow.example.test', role: 'CUSTOMER' },
];

// name, sku suffix, USD price, opening units, reorder threshold, photo key.
const groups = [
  ['Electronics', 'supply-northstar', [
    ['Ergonomic Wireless Mouse', 'MOUSE-01', 29.5, 120, 20, 'mouse'],
    ['Compact Travel Mouse', 'MOUSE-02', 18, 90, 15, 'mouse'],
    ['Precision Optical Mouse', 'MOUSE-03', 39.95, 75, 12, 'gamingMouse'],
    ['Rechargeable Desk Mouse', 'MOUSE-04', 34, 65, 10, 'mouse'],
    ['Mechanical Keyboard', 'KEY-01', 89, 60, 12, 'keyboard'],
    ['Compact Wireless Keyboard', 'KEY-02', 49.5, 85, 15, 'keyboardDesk'],
    ['Full Size Office Keyboard', 'KEY-03', 32, 110, 20, 'keyboardDesk'],
    ['Backlit Desktop Keyboard', 'KEY-04', 72, 48, 10, 'keyboard'],
    ['White Over Ear Headphones', 'AUDIO-01', 59.95, 70, 12, 'headphones'],
    ['Studio Monitor Headphones', 'AUDIO-02', 109, 40, 8, 'blackHeadphones'],
  ]],
  ['Electronics', 'supply-circuit', [
    ['Wireless Listening Headphones', 'AUDIO-03', 74.5, 62, 12, 'headphones'],
    ['Closed Back Audio Headphones', 'AUDIO-04', 84, 50, 10, 'blackHeadphones'],
    ['Compact Bluetooth Speaker', 'SPK-01', 39.5, 80, 15, 'speaker'],
    ['Portable Desk Speaker', 'SPK-02', 54, 55, 10, 'speaker'],
    ['Travel Audio Speaker', 'SPK-03', 44.95, 72, 12, 'speaker'],
    ['Conference Room Speaker', 'SPK-04', 69, 45, 8, 'speaker'],
    ['USB Charging Cable 1 m', 'CABLE-01', 8.5, 240, 40, 'cable'],
    ['USB Charging Cable 2 m', 'CABLE-02', 11, 180, 30, 'chargingCable'],
    ['USB Data Cable 1 m', 'CABLE-03', 9.95, 210, 35, 'cable'],
    ['Multiport USB Hub', 'HUB-01', 39.5, 90, 15, 'hub'],
  ]],
  ['Office Supplies', 'supply-paper', [
    ['Ruled Notebook A5', 'NOTE-01', 9.5, 180, 30, 'notebook'],
    ['Executive Notebook A5', 'NOTE-02', 16, 125, 25, 'blackNotebook'],
    ['Daily Notes Journal', 'NOTE-03', 12.95, 150, 25, 'notebook'],
    ['Meeting Notebook', 'NOTE-04', 14.5, 130, 20, 'blackNotebook'],
    ['Colored Pencils Set of 12', 'PENCIL-01', 8, 220, 40, 'pencils'],
    ['Colored Pencils Set of 24', 'PENCIL-02', 14, 160, 30, 'pencils'],
    ['Artist Color Pencil Set', 'PENCIL-03', 19.5, 115, 20, 'pencils'],
    ['Classroom Color Pencil Pack', 'PENCIL-04', 24, 95, 15, 'pencils'],
    ['Black Ink Ballpoint Pen', 'PEN-01', 3.5, 320, 60, 'pen'],
    ['Fine Tip Writing Pen', 'PEN-02', 5.95, 260, 45, 'pen'],
  ]],
  ['Office Supplies', 'supply-daylight', [
    ['Executive Writing Pen', 'PEN-03', 12.5, 135, 25, 'pen'],
    ['Refillable Desk Pen', 'PEN-04', 9, 170, 30, 'pen'],
    ['Classic Ceramic Mug 300 ml', 'MUG-01', 8.95, 140, 25, 'mug'],
    ['Office Coffee Mug 350 ml', 'MUG-02', 10.5, 120, 20, 'mug'],
    ['Meeting Room Mug Set of 4', 'MUG-03', 32, 70, 12, 'mug'],
    ['Breakroom Mug Set of 6', 'MUG-04', 45, 60, 10, 'mug'],
    ['Clear Desk Water Bottle 500 ml', 'BOTTLE-01', 14.95, 110, 20, 'bottle'],
    ['Clear Water Bottle 750 ml', 'BOTTLE-02', 18, 95, 15, 'bottle'],
    ['Meeting Water Bottle Set of 4', 'BOTTLE-03', 49, 65, 12, 'bottle'],
    ['Office Hydration Bottle 1 L', 'BOTTLE-04', 21.5, 85, 15, 'bottle'],
  ]],
];

export const products = groups.flatMap(([category, supplierKey, rows]) => rows.map(([name, suffix, price, quantity, lowStockThreshold, photoKey]) => ({
  name, sku: `DEMO-${suffix}`, price, quantity, lowStockThreshold, category, supplierKey, photoKey,
  description: `${name}. Fictional StockFlow demo inventory for evaluating the catalog and purchasing workflow. Price and specifications are illustrative; this item is not an offer for sale. Stock photography is representative and may differ from the described variant.`,
})));

export const originalProductPhotos = {
  'ELEC-MOUSE-001': 'mouse',
  'ELEC-KEYB-002': 'keyboard',
  'ELEC-HUB-003': 'hub',
  'OFF-NOTE-004': 'notebook',
};
