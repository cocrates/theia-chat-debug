/********************************************************************************
 * Copyright (C) 2026 Cocrates and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { LanguageModelService, SessionEvent } from '@theia/ai-core';
import { LanguageModelSession } from '@theia/ai-core/lib/common/language-model-interaction-model';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { DisposableCollection, ILogger, URI } from '@theia/core';
import { inject, injectable, named, postConstruct } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import {
    CHAT_DEBUG_LLM_TRACE_ENABLED,
    CHAT_DEBUG_LLM_TRACE_WRITE_TO_DISK,
    CHAT_DEBUG_LLM_TRACE_WRITE_TO_OUTPUT
} from '../common/llm-trace-preferences';
import {
    findExchange,
    LlmTraceTurn,
    sessionsToTurns,
    toTraceTurn,
    turnAwaitsMoreLlmRounds
} from '../common/llm-trace-model';
import { safeJsonStringify } from '../common/llm-trace-redact';

export const LLM_TRACE_OUTPUT_CHANNEL = 'LLM Trace';

/** Legacy Cocrates preference keys (read when the chatDebug.* value is unset). */
const LEGACY_LLM_TRACE_ENABLED = 'cocrates.llmTrace.enabled';
const LEGACY_LLM_TRACE_WRITE_TO_DISK = 'cocrates.llmTrace.writeToDisk';
const LEGACY_LLM_TRACE_WRITE_TO_OUTPUT = 'cocrates.llmTrace.writeToOutput';

@injectable()
export class LlmTraceService implements FrontendApplicationContribution {

    @inject(LanguageModelService)
    protected readonly languageModelService: LanguageModelService;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(EnvVariablesServer)
    protected readonly envVariablesServer: EnvVariablesServer;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(OutputChannelManager)
    protected readonly outputChannelManager: OutputChannelManager;

    @inject(ILogger) @named('theia-chat-debug:LlmTraceService')
    protected readonly logger: ILogger;

