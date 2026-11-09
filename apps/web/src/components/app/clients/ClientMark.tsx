'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/src/components/ui/avatar';
import {
    BriefcaseIcon,
    Building2Icon,
    CameraIcon,
    GlobeIcon,
    GraduationCapIcon,
    HeartIcon,
    LandmarkIcon,
    LeafIcon,
    RocketIcon,
    ShoppingBagIcon,
    StoreIcon,
    UtensilsIcon,
    type LucideIcon
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import type { ClientColor, ClientIcon } from '@/src/lib/app/clientAppearance';

export const clientIconComponents: Record<ClientIcon, LucideIcon> = {
    briefcase: BriefcaseIcon,
    building: Building2Icon,
    store: StoreIcon,
    'shopping-bag': ShoppingBagIcon,
    globe: GlobeIcon,
    rocket: RocketIcon,
    heart: HeartIcon,
    leaf: LeafIcon,
    'graduation-cap': GraduationCapIcon,
    landmark: LandmarkIcon,
    utensils: UtensilsIcon,
    camera: CameraIcon
};

export const clientIconLabels: Record<ClientIcon, string> = {
    briefcase: 'Briefcase',
    building: 'Building',
    store: 'Store',
    'shopping-bag': 'Shopping bag',
    globe: 'Globe',
    rocket: 'Rocket',
    heart: 'Heart',
    leaf: 'Leaf',
    'graduation-cap': 'Graduation cap',
    landmark: 'Landmark',
    utensils: 'Utensils',
    camera: 'Camera'
};

/**
 * A client colour as tile classes: a tint of the brand token with a matching border, the token as
 * the icon colour and the solid token for the picker's swatch. Letters stay ink, so they keep their
 * contrast on every tint in both themes.
 */
export const clientColorClasses: Record<ClientColor, { label: string; tile: string; icon: string; swatch: string }> = {
    blue: {
        label: 'Blue',
        tile: 'border-[hsl(var(--brand-accent)/0.35)] bg-[hsl(var(--brand-accent)/0.12)]',
        icon: 'text-[hsl(var(--brand-accent-text))]',
        swatch: 'bg-[hsl(var(--brand-accent))]'
    },
    green: {
        label: 'Green',
        tile: 'border-[hsl(var(--brand-success)/0.35)] bg-[hsl(var(--brand-success)/0.12)]',
        icon: 'text-[hsl(var(--brand-success))]',
        swatch: 'bg-[hsl(var(--brand-success))]'
    },
    amber: {
        label: 'Amber',
        tile: 'border-[hsl(var(--brand-warning)/0.35)] bg-[hsl(var(--brand-warning)/0.12)]',
        icon: 'text-[hsl(var(--brand-warning))]',
        swatch: 'bg-[hsl(var(--brand-warning))]'
    },
    red: {
        label: 'Red',
        tile: 'border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.12)]',
        icon: 'text-[hsl(var(--destructive))]',
        swatch: 'bg-[hsl(var(--destructive))]'
    }
};

/** A client's logo, with its icon or first letter on its colour as the loading/failure fallback. */
export function ClientMark({ client: { name, icon, color, logoUrl }, className }: {
    client: { name: string; icon?: ClientIcon; color?: ClientColor; logoUrl?: string };
    className?: string;
}) {
    const Icon = icon && clientIconComponents[icon];
    const colors = color && clientColorClasses[color];
    return (
        <Avatar
            render={<span />}
            aria-hidden="true"
            data-slot="client-mark"
            className={cn(
                'size-4 shrink-0 after:hidden items-center justify-center rounded-[4px] border bg-background text-[10px] leading-none font-semibold text-foreground uppercase',
                colors?.tile,
                className)}>
            {logoUrl && <AvatarImage src={logoUrl} alt="" className="rounded-[inherit]" />}
            <AvatarFallback className="rounded-[inherit] bg-transparent text-[length:inherit] text-inherit">
                {Icon ? <Icon className={cn('size-[60%]', colors?.icon)} /> : name.trim()[0] ?? '?'}
            </AvatarFallback>
        </Avatar>
    );
}
