/* eslint-disable no-console */
/**
 * One-off move of saves onto Recipe.savedBy only. Each savedBy entry changes
 * from a user ID to { userId, savedAt }, and User.savedRecipes is removed.
 *
 * savedAt comes from the user's old savedRecipes entry, whose _id was created
 * when they saved it, so their save order is kept. Saves missing from that
 * list (e.g. authors' own recipes, which were never added to it) use the
 * recipe's creation time instead.
 *
 * Dry run (shows what would change, writes nothing):
 *   npx ts-node -r tsconfig-paths/register scripts/migrateSavedBy.ts
 * Apply the changes:
 *   npx ts-node -r tsconfig-paths/register scripts/migrateSavedBy.ts --apply
 */
import dns from 'dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Node is picking up 127.0.0.1 as its DNS server on this machine, which breaks mongodb+srv lookups
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config({ path: './config.env' });

// The driver's ObjectId, which raw collection reads return
const { ObjectId } = mongoose.mongo;

const bApply = process.argv.includes('--apply');

(async () => {
  const DB = (process.env.DATABASE ?? '').replace(
    '<PASSWORD>',
    process.env.DATABASE_PASSWORD ?? '',
  );
  await mongoose.connect(DB);
  console.log(
    bApply
      ? 'Applying changes\n'
      : 'Dry run, nothing will be written (pass --apply to write)\n',
  );

  // Raw collection access, so inactive users and soft deleted recipes are included
  const users = mongoose.connection.collection('users');
  const recipes = mongoose.connection.collection('recipes');

  // 1) When each user saved each recipe, from their old list
  const savedAtByPair = new Map<string, Date>();
  const userDocs = await users
    .find({ savedRecipes: { $exists: true } })
    .project({ savedRecipes: 1 })
    .toArray();
  for (const user of userDocs) {
    for (const saved of user.savedRecipes ?? []) {
      // Entries added by hand may have no _id
      if (saved._id instanceof ObjectId) {
        savedAtByPair.set(
          `${user._id}:${saved.recipeId}`,
          saved._id.getTimestamp(),
        );
      }
    }
  }

  // 2) Convert each recipe's savedBy. Already converted entries are left alone,
  // so the script can be run again safely
  const recipeDocs = await recipes.find({}).project({ savedBy: 1 }).toArray();
  let converted = 0;
  let fromRecipeTime = 0;
  for (const recipe of recipeDocs) {
    const savedBy: unknown[] = recipe.savedBy ?? [];
    if (!savedBy.some((entry) => entry instanceof ObjectId)) continue;

    const newSavedBy = savedBy.map((entry) => {
      if (!(entry instanceof ObjectId)) return entry;

      let savedAt = savedAtByPair.get(`${entry}:${recipe._id}`);
      if (!savedAt) {
        savedAt = (recipe._id as InstanceType<typeof ObjectId>).getTimestamp();
        fromRecipeTime += 1;
      }
      return { userId: entry, savedAt };
    });

    converted += 1;
    console.log(`recipe ${recipe._id}: ${savedBy.length} saver(s)`);
    if (bApply) {
      await recipes.updateOne(
        { _id: recipe._id },
        { $set: { savedBy: newSavedBy } },
      );
    }
  }
  console.log(
    `recipes: ${converted} of ${recipeDocs.length} ${bApply ? 'converted' : 'would be converted'}`,
  );
  console.log(
    `${fromRecipeTime} save(s) not in the user's list used the recipe's creation time\n`,
  );

  // 3) Saves only on the user's side are reported rather than added, since
  // savedBy is what the app has been treating as saved
  for (const user of userDocs) {
    for (const saved of user.savedRecipes ?? []) {
      const recipe = recipeDocs.find(
        (r) => String(r._id) === String(saved.recipeId),
      );
      const savers: unknown[] = recipe?.savedBy ?? [];
      const bOnRecipe = savers.some(
        (entry) =>
          String(
            entry instanceof ObjectId
              ? entry
              : (entry as { userId: unknown }).userId,
          ) === String(user._id),
      );
      if (!bOnRecipe) {
        console.log(
          `not migrated: user ${user._id} listed recipe ${saved.recipeId}, which doesn't have them in savedBy`,
        );
      }
    }
  }

  // 4) Drop the old list
  console.log(
    `users: ${userDocs.length} ${bApply ? 'had' : 'would have'} savedRecipes removed`,
  );
  if (bApply) {
    await users.updateMany(
      { savedRecipes: { $exists: true } },
      { $unset: { savedRecipes: '' } },
    );
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
