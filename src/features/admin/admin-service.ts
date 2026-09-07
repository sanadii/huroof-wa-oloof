import { httpsCallable } from 'firebase/functions';
import { getOptionalFirebaseClient } from '../../lib/firebase/client';
import type { AdminSession, Category, Mutation, Page, QuestionDetail, QuestionSummary, Release, Review, RoomSummary } from './types';
export type { AdminSession } from './types';

export type AdminOperation = Mutation;

function client() {
  const configured = getOptionalFirebaseClient();
  if (!configured) throw new Error('خدمات Firebase الإدارية غير مهيأة في هذه البيئة.');
  return configured;
}
export async function adminCall<Request, Response>(name: string, data: Request): Promise<Response> {
  return (await httpsCallable<Request, Response>(client().functions, name)(data)).data;
}
export const getAdminSession = () => adminCall<Record<string, never>, AdminSession>('adminGetSession', {});
export const getAdminOverview = () => adminCall<Record<string, never>, { inventory: Record<string, number>; mutationMode: string }>('adminGetOverview', {});
export const listQuestions = (data: Record<string, unknown> = {}) => adminCall<Record<string, unknown>, Page<QuestionSummary>>('adminListQuestions', data);
export const getQuestion = (id: string) => adminCall<{ id: string }, QuestionDetail>('adminGetQuestion', { id });
export const saveQuestion = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminSaveQuestion', data);
export const validateQuestion = (id: string) => adminCall<{ id: string }, { id: string; valid: boolean; errors: string[]; state: string }>('adminValidateQuestion', { id });
export const archiveQuestion = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminArchiveQuestion', data);
export const submitQuestionReview = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminSubmitQuestionReview', data);
export const listReviews = (data: Record<string, unknown> = {}) => adminCall<Record<string, unknown>, Page<Review>>('adminListReviews', data);
export const getReview = (id: string) => adminCall<{ id: string }, Review & Record<string, unknown>>('adminGetReview', { id });
export const decideReview = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminDecideReview', data);
export const listCategories = (data: Record<string, unknown> = {}) => adminCall<Record<string, unknown>, Page<Category>>('adminListCategories', data);
export const getCategory = (id: string) => adminCall<{ id: string }, Category>('adminGetCategory', { id });
export const updateCategory = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminUpdateCategory', data);
export const listReleases = (data: Record<string, unknown> = {}) => adminCall<Record<string, unknown>, Page<Release>>('adminListReleases', data);
export const getRelease = (id: string) => adminCall<{ id: string }, Release & Record<string, unknown>>('adminGetRelease', { id });
export const releaseStage = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminStageRelease', data);
export const listRooms = (data: Record<string, unknown> = {}) => adminCall<Record<string, unknown>, Page<RoomSummary>>('adminListRooms', data);
export const getRoom = (id: string) => adminCall<{ id: string }, RoomSummary>('adminGetRoom', { id });
export const roomAction = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminRoomAction', data);
export const listAudit = (data: Record<string, unknown> = {}) => adminCall<Record<string, unknown>, Page<{ id: string; action: string; target: string; actorUid: string }>>('adminListAudit', data);
export const lookupUser = (identifier: string) => identifier.includes('@') ? adminCall<{ email: string }, Record<string, unknown>>('adminLookupUser', { email: identifier }) : adminCall<{ uid: string }, Record<string, unknown>>('adminLookupUser', { uid: identifier });
export const updateUserRole = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminUpdateUserRole', data);
export const setUserStatus = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminSetUserStatus', data);
export const revokeUserSessions = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminRevokeUserSessions', data);
export const getHealth = () => adminCall<Record<string, never>, Record<string, unknown>>('adminGetHealth', {});
export const getSettings = () => adminCall<Record<string, never>, Record<string, unknown>>('adminGetSettings', {});
export const updateSettings = (data: Record<string, unknown>) => adminCall<Record<string, unknown>, Mutation>('adminUpdateSettings', data);
