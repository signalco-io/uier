'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@signalco/ui-primitives/Button';
import { Row } from '@signalco/ui-primitives/Row';

const options = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' }
] as const;

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    // next-themes only knows the theme on the client; render "system" until mounted to avoid a hydration mismatch.
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);
    const current = mounted ? (theme ?? 'system') : 'system';

    return (
        <Row spacing={0.5} role="group" aria-label="Theme">
            {options.map(option => (
                <Button
                    key={option.value}
                    size="sm"
                    variant={current === option.value ? 'soft' : 'plain'}
                    aria-pressed={current === option.value}
                    onClick={() => setTheme(option.value)}>
                    {option.label}
                </Button>
            ))}
        </Row>
    );
}
