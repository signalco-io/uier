'use client';

import { PlusIcon } from 'lucide-react';
import { Autocomplete, AutocompleteContent, AutocompleteEmpty, AutocompleteInput, AutocompleteItem, AutocompleteList } from '@/src/components/ui/autocomplete';
import { Input } from '@/src/components/ui/input';
import { MAX_CLIENT_NAME_LENGTH } from '../../../lib/app/limits';

/**
 * A project's client name (`clientName`): free text that suggests the existing clients, so the same
 * input picks one or names a new one. `clients` come from the projects the person can see.
 */
export function ClientNameInput({ id, value, onValueChange, clients, className }: {
    id: string;
    value: string;
    onValueChange: (value: string) => void;
    clients: string[];
    className?: string;
}) {
    if (!clients.length) {
        return (
            <Input id={id} name="clientName" value={value} onChange={event => onValueChange(event.target.value)}
                maxLength={MAX_CLIENT_NAME_LENGTH} className={className} />
        );
    }

    return (
        <Autocomplete items={clients} value={value} onValueChange={onValueChange} openOnInputClick>
            <AutocompleteInput id={id} name="clientName" maxLength={MAX_CLIENT_NAME_LENGTH} className={className}
                placeholder="Choose a client or type a new one" triggerLabel="Show clients" />
            <AutocompleteContent>
                <AutocompleteEmpty>
                    <PlusIcon aria-hidden="true" />
                    <span className="min-w-0 truncate">New client</span>
                </AutocompleteEmpty>
                <AutocompleteList>
                    {(client: string) => <AutocompleteItem key={client} value={client}>{client}</AutocompleteItem>}
                </AutocompleteList>
            </AutocompleteContent>
        </Autocomplete>
    );
}
