/********************************************************************************
 * Copyright (C) 2026 Cocrates and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import React from '@theia/core/shared/react';

const CONTENT_PREVIEW_CHARS = 160;
const DEFAULT_EXPAND_DEPTH = 2;

export interface JsonTreeProps {
    value: unknown;
    /** Absolute root path for expand-state keys (e.g. `$.steps[1]`). */
    rootPath?: string;
    /** Paths currently expanded / collapsed (`path` open, `!path` closed). */
    expanded: Set<string>;
    /** Paths whose long string values are fully shown. */
    contentExpanded: Set<string>;
    onToggleExpand: (path: string, depth: number) => void;
    onToggleContent: (path: string) => void;
}

export function JsonTreeView(props: JsonTreeProps): React.ReactElement {
    const rootPath = props.rootPath ?? '$';
    return <div className='chat-debug-json-tree'>
        <JsonNode
            name={undefined}
            value={props.value}
            path={rootPath}
            depth={0}
            expanded={props.expanded}
            contentExpanded={props.contentExpanded}
            onToggleExpand={props.onToggleExpand}
            onToggleContent={props.onToggleContent}
        />
    </div>;
}

interface JsonNodeProps {
    name: string | undefined;
    value: unknown;
    path: string;
    depth: number;
    expanded: Set<string>;
    contentExpanded: Set<string>;
    onToggleExpand: (path: string, depth: number) => void;
    onToggleContent: (path: string) => void;
}

function JsonNode(props: JsonNodeProps): React.ReactElement {
    const { name, value, path, depth, expanded, contentExpanded, onToggleExpand, onToggleContent } = props;
    const label = name !== undefined ? <span className='chat-debug-json-key'>{JSON.stringify(name)}</span> : undefined;

    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
        return <div className='chat-debug-json-line' style={{ paddingLeft: depth * 12 }}>
            {label}{label && <span className='chat-debug-json-colon'>: </span>}
            <span className='chat-debug-json-literal'>{JSON.stringify(value)}</span>
        </div>;
    }

    if (typeof value === 'string') {
        const long = value.length > CONTENT_PREVIEW_CHARS;
        const showFull = !long || contentExpanded.has(path);
        const display = showFull ? value : `${value.slice(0, CONTENT_PREVIEW_CHARS)}…`;
        const toggleLabel = name === 'content'
            ? (showFull ? 'collapse content' : `expand content (${value.length} chars)`)
            : (showFull ? 'less' : 'more');
        return <div className='chat-debug-json-line' style={{ paddingLeft: depth * 12 }}>
            {label}{label && <span className='chat-debug-json-colon'>: </span>}
            <span className='chat-debug-json-string'>{JSON.stringify(display)}</span>
            {long && <button
                type='button'
                className='chat-debug-json-toggle'
                onClick={e => { e.stopPropagation(); onToggleContent(path); }}
            >{toggleLabel}</button>}
        </div>;
    }

    if (Array.isArray(value)) {
        const open = isPathOpen(expanded, path, depth);
        return <div className='chat-debug-json-block'>
            <div
                className='chat-debug-json-line chat-debug-json-clickable'
                style={{ paddingLeft: depth * 12 }}
                onClick={() => onToggleExpand(path, depth)}
            >
                <span className='chat-debug-json-twistie'>{open ? '▼' : '▶'}</span>
                {label}{label && <span className='chat-debug-json-colon'>: </span>}
                <span className='chat-debug-json-bracket'>{open ? '[' : `[ ${value.length} items ]`}</span>
            </div>
            {open && value.map((item, index) => <JsonNode
                key={`${path}[${index}]`}
                name={String(index)}
                value={item}
                path={`${path}[${index}]`}
                depth={depth + 1}
                expanded={expanded}
                contentExpanded={contentExpanded}
                onToggleExpand={onToggleExpand}
                onToggleContent={onToggleContent}
            />)}
            {open && <div className='chat-debug-json-line' style={{ paddingLeft: depth * 12 }}>
                <span className='chat-debug-json-bracket'>]</span>
            </div>}
        </div>;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        const open = isPathOpen(expanded, path, depth);
        return <div className='chat-debug-json-block'>
            <div
                className='chat-debug-json-line chat-debug-json-clickable'
                style={{ paddingLeft: depth * 12 }}
                onClick={() => onToggleExpand(path, depth)}
            >
                <span className='chat-debug-json-twistie'>{open ? '▼' : '▶'}</span>
                {label}{label && <span className='chat-debug-json-colon'>: </span>}
                <span className='chat-debug-json-bracket'>{open ? '{' : `{ ${entries.length} keys }`}</span>
            </div>
            {open && entries.map(([key, child]) => <JsonNode
                key={`${path}.${key}`}
                name={key}
                value={child}
                path={`${path}.${key}`}
                depth={depth + 1}
                expanded={expanded}
                contentExpanded={contentExpanded}
                onToggleExpand={onToggleExpand}
                onToggleContent={onToggleContent}
            />)}
            {open && <div className='chat-debug-json-line' style={{ paddingLeft: depth * 12 }}>
                <span className='chat-debug-json-bracket'>{'}'}</span>
            </div>}
        </div>;
    }

    return <div className='chat-debug-json-line' style={{ paddingLeft: depth * 12 }}>
        {label}{label && <span className='chat-debug-json-colon'>: </span>}
        <span className='chat-debug-json-literal'>{String(value)}</span>
    </div>;
}

/** Default: expand up to DEFAULT_EXPAND_DEPTH; `path` / `!path` override. */
export function isPathOpen(expanded: Set<string>, path: string, depth: number): boolean {
    if (expanded.has(`!${path}`)) {
        return false;
    }
    if (expanded.has(path)) {
        return true;
    }
    return depth < DEFAULT_EXPAND_DEPTH;
}

export function togglePathExpand(expanded: Set<string>, path: string, depth: number): Set<string> {
    const next = new Set(expanded);
    const currentlyOpen = isPathOpen(expanded, path, depth);
    next.delete(path);
    next.delete(`!${path}`);
    if (currentlyOpen) {
        next.add(`!${path}`);
    } else {
        next.add(path);
    }
    return next;
}
