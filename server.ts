/* eslint-disable no-console */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import app from './app';

process.on('uncaughtException', (err: Error) => {
  console.log('-------------uncaughtException: start------------------');
  console.log('Name: ', err.name);
  console.log('Message: ', err.message);
  console.log('-------------uncaughtException: end------------------');
  process.exit(1);
});

dotenv.config({ path: './config.env' });

const DB = process.env.DATABASE?.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD || '',
);

if (DB) {
  mongoose.connect(DB, {}).then(() => console.log('Db connection successful'));
} else {
  console.error('Database connection string is undefined.');
  process.exit(1);
}

// Start Server
const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`App running on port ${port}...`);
});

process.on('unhandledRejection', (err: any) => {
  console.log('-------------unhandledRejection: start------------------');
  console.log('Name: ', err.name);
  console.log('Message: ', err.message);
  console.log('-------------unhandledRejection: end------------------');
  server.close(() => {
    process.exit(1);
  });
});
