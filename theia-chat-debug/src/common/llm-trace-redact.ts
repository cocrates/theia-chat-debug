/********************************************************************************
 * Copyright (C) 2026 Cocrates and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

const SENSITIVE_PATTERNS: RegExp[] = [
    /\b(sk-[A-Za-z0-9_-]{10,})\b/g,
    /\b(AIza[0-9A-Za-z_-]{20,})\b/g,
    /\b(Bearer\s+)[A-Za-z0-9._\-+=/]{8,}/gi,
    /("?(?:api[_-]?key|apiKey|access[_-]?token|authorization)"?\s*[:=]\s*")([^"]{6,})(")/gi,
];

/**
 * Best-effort redaction of common secret patterns in a JSON string.
 */
export function redactSecrets(text: string): string {
    let result = text;
    for (const pattern of SENSITIVE_PATTERNS) {
        result = result.replace(pattern, (match, ...groups: string[]) => {
            if (groups.length >= 3 && typeof groups[0] === 'string' && groups[0].toLowerCase().includes('bearer')) {
                return `${groups[0]}***REDACTED***`;
            }
            if (groups.length >= 3 && groups[2] === '"') {
                return `${groups[0]}***REDACTED***${groups[2]}`;
            }
            return '***REDACTED***';
        });
    }
    return result;
}

export function safeJsonStringify(value: unknown, space?: number): string {
    try {
        return redactSecrets(JSON.stringify(value, getCircularReplacer(), space));
    } catch (error) {
        return redactSecrets(JSON.stringify({ error: String(error) }));
    }
}

function getCircularReplacer(): (key: string, value: unknown) => unknown {
    const seen = new WeakSet<object>();
    return (_key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular]';
            }
            seen.add(value);
        }
        return value;
    };
}
