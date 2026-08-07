import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import * as verification from '../controllers/verification.controller.js';

const router = Router();

const storage = multer.diskStorage({
  destination: 'src/uploads/receipts/',
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'receipt-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only image files (JPG, PNG) are allowed.'));
  }
});

router.use(authenticate);

// Student routes
router.post('/submit', upload.single('receipt'), verification.submitRequest);
router.get('/my-status', verification.getMyRequest);

// Admin routes
router.get('/queue', authorize('admin'), verification.getQueue);
router.patch('/:id/process', authorize('admin'), verification.processRequest);

export default router;
