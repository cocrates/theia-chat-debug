/********************************************************************************
 * Copyright (C) 2026 Cocrates and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import {
    LanguageModelExchange,
    LanguageModelExchangeRequest,
    LanguageModelExchangeRequestResponse,
    LanguageModelSession
} from '@theia/ai-core/lib/common/language-model-interaction-model';
import {
    formatToolCallContentForModel,
    isServerToolCallResponsePart,
    isTextResponsePart,
    isThinkingResponsePart,
    isToolCallResponsePart,
    isUsageResponsePart,
    LanguageModelMessage,
    LanguageModelStreamResponsePart,
    ToolCall,
    ToolCallResult,
    UsageResponsePart
} from '@theia/ai-core/lib/common/language-model';

/** OpenAI Chat Completions–compatible message (approximation of the wire body). */
export type OpenAiTraceMessage =
    | { role: 'system' | 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: OpenAiTraceToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAiTraceToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

/** Token / round metadata attached to each step (from UsageResponsePart + local flags). */
export interface LlmTraceStepMetadata {
    languageModel: string;
    timestamp?: number;
    /**
     * True when this step was carved out of a single provider stream that ran
     * an internal tool loop (continuation messages are reconstructed).
     */
    reconstructed?: boolean;
    /** Provider thinking/reasoning text for this round (not part of OpenAI messages). */
    thinking?: string;
    usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
    };
}

/**
 * One LLM round inside a user turn.
 * `messages` is the OpenAI-style transcript for that round: prior history + this round's assistant message
 * (tool results appear only from the next step's history onward, matching Chat Completions).
 */
export interface LlmTraceStep {
    /** 1-based step number (OpenAI-style turn logging). */
    step: number;
    requestId: string;
    messages: OpenAiTraceMessage[];
    metadata: LlmTraceStepMetadata;
}

export function toStepMetadata(
    languageModel: string,
    timestamp: number | undefined,
    aggregated: AggregatedLlmResponse,
    reconstructed: boolean
): LlmTraceStepMetadata {
    const metadata: LlmTraceStepMetadata = {
        languageModel,
        timestamp,
        reconstructed: reconstructed || undefined
    };
    if (aggregated.thinking) {
        metadata.thinking = aggregated.thinking;
    }
    if (aggregated.usage) {
        metadata.usage = {
            input_tokens: aggregated.usage.input_tokens,
            output_tokens: aggregated.usage.output_tokens,
            ...(aggregated.usage.cache_creation_input_tokens !== undefined
                ? { cache_creation_input_tokens: aggregated.usage.cache_creation_input_tokens }
                : {}),
            ...(aggregated.usage.cache_read_input_tokens !== undefined
                ? { cache_read_input_tokens: aggregated.usage.cache_read_input_tokens }
                : {})
        };
    }
    return metadata;
}

/** Stream parts collapsed for round splitting / reconstruction. */
export interface AggregatedLlmResponse {
    text: string;
    thinking: string;
    toolCalls: ToolCall[];
    serverToolCalls: unknown[];
    usage?: UsageResponsePart;
    awaitsToolResults: boolean;
}

/** One user request through final assistant answer (may contain several LLM steps). */
export interface LlmTraceTurn {
    kind: 'turn';
    ts: string;
    sessionId: string;
    turnId: string;
    agent?: string;
    startedAt?: number;
    completedAt?: number;
    stepCount: number;
    steps: LlmTraceStep[];
}

export function toolCallAwaitsResult(call: ToolCall): boolean {
    if (call.finished === true) {
        return false;
    }
    if (call.result !== undefined) {
        return false;
    }
    return !!(call.id || call.function?.name);
}

export function aggregateResponse(response: LanguageModelExchangeRequestResponse): AggregatedLlmResponse {
    if ('parts' in response && Array.isArray(response.parts)) {
        return aggregateParts(response.parts);
    }
    if ('text' in response && typeof response.text === 'string') {
        return {
            text: response.text,
            thinking: '',
            toolCalls: [],
            serverToolCalls: [],
            usage: response.usage,
            awaitsToolResults: false
        };
    }
    if ('content' in response && typeof (response as { content: unknown }).content === 'string') {
        return {
            text: (response as { content: string }).content,
            thinking: '',
            toolCalls: [],
            serverToolCalls: [],
            awaitsToolResults: false
        };
    }
    return {
        text: '',
        thinking: '',
        toolCalls: [],
        serverToolCalls: [],
        awaitsToolResults: false
    };
}

