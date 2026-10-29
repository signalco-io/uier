/** A message for the person, without internals */
export class UserFacingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UserFacingError';
    }
}
