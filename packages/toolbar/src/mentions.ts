type Mention = { userId: string; start: number; end: number; name?: string };

export function moveMentions<T extends Mention>(before: string, after: string, mentions: T[]): T[] {
    if (before === after) return mentions;
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let oldEnd = before.length, newEnd = after.length;
    while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
    const delta = newEnd - oldEnd;
    return mentions.flatMap(mention => {
        if (mention.end <= start) return [mention];
        if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
        return [];
    });
}

