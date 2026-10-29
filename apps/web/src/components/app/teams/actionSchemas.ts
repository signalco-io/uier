import { z } from 'zod';
import { projectIdSchema, userIdSchema } from '@/src/lib/app/validation';
import { MAX_BULK_PEOPLE, MAX_TEAMS_PER_MEMBER, MAX_TEAM_PROJECTS } from '@/src/lib/app/limits';

const teamId = z.string().regex(/^team_[A-Za-z0-9_-]{21}$/);
const revision = z.number().int().nonnegative();
const projectIds = z.array(projectIdSchema).max(MAX_TEAM_PROJECTS);
const teamIds = z.array(teamId).max(MAX_TEAMS_PER_MEMBER);

export const teamProjectsActionSchema = z.object({ id: teamId, projects: projectIds, revision });
export const teamStateActionSchema = z.object({
    id: teamId,
    state: z.enum(['active', 'archived', 'deleted']),
    revision
});
export const memberAccessActionSchema = z.object({
    userId: userIdSchema,
    revision,
    update: z.object({
        teamIds,
        projects: z.union([z.literal('all'), z.array(projectIdSchema)]),
        relationship: z.enum(['internal', 'external']).optional()
    })
});
export const bulkTeamsActionSchema = z.object({
    userIds: z.array(userIdSchema).min(1).max(MAX_BULK_PEOPLE),
    teamIds,
    mode: z.enum(['add', 'remove']),
    revision
});
export const removeProjectAccessActionSchema = z.object({ userId: userIdSchema, projectId: projectIdSchema, revision });
export const projectTeamActionSchema = z.object({ teamId, projectId: projectIdSchema, add: z.boolean(), revision });
export const copyTeamActionSchema = z.object({
    name: z.string().min(1).max(80),
    projectIds,
    userIds: z.array(userIdSchema).min(1).max(MAX_BULK_PEOPLE),
    revision
});
