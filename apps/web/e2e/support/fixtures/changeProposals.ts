import type { PageFixture } from './types';

const fixture: PageFixture = {
    body: () => '<button id="proposal-target" type="button">Book a table</button>',
    css: `main { min-height: 130vh; }
    #proposal-target {
        display: block;
        margin-top: 36vh;
        padding: 4px 8px;
        border-radius: 4px;
        color: rgb(0, 0, 0);
        background: rgb(255, 255, 255);
    }`
};

export default fixture;
