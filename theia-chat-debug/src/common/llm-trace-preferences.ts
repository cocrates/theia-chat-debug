/********************************************************************************
 * Copyright (C) 2026 Cocrates and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { PreferenceSchema } from '@theia/core/lib/common/preferences/preference-schema';

export const CHAT_DEBUG_LLM_TRACE_ENABLED = 'chatDebug.llmTrace.enabled';
export const CHAT_DEBUG_LLM_TRACE_WRITE_TO_DISK = 'chatDebug.llmTrace.writeToDisk';
export const CHAT_DEBUG_LLM_TRACE_WRITE_TO_OUTPUT = 'chatDebug.llmTrace.writeToOutput';

export const chatDebugLlmTracePreferenceSchema: PreferenceSchema = {
    properties: {
        [CHAT_DEBUG_LLM_TRACE_ENABLED]: {
            type: 'boolean',
            default: true,
            description: 'Enable LLM request/response tracing (disk and/or Output channel).'
        },
        [CHAT_DEBUG_LLM_TRACE_WRITE_TO_DISK]: {
            type: 'boolean',
            default: true,
            description: 'Write LLM trace events as JSON Lines under <configDir>/logs/llm-trace/.'
        },
        [CHAT_DEBUG_LLM_TRACE_WRITE_TO_OUTPUT]: {
            type: 'boolean',
            default: true,
            description: 'Append LLM trace summaries to the "LLM Trace" Output channel.'
        }
    }
};
