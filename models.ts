import { defineCollection } from '@vibe/db';

/** People allowed to manage the team and upload on others' behalf. */
export interface HarvestAdmin { mondayUserId: string; name: string; addedBy: string; addedAt: string }
export const harvestAdmins = defineCollection<HarvestAdmin>({ name: 'harvest_admins' });

/** A service team member's Harvest login. The token never leaves the server. */
export interface HarvestMember {
  mondayUserId: string; name: string; mondayEmail: string;
  harvestToken: string; harvestAccountId: string;
  harvestUserId: number; harvestName: string; harvestEmail: string;
  updatedBy: string; updatedAt: string;
}
export const harvestMembers = defineCollection<HarvestMember>({ name: 'harvest_members' });
