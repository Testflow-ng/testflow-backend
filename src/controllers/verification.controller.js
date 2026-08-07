import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/** Calculate MD5 hash of a file to detect duplicates */
const getFileHash = async (filePath) => {
  const fileBuffer = await fs.readFile(filePath);
  return crypto.createHash('md5').update(fileBuffer).digest('hex');
};

export const submitRequest = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError(400, 'NO_FILE', 'Please upload a receipt image.');
  }

  const studentId = req.user._id;
  const hash = await getFileHash(req.file.path);

  // Check if this EXACT receipt has been used before
  const duplicate = await VerificationRequest.findOne({ receiptHash: hash });
  if (duplicate) {
    // Delete the uploaded file since it's a scam attempt
    await fs.unlink(req.file.path);
    throw new AppError(409, 'DUPLICATE_RECEIPT', 'This receipt has already been used by another student.');
  }

  // Check if student already has a pending request
  const existing = await VerificationRequest.findOne({ student: studentId, status: 'pending' });
  if (existing) {
    await fs.unlink(req.file.path);
    throw new AppError(409, 'PENDING_REQUEST', 'You already have a verification request pending review.');
  }

  const request = await VerificationRequest.create({
    student: studentId,
    receiptImage: `/uploads/receipts/${req.file.filename}`,
    receiptHash: hash,
    transactionRef: req.body.transactionRef
  });

  res.status(201).json({ request });
});

export const getMyRequest = asyncHandler(async (req, res) => {
  const request = await VerificationRequest.findOne({ student: req.user._id }).sort({ createdAt: -1 });
  res.json({ request });
});

// Admin Controllers
export const getQueue = asyncHandler(async (req, res) => {
  const requests = await VerificationRequest.find({ status: 'pending' })
    .populate('student', 'fullName email verificationCode')
    .sort({ createdAt: 1 });
  res.json({ requests });
});

export const processRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, rejectionReason } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', 'Status must be approved or rejected.');
  }

  const request = await VerificationRequest.findById(id);
  if (!request) throw new AppError(404, 'NOT_FOUND', 'Request not found.');

  if (request.status !== 'pending') {
    throw new AppError(400, 'ALREADY_PROCESSED', 'This request has already been processed.');
  }

  request.status = status;
  request.rejectionReason = rejectionReason;
  request.processedBy = req.user._id;
  request.processedAt = new Date();
  await request.save();

  if (status === 'approved') {
    await User.findByIdAndUpdate(request.student, { isPostUtmePaid: true });
  }

  res.json({ request });
});
