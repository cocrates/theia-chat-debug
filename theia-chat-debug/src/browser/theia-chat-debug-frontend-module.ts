/********************************************************************************
 * Copyright (C) 2026 Cocrates and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import '../../src/browser/style/chat-debug.css';

import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core';
import { ContainerModule } from '@theia/core/shared/inversify';
import { chatDebugLlmTracePreferenceSchema } from '../common/llm-trace-preferences';
import { ChatDebugContribution } from './chat-debug-contribution';
import { ChatDebugWidget } from './chat-debug-widget';
import { LlmTraceService } from './llm-trace-service';

export default new ContainerModule(bind => {
    bind(PreferenceContribution).toConstantValue({ schema: chatDebugLlmTracePreferenceSchema });

    bind(LlmTraceService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(LlmTraceService);

    bindViewContribution(bind, ChatDebugContribution);
    bind(ChatDebugWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ChatDebugWidget.ID,
        createWidget: () => ctx.container.get<ChatDebugWidget>(ChatDebugWidget)
    })).inSingletonScope();
});
