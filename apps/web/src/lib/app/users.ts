import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getAppStore, updateDoc } from './store';
import { emailPk, userPk, type DbUser, type DbUserEmail } from './model';
import { MAX_NAME_LENGTH } from './limits';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.'));

export const nameSchema = z.string().trim()
    .min(1, 'Enter your name.')
    .max(MAX_NAME_LENGTH, `Use at most ${MAX_NAME_LENGTH} characters.`);

/** The part before the @, as the default display name */
function defaultName(email: string) {
    return email.split('@')[0]?.slice(0, MAX_NAME_LENGTH) || email;
}

export async function getUser(userId: string) {
    return (await getAppStore().get<DbUser>(userPk(userId), userId))?.doc ?? null;
}

export async function findUserByEmail(email: string) {
    const store = getAppStore();
    const entry = await store.get<DbUserEmail>(emailPk(email), email);
    return entry ? await getUser(entry.doc.userId) : null;
}

/** The user with this (normalized) email, created on first use */
export async function findOrCreateUser(email: string): Promise<DbUser> {
    const store = getAppStore();
    for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await store.get<DbUserEmail>(emailPk(email), email);
        if (existing) {
            const user = await getUser(existing.doc.userId);
            if (user)
                return user;
        }

        const now = new Date().toISOString();
        const user: DbUser = {
            type: 'user',
            id: `u_${nanoid()}`,
            pk: userPk(''),
            email,
            name: defaultName(email),
            createdAt: now,
            updatedAt: now
        };
        user.pk = userPk(user.id);

        // The user first, then the unique email: an orphaned user (if the second write loses a
        // race) is never found, while an email pointing to a missing user would block the address
        await store.create(user);
        if (existing) {
            // The email pointed to a user that no longer exists
            await store.delete(existing.doc.pk, existing.doc.id);
        }
        if (await store.create<DbUserEmail>({ type: 'user-email', id: email, pk: emailPk(email), userId: user.id }))
            return user;

        // Created concurrently by another request
        await store.delete(user.pk, user.id);
    }

    throw new Error('Could not create the user');
}

export async function updateUserName(userId: string, name: string) {
    return await updateDoc<DbUser>(userPk(userId), userId, user => ({ ...user, name, updatedAt: new Date().toISOString() }));
}
