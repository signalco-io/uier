import { z } from 'zod';
import { appLanguages, readAppLanguage, type AppLanguage } from '../i18n/languages';
import { userPk, type DbUser } from './model';
import { updateDoc } from './store';
import { UserFacingError } from './actionErrors';

export const appLanguageSchema = z.enum(appLanguages, 'Choose a language.').nullable();

export function userAppLanguage(user: Pick<DbUser, 'appLanguage'>): AppLanguage | null {
    return readAppLanguage(user.appLanguage) ?? null;
}

/** Update only this preference through the document's etag; concurrent profile/avatar changes survive. */
export async function setUserAppLanguage(userId: string, language: unknown): Promise<AppLanguage | null> {
    const parsed = appLanguageSchema.parse(language);
    const saved = await updateDoc<DbUser>(userPk(userId), userId, user => {
        const { appLanguage: _previous, ...rest } = user;
        return { ...rest, ...(parsed ? { appLanguage: parsed } : {}), updatedAt: new Date().toISOString() };
    });
    if (!saved) throw new UserFacingError('Your account is unavailable.');
    return parsed;
}
