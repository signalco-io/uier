'use client';

import { useActionState, useId, useState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/src/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Textarea } from '@/src/components/ui/textarea';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '../FormMessage';
import type { DbTeam } from '@/src/lib/app/model';
import { MAX_TEAM_NAME_LENGTH, MAX_TEAM_DESCRIPTION_LENGTH } from '@/src/lib/app/limits';
import { KnownPageLinks } from '@/src/knownPages';
import { saveTeamAction } from './actions';

export function TeamEditor({ team }: { team?: DbTeam }) {
    const id = useId();
    const [state, action, pending] = useActionState(saveTeamAction, null);
    const [name, setName] = useState(team?.name ?? ''),
        [description, setDescription] = useState(team?.description ?? '');
    return (
        <Dialog>
            <DialogTrigger render={<Button variant={team ? 'outline' : 'default'} />}>{team ? 'Edit team' : 'Create team'}</DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{team ? 'Edit team' : 'Create team'}</DialogTitle>
                    <DialogDescription>
                        Teams share selected projects with a group. New teams start empty.
                    </DialogDescription>
                </DialogHeader>
                <form action={action} className="flex flex-col gap-4">
                    {team && <input type="hidden" name="id" value={team.id} />}
                    <FieldGroup>
                        <Field>
                            <FieldLabel htmlFor={`${id}-name`}>Team name</FieldLabel>
                            <Input
                                id={`${id}-name`}
                                name="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                maxLength={MAX_TEAM_NAME_LENGTH}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
                            <Textarea
                                id={`${id}-description`}
                                name="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                maxLength={MAX_TEAM_DESCRIPTION_LENGTH}
                            />
                        </Field>
                    </FieldGroup>
                    <FormMessage state={state} />
                    {state?.ok && (
                        <Link href={KnownPageLinks.team(state.data)} className={buttonVariants()}>Open team</Link>
                    )}
                    <DialogFooter>
                        <Button disabled={pending} type="submit">
                            {pending && <Spinner />}Save team
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
