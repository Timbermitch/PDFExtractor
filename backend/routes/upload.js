import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
// Lazy load pdf-parse to avoid triggering its top-level debug harness in certain versions
let pdfParseLazy = null;
import { v4 as uuidv4 } from 'uuid'; // still used for tie-break hashing if needed

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

    // Derive a human-readable id from the original filename (without extension)
    const originalBase = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const baseSlug = originalBase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // non-alphanumerics to dashes
      .replace(/^-+|-+$/g, '')     // trim leading/trailing dashes
      .slice(0, 80) || 'document'; // safety fallback & length cap

    // Collision handling: if slug already exists in bronze, append -1, -2, etc.
    const bronzeDir = path.join(process.cwd(), 'data', 'bronze');
    await fs.promises.mkdir(bronzeDir, { recursive: true });
    let candidate = baseSlug;
    let counter = 1;
    while (true) {
      const bronzeJson = path.join(bronzeDir, `${candidate}.json`);
      if (!fs.existsSync(bronzeJson)) break;
      counter += 1;
      // After a few attempts, fall back to short hash for uniqueness
      if (counter > 50) {
        candidate = `${baseSlug}-${uuidv4().slice(0,8)}`;
        if (!fs.existsSync(path.join(bronzeDir, `${candidate}.json`))) break;
      } else {
        candidate = `${baseSlug}-${counter}`;
      }
    }
    const id = candidate;
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