export function aggregateParts(parts: LanguageModelStreamResponsePart[]): AggregatedLlmResponse {
    let text = '';
    let thinking = '';
    const toolCalls: ToolCall[] = [];
    const serverToolCalls: unknown[] = [];
    let usage: UsageResponsePart | undefined;
    for (const part of parts) {
        if (isTextResponsePart(part) && part.content) {
            text += part.content;
        } else if (isThinkingResponsePart(part) && part.thought) {
            thinking += part.thought;
        } else if (isToolCallResponsePart(part) && part.tool_calls) {
            for (const call of part.tool_calls) {
                mergeToolCall(toolCalls, call);
            }
        } else if (isServerToolCallResponsePart(part) && part.server_tool_calls) {
            serverToolCalls.push(...part.server_tool_calls);
        } else if (isUsageResponsePart(part)) {
            usage = part;
        }
    }
    return {
        text,
        thinking,
        toolCalls,
        serverToolCalls,
        usage,
        awaitsToolResults: toolCalls.some(toolCallAwaitsResult)
    };
}

/**
 * Split a provider stream into tool-loop rounds.
 * Boundary: every open tool id has been closed with a finished result.
 */
export function splitPartsIntoToolRounds(parts: LanguageModelStreamResponsePart[]): LanguageModelStreamResponsePart[][] {
    if (parts.length === 0) {
        return [[]];
    }
    const rounds: LanguageModelStreamResponsePart[][] = [];
    let current: LanguageModelStreamResponsePart[] = [];
    const openToolIds = new Set<string>();
    let sawCloseableTool = false;

    for (const part of parts) {
        current.push(part);
        if (!isToolCallResponsePart(part) || !part.tool_calls?.length) {
            continue;
        }
        for (const call of part.tool_calls) {
            if (!call.id) {
                continue;
            }
            if (call.finished === true || call.result !== undefined) {
                openToolIds.delete(call.id);
                sawCloseableTool = true;
            } else if (call.finished === false || call.function?.name || call.argumentsDelta) {
                openToolIds.add(call.id);
                sawCloseableTool = true;
            }
        }
        if (sawCloseableTool && openToolIds.size === 0) {
            rounds.push(current);
            current = [];
            sawCloseableTool = false;
        }
    }
    if (current.length > 0) {
        rounds.push(current);
    }
    return rounds.length > 0 ? rounds : [parts];
}

function mergeToolCall(into: ToolCall[], call: ToolCall): void {
    const existing = call.id ? into.find(t => t.id === call.id) : undefined;
    if (!existing) {
        into.push({
            ...call,
            function: call.function ? { ...call.function } : undefined
        });
        return;
    }
    if (call.function?.name) {
        existing.function = { ...existing.function, name: call.function.name };
    }
    if (call.function?.arguments !== undefined) {
        const prev = existing.function?.arguments ?? '';
        const next = call.argumentsDelta ? prev + call.function.arguments : call.function.arguments;
        existing.function = { ...existing.function, arguments: next };
    }
    if (call.result !== undefined) {
        existing.result = call.result;
    }
    if (call.finished !== undefined) {
        existing.finished = call.finished;
    }
}

function cloneMessages(messages: OpenAiTraceMessage[]): OpenAiTraceMessage[] {
    return JSON.parse(JSON.stringify(messages)) as OpenAiTraceMessage[];
}

function toolResultToString(result: ToolCallResult): string {
    if (result === undefined) {
        return '';
    }
    if (typeof result === 'string') {
        return result;
    }
    return formatToolCallContentForModel(result);
}

/** Convert Theia LanguageModelMessage[] → OpenAI Chat Completions messages. */
export function toOpenAiMessages(messages: readonly LanguageModelMessage[]): OpenAiTraceMessage[] {
    const out: OpenAiTraceMessage[] = [];
    for (const message of messages) {
        if (message.type === 'thinking' || message.type === 'server_tool_use' || message.type === 'compaction') {
            continue;
        }
        if (LanguageModelMessage.isTextMessage(message)) {
            const role = message.actor === 'system' ? 'system'
                : message.actor === 'ai' ? 'assistant'
                    : 'user';
            pushMerged(out, { role, content: message.text });
            continue;
        }
        if (LanguageModelMessage.isToolUseMessage(message)) {
            pushMerged(out, {
                role: 'assistant',
                content: null,
                tool_calls: [{
                    id: message.id,
                    type: 'function',
                    function: {
                        name: message.name,
                        arguments: typeof message.input === 'string' ? message.input : JSON.stringify(message.input ?? {})
                    }
                }]
            });
            continue;
        }
        if (LanguageModelMessage.isToolResultMessage(message)) {
            out.push({
                role: 'tool',
                tool_call_id: message.tool_use_id,
                content: toolResultToString(message.content)
            });
        }
    }
    return out;
}

