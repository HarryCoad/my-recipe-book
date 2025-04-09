import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss';
import hpp from 'hpp';
import AppError from '@utils/appError';
import globalErrorHandler from '@controllers/errorControllers';
import sanitiseObject from '@utils/sanitiseObject';
import userRouter from '@routes/userRoutes';
import recipeRouter from '@routes/recipeRoutes';
import { transformIdMiddleware } from 'middlewares/transformIdMiddleware';

dotenv.config();

dotenv.config({ path: './config.env' });

const app: Express = express();

// Global middleware
// Set securuty HTTP headers
app.use(helmet());

// Development logging
if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));

// Limit requests from same IP
const limiter = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 100,
  message: 'Too many requests from IP, please try again in an hour',
});
app.use('/api', limiter);

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' }));

app.use(transformIdMiddleware);

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use((req: Request, res: Response, next) => {
  // Sanitize req.body
  if (req.body) {
    req.body = sanitiseObject(req.body);
  }
  // Sanitize req.query
  if (req.query) {
    req.query = sanitiseObject(req.query);
  }
  // Sanitize req.params
  if (req.params) {
    req.params = sanitiseObject(req.params);
  }

  next();
});

// Prevent parameter pollution
app.use(
  hpp({
    whitelist: ['exmaple'],
  }),
);

// Serving static files
app.use(express.static(`${__dirname}/public`));

// Test middleware
app.use((req, res, next) => {
  next();
});

app.get('/', (req: Request, res: Response) => {
  res.send('Express + TypeScript Server');
});

app.use('/api/v1/users', userRouter);
app.use('/api/v1/recipes', recipeRouter);
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

// By giving 4 params express recognises it as an error handling middleware
app.use(globalErrorHandler);

export default app;
