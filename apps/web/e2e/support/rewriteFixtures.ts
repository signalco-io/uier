/** Synthetic provider fixtures shared by the HTTP stub and service accounting tests. */
export const stubUsage = { input_tokens: 120, output_tokens: 60, cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    service_tier: 'standard', speed: 'standard', inference_geo: 'global' };

export function rewriteFixture(kind = 'success', model = 'claude-opus-5-5') {
    const answer = { id: 'msg_synthetic', type: 'message', role: 'assistant', model, stop_reason: 'end_turn',
        stop_sequence: null, stop_details: null as unknown,
        content: [{ type: 'text', text: JSON.stringify({ suggestions: ['A clearer page.', 'A simpler page.', 'An easier page.'] }) }] as unknown[],
        usage: { ...stubUsage } as unknown };
    if (kind === 'refusal') { answer.stop_reason = 'refusal'; answer.stop_details = { category: 'cyber' }; }
    if (kind === 'truncation') { answer.stop_reason = 'max_tokens'; answer.content = [{ type: 'text', text: '{' }]; }
    if (kind === 'invalid_output') answer.content = [{ type: 'text', text: 'PRIVATE_PROVIDER_RESPONSE' }];
    if (kind === 'empty_output') answer.content = [];
    if (kind === 'filtered_out') answer.content = [{ type: 'text', text: JSON.stringify({ suggestions: [' ', 'x'.repeat(1001)] }) }];
    if (kind === 'missing_usage') answer.usage = undefined;
    if (kind === 'fallback') {
        answer.model = 'claude-sonnet-5-5';
        answer.content.unshift({ type: 'fallback', from: { model }, to: { model: answer.model }, trigger: { type: 'refusal', category: 'cyber' } });
        answer.usage = { ...stubUsage, iterations: [
            { ...stubUsage, type: 'message', model, output_tokens: 0 },
            { ...stubUsage, type: 'fallback_message', model: answer.model },
        ] };
    }
    return answer;
}