function pushMerged(out: OpenAiTraceMessage[], message: OpenAiTraceMessage): void {
    const prev = out[out.length - 1];
    if (prev?.role === 'assistant' && message.role === 'assistant') {
        const prevContent = typeof prev.content === 'string' ? prev.content : null;
        const nextContent = typeof message.content === 'string' ? message.content : null;
        let content: string | null = prevContent;
        if (prevContent && nextContent) {
            content = `${prevContent}\n${nextContent}`;
        } else if (nextContent) {
            content = nextContent;
        } else if (prevContent) {
            content = prevContent;
        } else {
            content = null;
        }
        const tool_calls = [...(prev.tool_calls ?? []), ...(message.tool_calls ?? [])];
        out[out.length - 1] = {
            role: 'assistant',
            content,
            ...(tool_calls.length ? { tool_calls } : {})
        };
        return;
    }
    out.push(message);
}

export function assistantMessageFromRound(round: AggregatedLlmResponse): OpenAiTraceMessage {
    const tool_calls: OpenAiTraceToolCall[] = [];
    for (const call of round.toolCalls) {
        if (!call.id || !call.function?.name) {
            continue;
        }
        tool_calls.push({
            id: call.id,
            type: 'function',
            function: {
                name: call.function.name,
                arguments: call.function.arguments ?? '{}'
            }
        });
    }
    const content = round.text || null;
    if (tool_calls.length > 0) {
        return { role: 'assistant', content, tool_calls };
    }
    return { role: 'assistant', content: content ?? '' };
}

export function toolMessagesFromRound(round: AggregatedLlmResponse): OpenAiTraceMessage[] {
    const tools: OpenAiTraceMessage[] = [];
    for (const call of round.toolCalls) {
        if (!call.id || toolCallAwaitsResult(call)) {
            continue;
        }
        tools.push({
            role: 'tool',
            tool_call_id: call.id,
            content: toolResultToString(call.result)
        });
    }
    return tools;
}

export function toTraceSteps(request: LanguageModelExchangeRequest): LlmTraceStep[] {
    const lmRequest = request.request;
    const response = request.response;
    let history = toOpenAiMessages(lmRequest.messages);

    if (!('parts' in response) || !Array.isArray(response.parts)) {
        const aggregated = aggregateResponse(response);
        const assistant = assistantMessageFromRound(aggregated);
        return [{
            step: 1,
            requestId: request.id,
            messages: cloneMessages([...history, assistant]),
            metadata: toStepMetadata(request.languageModel, request.metadata.timestamp, aggregated, false)
        }];
    }

    const rounds = splitPartsIntoToolRounds(response.parts);
    const steps: LlmTraceStep[] = [];

    for (let i = 0; i < rounds.length; i++) {
        const aggregated = aggregateParts(rounds[i]);
        const assistant = assistantMessageFromRound(aggregated);
        const reconstructed = i > 0 || rounds.length > 1;
        // Step snapshot = messages sent this round + this round's assistant (see Untitled-1 example).
        steps.push({
            step: i + 1,
            requestId: rounds.length === 1 ? request.id : `${request.id}#${i}`,
            messages: cloneMessages([...history, assistant]),
            metadata: toStepMetadata(request.languageModel, request.metadata.timestamp, aggregated, reconstructed)
        });
        // Next LLM call receives prior history + assistant + tool results.
        history = [...history, assistant, ...toolMessagesFromRound(aggregated)];
    }
    return steps;
}

export function toTraceTurn(sessionId: string, exchange: LanguageModelExchange): LlmTraceTurn {
    const steps = exchange.requests.flatMap(req => toTraceSteps(req))
        .map((step, index) => ({ ...step, step: index + 1 }));
    const timestamps = steps.map(s => s.metadata.timestamp).filter((t): t is number => typeof t === 'number');
    const startedAt = timestamps.length ? Math.min(...timestamps) : undefined;
    const completedAt = timestamps.length ? Math.max(...timestamps) : undefined;
    const agent = exchange.metadata.agent ?? exchange.requests[0]?.metadata.agent;
    return {
        kind: 'turn',
        ts: new Date().toISOString(),
        sessionId,
        turnId: exchange.id,
        agent,
        startedAt,
        completedAt,
        stepCount: steps.length,
        steps
    };
}

export function turnAwaitsMoreLlmRounds(exchange: LanguageModelExchange): boolean {
    if (exchange.requests.length === 0) {
        return true;
    }
    const last = exchange.requests[exchange.requests.length - 1];
    return aggregateResponse(last.response).awaitsToolResults;
}

export function findExchange(sessions: LanguageModelSession[], requestId: string): {
    sessionId: string;
    exchange: LanguageModelExchange;
} | undefined {
    for (const session of sessions) {
        for (const exchange of session.exchanges) {
            if (exchange.requests.some(r => r.id === requestId) || exchange.id === requestId) {
                return { sessionId: session.id, exchange };
            }
        }
    }
    return undefined;
}

export function sessionsToTurns(sessions: LanguageModelSession[]): LlmTraceTurn[] {
    const turns: LlmTraceTurn[] = [];
    for (const session of sessions) {
        for (const exchange of session.exchanges) {
            turns.push(toTraceTurn(session.id, exchange));
        }
    }
    return turns.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}
