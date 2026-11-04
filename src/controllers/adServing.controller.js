import { asyncHandler } from '../middleware/asyncHandler.js';
import * as serving from '../services/ads/serving.service.js';

export const serve = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await serving.serveAd(req.user, req.body));
});

export const event = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await serving.recordEvent(req.user, req.body));
});
