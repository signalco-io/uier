/**
 * Shared, browser-safe vocabulary of the AI agents that can work on a thread under its assignee
 * (the app's Assignee field, the toolbar's thread header, MCP). One agent per assignee at most.
 */
export const agentKinds = ['claude', 'codex', 'chatgpt', 'cursor', 'agent'] as const;
export type AgentKind = typeof agentKinds[number];
export const agentLabels: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex', chatgpt: 'ChatGPT', cursor: 'Cursor', agent: 'AI agent' };

export const MAX_AGENT_SESSION_LENGTH = 200;
export const MAX_AGENT_MODEL_LENGTH = 100;
/**
 * The reasoning level (effort) an agent runs at, as its tool names it: Claude's low, medium, high, xhigh
 * and max, OpenAI's minimal, low, medium and high. Short free text rather than a fixed list, because each
 * provider names its levels differently and adds new ones.
 */
export const MAX_AGENT_REASONING_LENGTH = 32;

/** What views show about the agent; `sessionId`, `model` and `reasoning` are what the agent or its assignee said, untrusted. */
export type AssigneeAgentView = { kind: AgentKind; label: string; model?: string; reasoning?: string; sessionId?: string; setAt?: string; workingUntil?: string };

/** A working claim is a five-minute lease, renewed with a new action key while the agent is active. */
export const AGENT_WORKING_LEASE_MS = 5 * 60 * 1000;
export function agentIsWorking(workingUntil: string | undefined, now = Date.now()) {
    return Boolean(workingUntil && Date.parse(workingUntil) > now);
}

/**
 * The AI agent that wrote a message for its author through a coding tool connection (MCP): "Ana via
 * Claude". The server stores it with the message; the author is still the person. `model` and
 * `reasoning` are what the agent or the person said, untrusted, and only members get them.
 */
export type MessageAgentView = { kind: AgentKind; label: string; model?: string; reasoning?: string };

export function isAgentKind(value: unknown): value is AgentKind {
    return typeof value === 'string' && agentKinds.includes(value as AgentKind);
}

/**
 * The agent a coding tool is, from what it calls itself (a connected app's name, an access token's
 * name, a client id or user agent). Codex before ChatGPT: "OpenAI Codex" is Codex. Untrusted hints
 * only choose a label and an avatar; they never grant anything.
 */
export function inferAgentKind(...hints: (string | null | undefined)[]): AgentKind {
    const text = hints.filter(Boolean).join(' ').toLowerCase();
    if (/claude|anthropic/.test(text)) return 'claude';
    if (/codex/.test(text)) return 'codex';
    if (/chatgpt|openai/.test(text)) return 'chatgpt';
    if (/cursor/.test(text)) return 'cursor';
    return 'agent';
}

