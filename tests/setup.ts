// Runs before every test file
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';

// Test-only settings, so tests don't depend on config.env
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

let mongod: MongoMemoryServer;

// Each test file gets its own throwaway database
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Wait for indexes (e.g. unique usernames) to be built before any test runs
  await Promise.all(
    mongoose.modelNames().map((name) => mongoose.model(name).init()),
  );
});

// Start every test with an empty database so tests can't affect each other
beforeEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
