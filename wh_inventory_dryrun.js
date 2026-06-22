// wh_inventory_dryrun.js  —  READ-ONLY. Makes no writes.
// Inventories current Warehouse data before the redesign.
// Run on Render shell:  node wh_inventory_dryrun.js
const mongoose = require('mongoose');
const URI = process.env.MONGO_URI_NEW || process.env.MONGO_URI;

const EXISTING_BUCKETS = [
  'Order Processing', 'Inbound', 'Outbound', 'Sorting', 'Palletizing',
  'Pallet Fee', 'Storage', 'Label', 'Cross Dock'
];
// New field names that should NOT exist yet (sanity check for collisions)
const NEW_SAMPLE_FIELDS = [
  'Inbound Floor Load', 'Inbound Palletized', 'OW Handling Fee', 'Handling Out',
  'Storage Pallet Stackable', 'Selected Supplier', 'Supplier 1 Name',
  'WH Cost Total', 'WH Price Total', 'ETA', '# of Containers', 'Service Types',
  'Order Processing Cost S1'
];
const NON_EMPTY = v => v !== undefined && v !== null && String(v).trim() !== '';

(async () => {
  if (!URI) { console.error('No MONGO_URI / MONGO_URI_NEW in env'); process.exit(1); }
  await mongoose.connect(URI);
  const Inquiry = mongoose.model('Inquiry', new mongoose.Schema({}, { strict: false }), 'inquiries');

  const total = await Inquiry.countDocuments();
  const docs = await Inquiry.find({}).lean();
  console.log('=== READ-ONLY WH inventory ===');
  console.log('Total docs:', total, '\n');

  // 1) how many docs have a value in each existing bucket (cost / price / unit)
  console.log('--- existing buckets: docs with a non-empty value ---');
  for (const b of EXISTING_BUCKETS) {
    const cost  = docs.filter(d => NON_EMPTY(d[b])).length;
    const price = docs.filter(d => NON_EMPTY(d[b + ' Price'])).length;
    const unit  = docs.filter(d => NON_EMPTY(d[b + ' Unit'])).length;
    console.log(
      (b + ':').padEnd(20),
      'cost=' + String(cost).padStart(4),
      'price=' + String(price).padStart(4),
      'unit=' + String(unit).padStart(4)
    );
  }

  // 2) distinct Storage Unit values actually stored
  const storageUnits = {};
  docs.forEach(d => {
    const u = (d['Storage Unit'] === undefined || d['Storage Unit'] === null)
      ? '(missing)' : String(d['Storage Unit']);
    storageUnits[u] = (storageUnits[u] || 0) + 1;
  });
  console.log('\n--- distinct "Storage Unit" values ---');
  console.log(storageUnits);

  // 3) docs that already have ANY warehouse cost value (= will need the modal)
  const withAnyWh = docs.filter(d => EXISTING_BUCKETS.some(b => NON_EMPTY(d[b]))).length;
  console.log('\nDocs with at least one WH cost value:', withAnyWh);

  // 4) collision check: do any of the planned NEW field names already exist anywhere?
  console.log('\n--- collision check: planned NEW fields already present? ---');
  let anyCollision = false;
  for (const f of NEW_SAMPLE_FIELDS) {
    const n = docs.filter(d => Object.prototype.hasOwnProperty.call(d, f)).length;
    if (n > 0) { anyCollision = true; console.log('  ⚠ ' + f + ' already present in ' + n + ' docs'); }
  }
  if (!anyCollision) console.log('  none — clean, all new field names are free.');

  // 5) sample one doc that has WH data, show its WH-related keys (names only, no values)
  const sample = docs.find(d => EXISTING_BUCKETS.some(b => NON_EMPTY(d[b])));
  if (sample) {
    const whKeys = Object.keys(sample).filter(k =>
      EXISTING_BUCKETS.some(b => k === b || k.startsWith(b + ' ')) ||
      k.toLowerCase().includes('warehouse') || k.startsWith('WH '));
    console.log('\n--- sample doc WH-related keys (' + (sample['Quotation #'] || '?') + ') ---');
    console.log(whKeys.join(', '));
  }

  await mongoose.disconnect();
  console.log('\n=== done (read-only, nothing written) ===');
})().catch(e => { console.error(e); process.exit(1); });
