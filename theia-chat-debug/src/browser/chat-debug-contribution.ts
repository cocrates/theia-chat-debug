/********************************************************************************
 * Copyright (C) 2026 Cocrates and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { AIViewContribution } from '@theia/ai-core/lib/browser';
import { Command, CommandRegistry, URI } from '@theia/core';
import { OpenerService, open } from '@theia/core/lib/browser';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileDialogService, SaveFileDialogProps } from '@theia/filesystem/lib/browser/file-dialog';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ChatDebugWidget } from './chat-debug-widget';
import { LlmTraceService } from './llm-trace-service';
import { safeJsonStringify } from '../common/llm-trace-redact';

export const CHAT_DEBUG_TOGGLE = 'chatDebug.toggle';

export const OPEN_CHAT_DEBUG = Command.toLocalizedCommand({
    id: 'chatDebug.open',
    label: 'Chat Debug: Open',
});

export const REVEAL_LLM_TRACE_LOG = Command.toLocalizedCommand({
    id: 'chatDebug.llmTrace.revealLog',
    label: 'Chat Debug: Reveal LLM Trace Log',
});

export const EXPORT_LLM_TRACE = Command.toLocalizedCommand({
    id: 'chatDebug.llmTrace.exportJson',
    label: 'Chat Debug: Export LLM Trace JSON',
});

@injectable()
export class ChatDebugContribution extends AIViewContribution<ChatDebugWidget> {

    @inject(LlmTraceService)
    protected readonly traceService: LlmTraceService;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(FileDialogService)
    protected readonly fileDialogService: FileDialogService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    constructor() {
        super({
            widgetId: ChatDebugWidget.ID,
            widgetName: ChatDebugWidget.LABEL,
            defaultWidgetOptions: {
                area: 'bottom',
                rank: 110
            },
            toggleCommandId: CHAT_DEBUG_TOGGLE,
        });
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand(OPEN_CHAT_DEBUG, this.commandHandlerFactory({
            execute: () => this.openView({ activate: true, reveal: true }),
        }));
        commands.registerCommand(REVEAL_LLM_TRACE_LOG, this.commandHandlerFactory({
            execute: () => this.revealTraceLog(),
        }));
        commands.registerCommand(EXPORT_LLM_TRACE, this.commandHandlerFactory({
            execute: () => this.exportTraceJson(),
        }));
    }

    protected async revealTraceLog(): Promise<void> {
        const fileUri = await this.traceService.getTodayLogFileUri();
        if (!(await this.fileService.exists(fileUri))) {
            const dir = await this.traceService.getTraceDirUri();
            if (!(await this.fileService.exists(dir))) {
                await this.fileService.createFolder(dir);
            }
            await open(this.openerService, dir);
            return;
        }
        await open(this.openerService, fileUri);
    }

    protected async exportTraceJson(): Promise<void> {
        const turns = this.traceService.getTurnsSnapshot();
        const content = safeJsonStringify({
            exportedAt: new Date().toISOString(),
            kind: 'llm-trace-turns',
            turns
        }, 2);
        const props: SaveFileDialogProps = {
            title: 'Export LLM Trace JSON',
            inputValue: `llm-trace-${new Date().toISOString().slice(0, 10)}.json`
        };
        let target: URI | undefined;
        const root = this.workspaceService.tryGetRoots()[0];
        if (root) {
            target = await this.fileDialogService.showSaveDialog(props, root);
        } else {
            target = await this.fileDialogService.showSaveDialog(props);
        }
        if (!target) {
            return;
        }
        await this.fileService.writeFile(target, BinaryBuffer.fromString(content));
        await open(this.openerService, target);
    }
}