    protected readonly toDispose = new DisposableCollection();
    protected writeQueue: Promise<void> = Promise.resolve();
    /** `${sessionId}:${turnId}` already written to disk. */
    protected readonly flushedTurns = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.languageModelService.onSessionChanged(event => {
            void this.onSessionEvent(event);
        }));
    }

    onStop(): void {
        this.toDispose.dispose();
    }

    async getTodayLogFileUri(): Promise<URI> {
        const dir = await this.getTraceDirUri();
        const day = new Date().toISOString().slice(0, 10);
        return dir.resolve(`${day}.jsonl`);
    }

    async getTraceDirUri(): Promise<URI> {
        const configDirUri = await this.envVariablesServer.getConfigDirUri();
        return new URI(configDirUri).resolve('logs').resolve('llm-trace');
    }

    getSessionsSnapshot(): LanguageModelSession[] {
        return this.languageModelService.sessions;
    }

    getTurnsSnapshot(): LlmTraceTurn[] {
        return sessionsToTurns(this.languageModelService.sessions);
    }

    protected async onSessionEvent(event: SessionEvent): Promise<void> {
        if (!this.getTracePref(CHAT_DEBUG_LLM_TRACE_ENABLED, LEGACY_LLM_TRACE_ENABLED, true)) {
            return;
        }
        if (event.type === 'sessionsCleared') {
            this.flushedTurns.clear();
            this.appendOutput('sessionsCleared');
            return;
        }

        const requestId = event.type === 'requestAdded' ? event.id
            : event.type === 'responseCompleted' ? event.requestId
                : undefined;
        if (!requestId) {
            return;
        }

        const located = findExchange(this.languageModelService.sessions, requestId);
        if (!located) {
            return;
        }

        // Stream responses: wait until responseCompleted so parts are fully aggregated.
        // Non-stream responses only emit requestAdded — flush when the turn is complete.
        if (event.type === 'requestAdded') {
            const last = located.exchange.requests[located.exchange.requests.length - 1];
            if (last && 'parts' in last.response) {
                return;
            }
        }

        if (turnAwaitsMoreLlmRounds(located.exchange)) {
            if (this.getTracePref(CHAT_DEBUG_LLM_TRACE_WRITE_TO_OUTPUT, LEGACY_LLM_TRACE_WRITE_TO_OUTPUT, true)) {
                this.appendOutput(
                    `[turn pending] turnId=${located.exchange.id} steps=${located.exchange.requests.length} (awaiting tool results)`
                );
            }
            return;
        }

        await this.flushTurn(located.sessionId, located.exchange.id);
    }

    /** Prefer chatDebug.* when set; otherwise fall back to legacy cocrates.llmTrace.*. */
    protected getTracePref(primary: string, legacy: string, defaultValue: boolean): boolean {
        const inspected = this.preferences.inspect<boolean>(primary);
        if (inspected && (
            inspected.globalValue !== undefined
            || inspected.workspaceValue !== undefined
            || inspected.workspaceFolderValue !== undefined
        )) {
            return this.preferences.get(primary, defaultValue);
        }
        return this.preferences.get(legacy, this.preferences.get(primary, defaultValue));
    }

    protected async flushTurn(sessionId: string, turnId: string): Promise<void> {
        const key = `${sessionId}:${turnId}`;
        if (this.flushedTurns.has(key)) {
            return;
        }
        const session = this.languageModelService.sessions.find(s => s.id === sessionId);
        const exchange = session?.exchanges.find(e => e.id === turnId);
        if (!exchange || exchange.requests.length === 0) {
            return;
        }
        if (turnAwaitsMoreLlmRounds(exchange)) {
            return;
        }

        this.flushedTurns.add(key);
        const turn = toTraceTurn(sessionId, exchange);
        const line = safeJsonStringify(turn);

        if (this.getTracePref(CHAT_DEBUG_LLM_TRACE_WRITE_TO_OUTPUT, LEGACY_LLM_TRACE_WRITE_TO_OUTPUT, true)) {
            const last = turn.steps[turn.steps.length - 1];
            const lastAssistant = [...(last?.messages ?? [])].reverse().find(m => m.role === 'assistant');
            const lastText = typeof lastAssistant?.content === 'string' ? lastAssistant.content : '';
            const usage = last?.metadata.usage;
            const usageLabel = usage
                ? ` in=${usage.input_tokens} out=${usage.output_tokens}` +
                (usage.cache_read_input_tokens !== undefined ? ` cacheRead=${usage.cache_read_input_tokens}` : '')
                : '';
            this.appendOutput(
                `[turn] agent=${turn.agent ?? '?'} turnId=${turn.turnId} steps=${turn.stepCount} ` +
                `textChars=${lastText.length}${usageLabel}`
            );
        }

        if (this.getTracePref(CHAT_DEBUG_LLM_TRACE_WRITE_TO_DISK, LEGACY_LLM_TRACE_WRITE_TO_DISK, true)) {
            this.writeQueue = this.writeQueue.then(() => this.appendJsonl(line)).catch(err => {
                this.flushedTurns.delete(key);
                this.logger.error('Failed to write LLM trace turn JSONL', err);
            });
            await this.writeQueue;
        }
    }

    protected appendOutput(message: string): void {
        try {
            this.outputChannelManager.getChannel(LLM_TRACE_OUTPUT_CHANNEL).appendLine(message);
        } catch (error) {
            this.logger.warn('Could not write to LLM Trace output channel', error);
        }
    }

    protected async appendJsonl(line: string): Promise<void> {
        const fileUri = await this.getTodayLogFileUri();
        const dirUri = fileUri.parent;
        if (!(await this.fileService.exists(dirUri))) {
            await this.fileService.createFolder(dirUri);
        }
        let existing = '';
        if (await this.fileService.exists(fileUri)) {
            existing = (await this.fileService.read(fileUri)).value;
            if (existing.length && !existing.endsWith('\n')) {
                existing += '\n';
            }
        }
        await this.fileService.writeFile(fileUri, BinaryBuffer.fromString(`${existing}${line}\n`));
    }
}
