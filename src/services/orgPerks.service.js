import { OrgExam } from '../models/OrgExam.js';
import { hasEntitlement } from './studentPlan.service.js';

/**
 * What a Student Pass (the normal TestFlow Plus plan) gives its holder inside Everybody.
 *
 * A holder's organisation may run `FREE_LIVE_CBT_LIMIT` live CBTs without the Studio plan. The
 * perk follows the organisation's owner, so it ends when the pass lapses; exams already created
 * stay readable, they just cannot be republished or added to.
 */
export const FREE_LIVE_CBT_LIMIT = 2;

/** Live exams the organisation holds, not counting archived ones or `excludeExamId`. */
const countLiveExams = (orgId, excludeExamId) =>
  OrgExam.countDocuments({
    organization: orgId,
    mode: 'live',
    status: { $ne: 'archived' },
    ...(excludeExamId ? { _id: { $ne: excludeExamId } } : {}),
  });

/** The perk's size and use for one organisation, for the console to show. */
export const liveCbtPerk = async (org) => {
  const eligible = Boolean(org?.ownerUser) && (await hasEntitlement(org.ownerUser, 'custom_cbt'));
  const used = await countLiveExams(org._id);
  return {
    eligible,
    limit: eligible ? FREE_LIVE_CBT_LIMIT : 0,
    used,
    remaining: eligible ? Math.max(0, FREE_LIVE_CBT_LIMIT - used) : 0,
  };
};

/** True when this organisation may have another live exam through the Student Pass perk. */
export const canUseLiveCbtPerk = async (org, excludeExamId) => {
  if (!org?.ownerUser) return false;
  if (!(await hasEntitlement(org.ownerUser, 'custom_cbt'))) return false;
  return (await countLiveExams(org._id, excludeExamId)) < FREE_LIVE_CBT_LIMIT;
};
