import { type AccessSnapshot } from '@/src/lib/app/accessRules';
import type { DbMember, DbProject } from '@/src/lib/app/model';
import type { MemberAccessUpdate } from '@/src/lib/app/teams';

export type AccessPerson = { member: DbMember; name: string; avatarUrl?: string };

export type AccessData = { access: AccessSnapshot; projects: DbProject[]; people: AccessPerson[]; revision: number };

export const currentUpdate = (member: DbMember): MemberAccessUpdate => ({
    projects: member.projects,
    teamIds: member.teamIds ?? [],
    relationship: member.relationship
});
