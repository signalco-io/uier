import { useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Popover } from '@base-ui/react/popover';

// A real framework portal: every remount regenerates the popup, trigger, wrapper and content ids.
function Assignment({ changed }: { changed: boolean }) {
    const wrapper = useId();
    const content = useId();
    return <section id={wrapper}>
        <Popover.Root>
            <Popover.Trigger aria-label="Inspect assignment">Inspect assignment</Popover.Trigger>
            <Popover.Portal>
                <Popover.Positioner sideOffset={8}>
                    <Popover.Popup aria-label="Assignment details">
                        <p id={content} role="note" aria-label="Assignment summary" data-testid={changed ? undefined : 'assignment-summary'}>
                            Assigned to the project reviewer.
                        </p>
                        <Popover.Close>Close assignment</Popover.Close>
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    </section>;
}

function AnchorLayers() {
    const [version, setVersion] = useState(0);
    return <>
        <Assignment key={version} changed={version > 0} />
        <button type="button" onClick={() => setVersion(version + 1)}>Remount assignment</button>
    </>;
}

createRoot(document.getElementById('anchor-layers')!).render(<AnchorLayers />);
