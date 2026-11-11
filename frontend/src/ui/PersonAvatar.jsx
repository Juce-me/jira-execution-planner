import React, { useState } from 'react';
import { AVATAR_HOSTS } from './avatarHosts.js';

// Fills an existing person slot (.task-assignee-icon, .epm-project-board-owner-avatar): the
// slot keeps its box and size, only its content changes. Photo when the URL is an allowlisted
// https avatar that has not failed to load, else `children` (the glyph or the initials).
// A failure is learned once per URL in this module-level set, so no per-row state is kept.
const failedAvatarUrls = new Set();

export function isAllowedAvatarUrl(value) {
    if (typeof value !== 'string' || !value) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && AVATAR_HOSTS.includes(url.host);
    } catch (error) {
        return false;
    }
}

export default function PersonAvatar({ avatarUrl, children }) {
    const [, setFailureCount] = useState(0);
    if (!isAllowedAvatarUrl(avatarUrl) || failedAvatarUrls.has(avatarUrl)) return <>{children}</>;
    return (
        <img
            src={avatarUrl}
            alt=""
            width="14"
            height="14"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
                failedAvatarUrls.add(avatarUrl);
                setFailureCount(count => count + 1);
            }}
        />
    );
}

// The leading person mark for sites that had no glyph slot before (Board cards, Planning Table cells): the
// shared `.task-assignee-icon` box with the photo, else the same glyph the ENG rows use.
export function PersonAvatarSlot({ avatarUrl }) {
    return (
        <span className="task-assignee-icon" aria-hidden="true">
            <PersonAvatar avatarUrl={avatarUrl}>
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Z" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M4 20c1.8-4 6-5.5 8-5.5S18.2 16 20 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
            </PersonAvatar>
        </span>
    );
}
