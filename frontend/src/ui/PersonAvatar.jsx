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
