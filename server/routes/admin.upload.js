import { Router } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { newTableToken } from '../utils/tokens.js';

const UPLOAD_DIR = 'uploads';
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_BYTES = 5 * 1024 * 1024;

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${newTableToken()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new Error('only jpg, jpeg, png, webp allowed'));
    }
    cb(null, true);
  },
});

export function adminUploadRouter() {
  const router = Router();

  router.post('/', (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'file too large (max 5 MB)' });
        }
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'no file uploaded (field name must be "file")' });
      }
      res.status(201).json({
        path: `/uploads/${req.file.filename}`,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });
    });
  });

  return router;
}
