/********************************************************************************
 * Copyright (C) 2026 Cocrates and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import * as assert from 'assert';
import {
    aggregateParts,
    splitPartsIntoToolRounds,
    toTraceSteps,
    toolCallAwaitsResult
} from './llm-trace-model';
import { LanguageModelStreamResponsePart } from '@theia/ai-core/lib/common/language-model';
import { LanguageModelExchangeRequest } from '@theia/ai-core/lib/common/language-model-interaction-model';

describe('llm-trace-model OpenAI-style steps', () => {

    it('awaitsToolResults is false when tools finished with results', () => {
        const parts: LanguageModelStreamResponsePart[] = [
            { content: 'reading…' },
            { tool_calls: [{ id: 't1', finished: false, function: { name: 'getFileContents', arguments: '{}' } }] },
            { tool_calls: [{ id: 't1', finished: true, function: { name: 'getFileContents', arguments: '{}' }, result: 'ok' }] },
            { content: 'done' }
        ];
        const rounds = splitPartsIntoToolRounds(parts);
        assert.strictEqual(rounds.length, 2);
        assert.strictEqual(aggregateParts(rounds[0]).awaitsToolResults, false);
        assert.strictEqual(aggregateParts(rounds[1]).text, 'done');
    });

    it('toolCallAwaitsResult ignores finished calls', () => {
        assert.strictEqual(toolCallAwaitsResult({ id: 'a', finished: true, result: 'x' }), false);
        assert.strictEqual(toolCallAwaitsResult({ id: 'a', finished: false, function: { name: 'f' } }), true);
    });

    it('matches Untitled-1 shape: cumulative OpenAI messages per step', () => {
        const request = {
            id: 'req-1',
            languageModel: 'openai/gpt',
            metadata: { timestamp: 1 },
            request: {
                messages: [
                    { actor: 'system', type: 'text', text: '# Role\nsys' },
                    { actor: 'user', type: 'text', text: '현재 과제의 진행상황을 파악하고 알려줘.' }
                ],
                tools: [{ name: 'getWorkspaceDirectoryStructure' }, { name: 'findFilesByPattern' }]
            },
            response: {
                parts: [
                    { content: '진행상황을 보기 위해 확인하겠습니다.' },
                    {
                        tool_calls: [
                            { id: 'toolu_1', finished: false, function: { name: 'getWorkspaceDirectoryStructure', arguments: '{}' } },
                            { id: 'toolu_2', finished: false, function: { name: 'findFilesByPattern', arguments: '{"pattern":"**/*.md"}' } }
                        ]
                    },
                    {
                        tool_calls: [
                            { id: 'toolu_1', finished: true, function: { name: 'getWorkspaceDirectoryStructure', arguments: '{}' }, result: '{"root":{}}' },
                            { id: 'toolu_2', finished: true, function: { name: 'findFilesByPattern', arguments: '{"pattern":"**/*.md"}' }, result: '{"files":["TODO.md"]}' }
                        ]
                    },
                    { content: '## 현재 진행상황 요약' }
                ]
            }
        } as unknown as LanguageModelExchangeRequest;

        const steps = toTraceSteps(request);
        assert.strictEqual(steps.length, 2);

        // Step 1: system + user + assistant(tool_calls) — no tool results yet
        assert.strictEqual(steps[0].step, 1);
        assert.deepStrictEqual(steps[0].messages.map(m => m.role), ['system', 'user', 'assistant']);
        const a0 = steps[0].messages[2];
        assert.strictEqual(a0.role, 'assistant');
        if (a0.role === 'assistant') {
            assert.strictEqual(a0.content, '진행상황을 보기 위해 확인하겠습니다.');
            assert.strictEqual(a0.tool_calls?.length, 2);
            assert.strictEqual(a0.tool_calls?.[0].type, 'function');
        }
        assert.strictEqual(steps[0].metadata.languageModel, 'openai/gpt');
        assert.strictEqual(steps[0].metadata.reconstructed, true);

        // Step 2: prior + tool results + final assistant
        assert.strictEqual(steps[1].step, 2);
        assert.deepStrictEqual(steps[1].messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'tool', 'assistant']);
        assert.strictEqual(steps[1].messages[0].role, 'system');
        if (steps[1].messages[0].role === 'system') {
            assert.ok(steps[1].messages[0].content.includes('# Role'));
        }
        assert.strictEqual(steps[1].messages[3].role, 'tool');
        if (steps[1].messages[3].role === 'tool') {
            assert.strictEqual(steps[1].messages[3].tool_call_id, 'toolu_1');
        }
        const final = steps[1].messages[5];
        assert.strictEqual(final.role, 'assistant');
        if (final.role === 'assistant') {
            assert.strictEqual(final.content, '## 현재 진행상황 요약');
            assert.strictEqual(final.tool_calls, undefined);
        }

        // No shared object identity across steps (avoids [Circular] in JSONL)
        assert.notStrictEqual(steps[0].messages[0], steps[1].messages[0]);
    });

    it('puts usage tokens into step.metadata.usage', () => {
        const request = {
            id: 'req-u',
            languageModel: 'openai/gpt',
            metadata: { timestamp: 42 },
            request: {
                messages: [{ actor: 'user', type: 'text', text: 'hi' }]
            },
            response: {
                parts: [
                    { content: 'hello' },
                    { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 2 }
                ]
            }
        } as unknown as LanguageModelExchangeRequest;

        const [step] = toTraceSteps(request);
        assert.deepStrictEqual(step.metadata.usage, {
            input_tokens: 10,
            output_tokens: 3,
            cache_read_input_tokens: 2
        });
        assert.strictEqual(step.metadata.timestamp, 42);
    });
});
