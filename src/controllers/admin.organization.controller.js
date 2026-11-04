import { asyncHandler } from '../middleware/asyncHandler.js';
import { Organization } from '../models/Organization.js';
import { PlanDefinition } from '../models/PlanDefinition.js';
import { AppError } from '../utils/AppError.js';
import { recordAction } from '../services/audit.service.js';

export const list = asyncHandler(async (req, res) => {
  const page = req.query.page ?? 1;
  const limit = req.query.limit ?? 20;
  const skip = (page - 1) * limit;
  const orgs = await Organization.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select('name slug status contactEmail timezone createdAt')
    .lean();
  const total = await Organization.countDocuments();
  res.json({ orgs, page, limit, total });
});

export const get = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.params.organizationId)
    .select('name slug status contactEmail timezone')
    .lean();
  if (!org) throw new AppError(404, 'NOT_FOUND', 'Organization not found.');
  res.json({ org });
});

export const suspend = asyncHandler(async (req, res) => {
  const org = await Organization.findByIdAndUpdate(
    req.params.organizationId,
    { status: 'suspended' },
    { new: true, runValidators: true },
  ).lean();
  if (!org) throw new AppError(404, 'NOT_FOUND', 'Organization not found.');
  await recordAction({
    actorId: req.user._id, action: 'ORG_SUSPEND', targetId: org._id, targetType: 'Organization',
    metadata: { reason: req.body.reason }, req,
  });
  res.json({ org });
});

export const reinstate = asyncHandler(async (req, res) => {
  const org = await Organization.findByIdAndUpdate(
    req.params.organizationId,
    { status: 'active' },
    { new: true, runValidators: true },
  ).lean();
  if (!org) throw new AppError(404, 'NOT_FOUND', 'Organization not found.');
  await recordAction({
    actorId: req.user._id, action: 'ORG_REINSTATE', targetId: org._id, targetType: 'Organization',
    metadata: { reason: req.body.reason }, req,
  });
  res.json({ org });
});

export const editPlan = asyncHandler(async (req, res) => {
  const { organizationId } = req.params;
  const { key, priceMinor, available } = req.body;
  const org = await Organization.findById(organizationId).lean();
  if (!org) throw new AppError(404, 'NOT_FOUND', 'Organization not found.');
  const planDef = await PlanDefinition.findOne({ key }).lean();
  if (!planDef) throw new AppError(400, 'PLAN_UNAVAILABLE', `Plan "${key}" is not defined.`);
  await Organization.findOneAndUpdate(
    { _id: organizationId },
    { $set: { 'planEditPending': { key, priceMinor, available, updatedAt: Date.now() } } },
    { new: true, runValidators: true },
  );
  await recordAction({
    actorId: req.user._id, action: 'PLAN_EDIT', targetId: org._id, targetType: 'Organization',
    metadata: { planKey: key, priceMinor }, req,
  });
  res.json({ org, planDef });
});