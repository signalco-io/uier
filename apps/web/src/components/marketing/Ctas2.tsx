import { Row } from '@uier/ui-primitives/Row';
import { IconButton } from '@uier/ui-primitives/IconButton';
import { type SectionData } from '@uier/cms-core/SectionData';

export function Ctas2({ ctas }: { ctas: SectionData['ctas']; }) {
    if (!ctas?.length) {
        return null;
    }

    return (
        <Row spacing={1}>
            {ctas.map(cta => (
                <a key={cta.label} href={cta.href}>
                    <IconButton
                        aria-label={cta.label}
                        variant="link">
                        {cta.icon}
                    </IconButton>
                </a>
            ))}
        </Row>
    );
}
