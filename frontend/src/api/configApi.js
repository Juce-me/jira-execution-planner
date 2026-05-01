import { getJson } from './http.js';

export const fetchAppConfig = (backendUrl) =>
    getJson(`${backendUrl}/api/config`, 'Config');

export const fetchVersionInfo = (backendUrl) =>
    getJson(`${backendUrl}/api/version`, 'Version', { cache: 'no-cache' });

export const testJiraConnection = (backendUrl) =>
    fetch(`${backendUrl}/api/test`);

export const fetchGroupsConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/groups-config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveGroupsConfig = (backendUrl, payload) =>
    fetch(`${backendUrl}/api/groups-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

export const fetchSelectedProjects = (backendUrl) =>
    fetch(`${backendUrl}/api/projects/selected`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveSelectedProjects = (backendUrl, selected) =>
    fetch(`${backendUrl}/api/projects/selected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected })
    });

export const fetchBoardConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/board-config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveBoardConfig = (backendUrl, payload) =>
    fetch(`${backendUrl}/api/board-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

export const fetchPriorityWeightsConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/stats/priority-weights-config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const savePriorityWeightsConfig = (backendUrl, weights) =>
    fetch(`${backendUrl}/api/stats/priority-weights-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights })
    });

export const fetchCapacityConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/capacity/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveCapacityConfig = (backendUrl, payload) =>
    fetch(`${backendUrl}/api/capacity/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

export const fetchFieldConfig = (backendUrl, endpoint) =>
    fetch(`${backendUrl}/api/${endpoint}/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveFieldConfig = (backendUrl, endpoint, payload) =>
    fetch(`${backendUrl}/api/${endpoint}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

export const fetchIssueTypesConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/issue-types/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });

export const saveIssueTypesConfig = (backendUrl, issueTypes) =>
    fetch(`${backendUrl}/api/issue-types/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueTypes })
    });

export const fetchAvailableIssueTypes = (backendUrl) =>
    fetch(`${backendUrl}/api/issue-types`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache'
    });
