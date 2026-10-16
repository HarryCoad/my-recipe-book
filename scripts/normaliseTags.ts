/* eslint-disable no-console */
/**
 * One-off clean up of tags saved before they were normalised.
 *
 * Dry run (shows what would change, writes nothing):
 *   npx ts-node -r tsconfig-paths/register scripts/normaliseTags.ts
 * Apply the changes:
 *   npx ts-node -r tsconfig-paths/register scripts/normaliseTags.ts --apply
 */
import dns from 'dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { normaliseTags } from '../utils/tagUtils';

// Node is picking up 127.0.0.1 as its DNS server on this machine, which breaks mongodb+srv lookups
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config({ path: './config.env' });

const bApply = process.argv.includes('--apply');

/** Normalise the tags on every document in a collection that has any */
const normaliseCollection = async (name: string) => {
  const collection = mongoose.connection.collection(name);
  // Raw collection access, so soft deleted recipes are cleaned up too
  const docs = await collection
    .find({ tags: { $exists: true, $ne: null } })
    .project({ tags: 1 })
    .toArray();

  let changed = 0;
  for (const doc of docs) {
    const cleaned = normaliseTags(doc.tags as string[]);
    if (JSON.stringify(cleaned) === JSON.stringify(doc.tags)) continue;

    changed += 1;
    console.log(`${name} ${doc._id}: ${JSON.stringify(doc.tags)} -> ${JSON.stringify(cleaned)}`);
    if (bApply) {
      await collection.updateOne({ _id: doc._id }, { $set: { tags: cleaned } });
    }
  }
  console.log(`${name}: ${changed} of ${docs.length} documents ${bApply ? 'updated' : 'would change'}\n`);
};

(async () => {
  const DB = (process.env.DATABASE ?? '').replace(
    '<PASSWORD>',
    process.env.DATABASE_PASSWORD ?? '',
  );
  await mongoose.connect(DB);
  console.log(bApply ? 'Applying changes\n' : 'Dry run, nothing will be written (pass --apply to write)\n');

  await normaliseCollection('recipes');
  await normaliseCollection('edits');

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
