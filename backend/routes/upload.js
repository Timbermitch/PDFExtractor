import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
// Lazy load pdf-parse to avoid triggering its top-level debug harness in certain versions
let pdfParseLazy = null;
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (path.extname(req.file.originalname).toLowerCase() !== '.pdf') {
      return res.status(400).json({ error: 'Only PDF files are supported' });
    }

    if (!pdfParseLazy) {
      const mod = await import('pdf-parse');
      pdfParseLazy = mod.default || mod;
    }
    const data = await pdfParseLazy(req.file.buffer);
    const rawText = data.text || '';
    const id = uuidv4();
    const metadata = {
      id,
      originalName: req.file.originalname,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
      pageCount: data.numpages,
      info: data.info || {}
    };

    const bronzeRecord = { id, rawText, metadata };
  const bronzePath = path.join(process.cwd(), 'data', 'bronze', `${id}.json`);
    await fs.promises.writeFile(bronzePath, JSON.stringify(bronzeRecord, null, 2));

    res.json(bronzeRecord);
  } catch (err) {
    next(err);
  }
});

export default router;
