// Run with: node delete_inquiries.js
// Make sure MONGO_URI env var is set, or edit it below

const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI_NEW || process.env.MONGODB_URI || process.env.MONGO_URI;

const TO_DELETE = ['TSQT-004905', 'TSQT-004825', '007612'];

async function main() {
  if (!MONGO_URI) {
    console.error('❌ No MONGO_URI found. Set MONGO_URI_NEW, MONGODB_URI, or MONGO_URI env var.');
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('✅ Connected to MongoDB');

  const db = client.db();
  const col = db.collection('inquiries');

  for (const quote of TO_DELETE) {
    // Find main line + all sub-lines (Parent Quotation # matches)
    const query = {
      $or: [
        { 'Quotation #': quote },
        { 'Quotation #': new RegExp('^' + quote.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '[-/]') },
        { 'Parent Quotation #': quote }
      ]
    };

    // Preview first
    const docs = await col.find(query).toArray();
    if (docs.length === 0) {
      console.log(`⚠️  ${quote}: No records found`);
      continue;
    }

    console.log(`\n📋 ${quote}: Found ${docs.length} record(s) to delete:`);
    docs.forEach(d => console.log(`   - ${d['Quotation #']} | ${d['Customer ID'] || ''} | ${d['Requested By'] || ''}`));

    const result = await col.deleteMany(query);
    console.log(`✅ ${quote}: Deleted ${result.deletedCount} record(s)`);
  }

  await client.close();
  console.log('\n🎉 Done.');
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