/** "high reasoning": the reasoning level in words, for names and tooltips (the thread shows the level alone) */
export function reasoningText(reasoning: string) {
    return `${reasoning} reasoning`;
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
/** "5-5", "4.5" or "3": a version written with dots */
const version = (major: string, minor?: string) => minor ? `${major}.${minor}` : major;

/** Other families agents commonly run on, by the first word of their ids, as their makers write them */
const otherFamilies: Record<string, string> = {
    grok: 'Grok', deepseek: 'DeepSeek', mistral: 'Mistral', codestral: 'Codestral', devstral: 'Devstral', magistral: 'Magistral',
    ministral: 'Ministral', pixtral: 'Pixtral', qwen: 'Qwen', kimi: 'Kimi', llama: 'Llama', composer: 'Composer', glm: 'GLM'
};

/** One word of a model id after its family: "70b" → "70B", "r1" → "R1", "v3.1" → "V3.1", "coder" → "Coder" */
function modelWord(word: string) {
    if (/^\d+(\.\d+)*$/.test(word)) return word;
    if (/^\d+(\.\d+)?[bkm]$/.test(word) || /^[a-z]\d+(\.\d+)*[a-z]?$/.test(word)) return word.toUpperCase();
    return capitalize(word);
}

/**
 * A model's name as its maker writes it, from the id an agent reported ("claude-opus-5-5" → "Claude Opus 5.5",
 * "gpt-5.1-codex" → "GPT-5.1-Codex", "gemini-2.5-flash-lite" → "Gemini 2.5 Flash-Lite"), or undefined for an
 * id it does not know, which views show as it is. Dates, "latest", revision suffixes and routing prefixes
 * (OpenRouter's "anthropic/", Bedrock's "us.anthropic." and "-v1:0", Vertex's "@20251101") drop, since the
 * name stays the same; Claude Code's "[1m]" becomes "(1M context)". Pure: the same words in the app and toolbar.
 */
export function modelName(model: string): string | undefined {
    let id = model.trim().toLowerCase();
    const longContext = /\[1m\]$/.test(id);
    id = id.replace(/\[1m\]$/, '').replace(/^.*\//, '').replace(/@[\w.-]+$/, '')
        .replace(/^(?:[a-z]{2,4}\.)?anthropic\./, '').replace(/-v\d+:\d+$/, '')
        .replace(/-(?:latest|\d{4}-\d{2}-\d{2}|\d{8})$/, '');
    const context = longContext ? ' (1M context)' : '';
    let match: RegExpMatchArray | null;

    // Claude: claude-opus-5-5, claude-sonnet-4-5-20250929, claude-3-5-sonnet-20241022, claude-2.1; Claude Code's opus, sonnet, haiku
    if ((match = id.match(/^claude-([a-z]+)-(\d+)(?:[-.](\d{1,2}))?$/))) return `Claude ${capitalize(match[1]!)} ${version(match[2]!, match[3])}${context}`;
    if ((match = id.match(/^claude-(\d+)(?:[-.](\d{1,2}))?-([a-z]+)$/))) return `Claude ${version(match[1]!, match[2])} ${capitalize(match[3]!)}${context}`;
    if ((match = id.match(/^claude-(\d+)(?:\.(\d+))?$/))) return `Claude ${version(match[1]!, match[2])}`;
    if ((match = id.match(/^(opus|sonnet|haiku|fable)$/))) return `Claude ${capitalize(match[1]!)}${context}`;

    // OpenAI: gpt-5, gpt-5.1-codex-max (Codex models joined by hyphens), gpt-5-mini, gpt-4o; o3, o4-mini as they are
    if ((match = id.match(/^gpt-(\d+(?:\.\d+)?o?)((?:-[a-z0-9]+)*)$/))) {
        const words = match[2]!.split('-').filter(Boolean);
        if (words.includes('codex')) return [`GPT-${match[1]}`, ...words.map(capitalize)].join('-');
        return [`GPT-${match[1]}`, ...words.map(word => ['mini', 'nano', 'pro'].includes(word) ? word : capitalize(word))].join(' ');
    }
    if (/^o\d(?:-[a-z]+)*$/.test(id)) return id;

    // Google: gemini-2.5-pro, gemini-2.5-flash-lite, gemini-3-pro-preview, gemini-2.0-flash-001 (revisions and dates drop)
    if ((match = id.match(/^gemini-(\d+(?:\.\d+)?)((?:-[a-z0-9]+)*)$/))) {
        const words = match[2]!.replace(/flash-lite/, 'flash_lite').split('-').filter(word => word && !/^\d+$/.test(word));
        return ['Gemini', match[1], ...words.map(word => word === 'flash_lite' ? 'Flash-Lite' : capitalize(word))].join(' ');
    }

    // Others: grok-code-fast-1, deepseek-r1, qwen3-coder:30b, kimi-k2-0905-preview, llama-3.3-70b-instruct, composer-1
    const [first, ...rest] = id.replace(/:/g, '-').split('-');
    const family = first?.match(/^([a-z]+)(\d[\d.]*)?$/);
    const familyName = family && otherFamilies[family[1]!];
    if (!familyName) return undefined;
    return [familyName + (family[2] ?? ''), ...rest.filter(word => word && !/^\d{4,}$/.test(word) && word !== 'latest').map(modelWord)].join(' ');
}

/**
 * The model as the thread shows it after the agent's name: its name without the agent's own name in front
 * ("Opus 5.5" after "Claude"; "Claude Sonnet 4.5" after "Cursor"), or the id as reported when unknown
 */
export function agentModelText(agent: Pick<AssigneeAgentView, 'label'> & { model: string }) {
    const name = modelName(agent.model);
    if (!name) return agent.model;
    return name.startsWith(`${agent.label} `) ? name.slice(agent.label.length + 1) : name;
}

/**
 * "Claude", "Claude Opus 5.5" or "Claude Opus 5.5 (high reasoning)": a one-line description, the same
 * words in the app and toolbar (avatars' names, the toolbar header's tooltip)
 */
export function agentText(agent: Pick<AssigneeAgentView, 'label' | 'model' | 'reasoning'>) {
    const name = agent.model ? `${agent.label} ${agentModelText({ label: agent.label, model: agent.model })}` : agent.label;
    return agent.reasoning ? `${name} (${reasoningText(agent.reasoning)})` : name;
}

/** OpenAI's logo: Codex and ChatGPT are both OpenAI's, so both show it */
const openAiMark = 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z';

/**
 * Each agent's mark on a 24 grid, drawn in the text colour on a bordered circle (one-colour marks, ink
 * on paper and paper on dark). Claude, OpenAI (Codex and ChatGPT) and Cursor are from Simple Icons (CC0);
 * the generic agent is Lucide's `bot` (ISC), outlined like every other icon.
 */
export const agentMarks: Record<AgentKind, { paths: string[]; stroke?: boolean }> = {
    claude: { paths: ['m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'] },
    codex: { paths: [openAiMark] },
    chatgpt: { paths: [openAiMark] },
    cursor: { paths: ['M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23'] },
    agent: { stroke: true, paths: ['M12 8V4H8', 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'] }
};
