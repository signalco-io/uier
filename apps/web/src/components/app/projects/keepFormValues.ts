import { type FormEvent } from 'react';

/** React resets a form after its action; the fields here are controlled, so keep what they show */
export const keepValues = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
};
