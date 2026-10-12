/********************************************************************************
 * Copyright (C) 2026 Cocrates and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { LanguageModelService, SessionEvent } from '@theia/ai-core';
import { codicon, ReactWidget } from '@theia/core/lib/browser';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import React from '@theia/core/shared/react';
import { LlmTraceStep, LlmTraceTurn, sessionsToTurns } from '../common/llm-trace-model';
import { JsonTreeView, togglePathExpand } from './chat-debug-json';

@injectable()
export class ChatDebugWidget extends ReactWidget {

    static readonly ID = 'theia-chat-debug';
    static readonly LABEL = 'Chat Debug';

    @inject(LanguageModelService)
    protected readonly languageModelService: LanguageModelService;

    protected selectedTurnId?: string;
    protected expandedPaths = new Set<string>();
    protected contentExpandedPaths = new Set<string>();

    constructor() {
        super();
        this.id = ChatDebugWidget.ID;
        this.title.label = ChatDebugWidget.LABEL;
        this.title.caption = 'LLM turn inspector (OpenAI-style messages)';
        this.title.closable = true;
        this.title.iconClass = codicon('debug-console');
        this.addClass('theia-chat-debug');
    }

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.languageModelService.onSessionChanged((_e: SessionEvent) => this.update()));
        this.update();
    }

    protected getTurns(): LlmTraceTurn[] {
        return sessionsToTurns(this.languageModelService.sessions);
    }

    protected toggleExpand = (path: string, depth: number): void => {
        this.expandedPaths = togglePathExpand(this.expandedPaths, path, depth);
        this.update();
    };

    protected toggleContent = (path: string): void => {
        const next = new Set(this.contentExpandedPaths);
        if (next.has(path)) {
            next.delete(path);
        } else {
            next.add(path);
        }
        this.contentExpandedPaths = next;
        this.update();
    };

    protected formatUsage(step: LlmTraceStep): string {
        const u = step.metadata.usage;
        if (!u) {
            return 'usage=?';
        }
        const parts = [`in=${u.input_tokens}`, `out=${u.output_tokens}`];
        if (u.cache_read_input_tokens !== undefined) {
            parts.push(`cacheRead=${u.cache_read_input_tokens}`);
        }
        if (u.cache_creation_input_tokens !== undefined) {
            parts.push(`cacheCreate=${u.cache_creation_input_tokens}`);
        }
        return parts.join(' ');
    }

    protected render(): React.ReactNode {
        const turns = this.getTurns();
        const selected = turns.find(t => t.turnId === this.selectedTurnId) ?? turns[0];
        return <div className='chat-debug-root'>
            <div className='chat-debug-list'>
                <div className='chat-debug-header'>Turns ({turns.length})</div>
                {turns.length === 0 && <div className='chat-debug-empty'>No turns yet. Send a chat message.</div>}
                {turns.map(turn => {
                    const ts = turn.startedAt ? new Date(turn.startedAt).toLocaleTimeString() : '';
                    const label = `${ts} ${turn.agent ?? '?'} · ${turn.stepCount} step(s)`;
                    const active = selected?.turnId === turn.turnId;
                    return <div
                        key={turn.turnId}
                        className={`chat-debug-item${active ? ' active' : ''}`}
                        onClick={() => { this.selectedTurnId = turn.turnId; this.update(); }}
                    >{label}</div>;
                })}
            </div>
            <div className='chat-debug-detail'>
                {!selected && <div className='chat-debug-empty'>Select a turn</div>}
                {selected && <>
                    <div className='chat-debug-header'>
                        Turn {selected.turnId.slice(0, 8)}… · agent={selected.agent ?? '?'} · steps={selected.stepCount}
                    </div>
                    {selected.steps.map(step => {
                        const payload = {
                            step: step.step,
                            messages: step.messages,
                            metadata: step.metadata
                        };
                        return <div key={step.requestId} className='chat-debug-step'>
                            <div className='chat-debug-header'>
                                Step {step.step} · {step.metadata.languageModel}
                                {step.metadata.reconstructed ? ' · reconstructed' : ''}
                                {' · '}{this.formatUsage(step)}
                            </div>
                            <JsonTreeView
                                value={payload}
                                rootPath={`$step${step.step}`}
                                expanded={this.expandedPaths}
                                contentExpanded={this.contentExpandedPaths}
                                onToggleExpand={this.toggleExpand}
                                onToggleContent={this.toggleContent}
                            />
                        </div>;
                    })}
                </>}
            </div>
        </div>;
    }
}
