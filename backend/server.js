import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import uploadRouter from './routes/upload.js';
import processRouter from './routes/process.js';
import exportRouter from './routes/export.js';
import listRouter from './routes/list.js';
import deleteRouter from './routes/deleteReport.js';
import { notFoundHandler, errorHandler } from './utils/errorHandlers.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Static serve data directories for quick inspection (read-only intent)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Serve data directory (under project root or current working dir)
app.use('/data', express.static(path.join(process.cwd(), 'data')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/upload', uploadRouter);
app.use('/process', processRouter);
app.use('/export', exportRouter);
app.use('/reports', listRouter);
app.use('/reports', deleteRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
