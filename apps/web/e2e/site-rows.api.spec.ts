import { expect, test } from '@playwright/test';
import { sameSiteAs, savedSiteRows, shareOptions, sharedWith, shareWith, siteOrigin, siteRowsPayload, typedAddress } from '../src/components/app/projects/siteRows';

test('addresses show without their default scheme and resolve to the origin the server saves', () => {
    expect(typedAddress('https://example.com')).toBe('example.com');
    expect(typedAddress('https://example.com/app')).toBe('example.com/app');
    expect(typedAddress('http://localhost:3000')).toBe('localhost:3000');
    // A scheme that is not the default stays
    expect(typedAddress('http://example.com')).toBe('http://example.com');
    expect(typedAddress('https://localhost:3000')).toBe('https://localhost:3000');
    expect(siteOrigin('www.example.com/shop/')).toBe('https://www.example.com');
    expect(siteOrigin('app.localhost:4000')).toBe('http://app.localhost:4000');
    expect(siteOrigin('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(siteOrigin('  ')).toBeNull();
});

test('saved addresses become rows with their labels and shared groups', () => {
    const rows = savedSiteRows(
        ['https://example.com', 'https://www.example.com', 'https://staging.example.com', 'https://example.com/shop'],
        [
            { origin: 'https://example.com', label: 'Production', group: 'Live' },
            { origin: 'https://www.example.com', label: 'https://www.example.com', group: 'Live' },
            // A group of one site shares nothing
            { origin: 'https://staging.example.com', label: 'Staging', group: 'Alone' }
        ]);
    expect(rows).toEqual([
        { url: 'example.com', label: 'Production', group: 0 },
        { url: 'www.example.com', label: '', group: 0 },
        { url: 'staging.example.com', label: 'Staging', group: null },
        { url: 'example.com/shop', label: 'Production', group: 0 }
    ]);
    // The path on the main origin is the same site, with its label and sharing
    expect(sameSiteAs(rows, 3)).toBe(0);
    expect(shareOptions(rows, 2).map(option => option.other)).toEqual([0, 1]);
    expect(sharedWith(rows, 0)).toEqual([1]);
    expect(sharedWith(rows, 1)).toEqual([0]);
});

test('sharing joins a group both ways, leaving keeps the rest of the group, and groups get valid names', () => {
    const environments = [{ origin: 'https://example.com', label: 'Production', group: 'Live' }, { origin: 'https://www.example.com', label: 'Alias', group: 'Live' }];
    let rows = savedSiteRows(['https://example.com', 'https://www.example.com', 'https://preview.example.com', 'localhost:3000'], environments);
    rows = shareWith(rows, 2, 0);
    expect(sharedWith(rows, 0)).toEqual([1, 2]);
    expect(sharedWith(rows, 2)).toEqual([0, 1]);
    // The group keeps the name it was saved with
    expect(siteRowsPayload(rows, environments).map(row => row.group)).toEqual(['Live', 'Live', 'Live', '']);

    // Leaving: the other two still share
    rows = shareWith(rows, 0, null);
    expect(sharedWith(rows, 1)).toEqual([2]);
    expect(sharedWith(rows, 0)).toEqual([]);

    // A saved name goes to the first group with one of its sites; a new group is named after its
    // first row's label or host, in the characters the server allows
    rows = shareWith(rows, 3, 0);
    expect(siteRowsPayload(rows, environments).map(row => row.group)).toEqual(['Live', 'Alias', 'Alias', 'Live']);
    rows = rows.map((row, index) => index === 0 ? { ...row, label: 'Main (EU)' } : row);
    expect(siteRowsPayload(rows, []).map(row => row.group)).toEqual(['Main EU', 'Alias', 'Alias', 'Main EU']);
    rows = rows.map((row, index) => index === 0 ? { ...row, label: '' } : row);
    expect(siteRowsPayload(rows, []).map(row => row.group)).toEqual(['example.com', 'Alias', 'Alias', 'example.com']);

    // A group whose last other site leaves shares nothing
    rows = shareWith(rows, 3, null);
    expect(rows.map(row => row.group)).toEqual([null, 0, 0, null]);
});

test('two new groups never get the same name', () => {
    const rows = [
        { url: 'a.example.com', label: 'Shop', group: 0 },
        { url: 'b.example.com', label: '', group: 0 },
        { url: 'c.example.com', label: 'Shop', group: 1 },
        { url: 'd.example.com', label: '', group: 1 }
    ];
    expect(siteRowsPayload(rows, []).map(row => row.group)).toEqual(['Shop', 'Shop', 'Shop 2', 'Shop 2']);
});
