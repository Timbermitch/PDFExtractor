import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { extractText } from '../services/pdfText.js';
import { parsePdf } from '../services/pdfParsePatched.js';
import { v4 as uuidv4 } from 'uuid'; // still used for tie-break hashing if needed

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Lightweight smoke test endpoint to validate router is mounted
router.get('/smoke', (req, res) => {
  res.json({ ok: true, route: 'upload', timestamp: Date.now() });
});

router.post('/', upload.single('file'), async (req, res, next) => {
  const t0 = Date.now();
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== '.pdf') {
      return res.status(400).json({ error: 'Only PDF files are supported' });
    }
    let rawText = '';
    let pages = 0;
    const skipParse = (req.query.skipParse === '1' || req.query.skip === '1');
    if (skipParse) {
      rawText = '[skipParse smoke test placeholder text]';
      pages = 0;
      console.log('[upload] skipParse=1 applied - bypassing PDF parsing for smoke test');
    } else {
      const parseStart = Date.now();
      try {
        const parsed = await parsePdf(req.file.buffer);
        rawText = parsed.text || '';
        pages = parsed.numpages || 0;
        console.log(`[upload] pdf-parse(patched) success pages=${pages} ms=${Date.now()-parseStart}`);
      } catch (e1) {
        console.warn('[upload] pdf-parse(patched) failed, fallback to pdfjs', e1.message);
        try {
          const data = await extractText(req.file.buffer);
          rawText = data.text;
          pages = data.numpages;
          console.log(`[upload] pdfjs fallback success pages=${pages} ms=${Date.now()-parseStart}`);
        } catch (e2) {
          console.error('[upload] extraction failed both methods', e2);
          return res.status(500).json({ error: 'PDF extraction failed', detail: e2.message });
        }
      }
    }

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
      pageCount: pages,
      info: {}
    };

    const bronzeRecord = { id, rawText, metadata };
    const bronzePath = path.join(process.cwd(), 'data', 'bronze', `${id}.json`);
    await fs.promises.writeFile(bronzePath, JSON.stringify(bronzeRecord, null, 2));

    // eslint-disable-next-line no-console
  console.log(`[upload] stored bronze id=${id} size=${req.file.size} totalMs=${Date.now()-t0}`);
    res.json(bronzeRecord);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[upload] unexpected error', err);
    next(err);
  }
});

export default router;
