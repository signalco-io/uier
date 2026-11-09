import { expect, test } from '@playwright/test';
import { agentModelText, agentText, modelName } from '@uier/toolbar/agents';

test('Claude model ids read by name, current, dated, older and routed', () => {
    expect(modelName('claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(modelName('claude-fable-5-1')).toBe('Claude Fable 5.1');
    expect(modelName('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5');
    expect(modelName('claude-sonnet-4-20250514')).toBe('Claude Sonnet 4');
    expect(modelName('claude-haiku-4-5')).toBe('Claude Haiku 4.5');
    expect(modelName('claude-3-5-sonnet-20241022')).toBe('Claude 3.5 Sonnet');
    expect(modelName('claude-3-5-haiku-latest')).toBe('Claude 3.5 Haiku');
    expect(modelName('claude-3-opus-20240229')).toBe('Claude 3 Opus');
    expect(modelName('claude-2.1')).toBe('Claude 2.1');
    expect(modelName(' Claude-Opus-4-1 ')).toBe('Claude Opus 4.1');
    expect(modelName('claude-opus-4-6[1m]')).toBe('Claude Opus 4.6 (1M context)');
    expect(modelName('opus')).toBe('Claude Opus');
    expect(modelName('anthropic/claude-sonnet-4.5')).toBe('Claude Sonnet 4.5');
    expect(modelName('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Claude Sonnet 4.5');
    expect(modelName('claude-opus-4-5@20251101')).toBe('Claude Opus 4.5');
});

test('OpenAI model ids read as OpenAI writes them', () => {
    expect(modelName('gpt-5')).toBe('GPT-5');
    expect(modelName('gpt-5.1')).toBe('GPT-5.1');
    expect(modelName('gpt-5.1-codex')).toBe('GPT-5.1-Codex');
    expect(modelName('gpt-5.1-codex-max')).toBe('GPT-5.1-Codex-Max');
    expect(modelName('gpt-5-mini')).toBe('GPT-5 mini');
    expect(modelName('gpt-4o')).toBe('GPT-4o');
    expect(modelName('gpt-4o-2024-08-06')).toBe('GPT-4o');
    expect(modelName('gpt-4-turbo')).toBe('GPT-4 Turbo');
    expect(modelName('openai/gpt-5-chat-latest')).toBe('GPT-5 Chat');
    expect(modelName('o3')).toBe('o3');
    expect(modelName('o4-mini')).toBe('o4-mini');
    expect(modelName('o3-2025-04-16')).toBe('o3');
});

test('Gemini and other common model ids read by name', () => {
    expect(modelName('gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
    expect(modelName('gemini-2.5-flash-lite')).toBe('Gemini 2.5 Flash-Lite');
    expect(modelName('gemini-3-pro-preview')).toBe('Gemini 3 Pro Preview');
    expect(modelName('gemini-2.0-flash-001')).toBe('Gemini 2.0 Flash');
    expect(modelName('models/gemini-2.5-flash-preview-05-20')).toBe('Gemini 2.5 Flash Preview');
    expect(modelName('grok-code-fast-1')).toBe('Grok Code Fast 1');
    expect(modelName('grok-4-0709')).toBe('Grok 4');
    expect(modelName('deepseek-r1')).toBe('DeepSeek R1');
    expect(modelName('deepseek-v3.1')).toBe('DeepSeek V3.1');
    expect(modelName('qwen3-coder:30b')).toBe('Qwen3 Coder 30B');
    expect(modelName('kimi-k2-0905-preview')).toBe('Kimi K2 Preview');
    expect(modelName('meta-llama/llama-3.3-70b-instruct')).toBe('Llama 3.3 70B Instruct');
    expect(modelName('mistral-large-latest')).toBe('Mistral Large');
    expect(modelName('devstral-medium-2507')).toBe('Devstral Medium');
    expect(modelName('composer-1')).toBe('Composer 1');
});

test('unknown model ids show as they are', () => {
    for (const id of ['my-fine-tune', 'gpt-oss-120b', 'claude-next', 'gemini-exp-1206', 'v2', '']) expect(modelName(id)).toBeUndefined();
    expect(agentModelText({ label: 'Claude', model: 'my-fine-tune' })).toBe('my-fine-tune');
});

test('the thread names the model without repeating the agent, and keeps another maker\'s name', () => {
    expect(agentModelText({ label: 'Claude', model: 'claude-opus-5-5' })).toBe('Opus 5.5');
    expect(agentModelText({ label: 'Claude', model: 'claude-3-5-sonnet-20241022' })).toBe('3.5 Sonnet');
    expect(agentModelText({ label: 'Cursor', model: 'claude-sonnet-4-5' })).toBe('Claude Sonnet 4.5');
    expect(agentModelText({ label: 'Codex', model: 'gpt-5.1-codex' })).toBe('GPT-5.1-Codex');
    expect(agentText({ label: 'Claude' })).toBe('Claude');
    expect(agentText({ label: 'Claude', model: 'claude-opus-5-5' })).toBe('Claude Opus 5.5');
    expect(agentText({ label: 'Claude', model: 'claude-opus-5-5', reasoning: 'xhigh' })).toBe('Claude Opus 5.5 (xhigh reasoning)');
    expect(agentText({ label: 'AI agent', model: 'my-fine-tune', reasoning: 'high' })).toBe('AI agent my-fine-tune (high reasoning)');
});
