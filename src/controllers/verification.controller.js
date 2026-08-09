import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { VerificationRequest } from '../models/VerificationRequest.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { uploadToImageKit } from '../utils/imagekit.js';
import * as auditService from '../services/audit.service.js';

/** Calculate MD5 hash of a file to detect duplicates */
const getFileHash = async (filePath) => {
  const fileBuffer = await fs.readFile(filePath);
  return crypto.createHash('md5').update(fileBuffer).digest('hex');
};

export const submitRequest = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError(400, 'NO_FILE', 'Please upload a receipt image.');
  }

  const { transactionRef } = req.body;
  const studentId = req.user._id;
  const hash = await getFileHash(req.file.path);

  // 1. Anti-Fraud: Check if this EXACT file has been used before (Recycled Image)
  const duplicateHash = await VerificationRequest.findOne({ receiptHash: hash });
  if (duplicateHash) {
    await fs.unlink(req.file.path).catch(() => {});
    throw new AppError(409, 'DUPLICATE_RECEIPT', 'This receipt has already been used by another student.');
  }

  // 2. Anti-Fraud: Check if this Transaction Ref has been used before (if provided)
  if (transactionRef) {
    const duplicateRef = await VerificationRequest.findOne({ transactionRef: transactionRef.trim() });
    if (duplicateRef) {
      await fs.unlink(req.file.path).catch(() => {});
      throw new AppError(409, 'DUPLICATE_REF', 'This transaction reference has already been claimed.');
    }
  }

  // Check if student already has a pending request
  const existing = await VerificationRequest.findOne({ student: studentId, status: 'pending' });
  if (existing) {
    await fs.unlink(req.file.path).catch(() => {});
    throw new AppError(409, 'PENDING_REQUEST', 'You already have a verification request pending review.');
  }

  // 3. Upload to ImageKit
  const upload = await uploadToImageKit(
    req.file.path,
    `receipt-${studentId}-${Date.now()}`,
    'receipts'
  );

  const request = await VerificationRequest.create({
    student: studentId,
    receiptImage: upload.url, // Full ImageKit URL
    receiptHash: hash,
    transactionRef: transactionRef?.trim()
  });

  await auditService.recordAction({
    actorId: studentId,
    action: 'SUBMIT_VERIFICATION',
    targetId: request._id,
    targetType: 'VerificationRequest',
    metadata: {
        fullName: req.user.fullName,
        verificationCode: req.user.verificationCode,
        transactionRef: transactionRef.trim()
    },
    req
  });

  res.status(201).json({ request });
});

export const getMyRequest = asyncHandler(async (req, res) => {
  const request = await VerificationRequest.findOne({ student: req.user._id }).sort({ createdAt: -1 });
  res.json({ request });
});

// Admin Controllers
export const getQueue = asyncHandler(async (req, res) => {
  const { status = 'pending' } = req.query;

  const filter = {};
  if (status !== 'all') {
    filter.status = status;
  }

  const requests = await VerificationRequest.find(filter)
    .populate('student', 'fullName email verificationCode')
    .sort({ createdAt: -1 });

  res.json({ requests });
});

export const processRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, rejectionReason } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', 'Status must be approved or rejected.');
  }

  const request = await VerificationRequest.findById(id).populate('student', 'fullName verificationCode');
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

  await auditService.recordAction({
    actorId: req.user._id,
    action: status === 'approved' ? 'APPROVE_VERIFICATION' : 'REJECT_VERIFICATION',
    targetId: request._id,
    targetType: 'VerificationRequest',
    metadata: {
        studentId: request.student._id,
        studentName: request.student.fullName,
        studentCode: request.student.verificationCode,
        reason: rejectionReason
    },
    req
  });

  res.json({ request });
});
