const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderAlertsPanel } = require('./share_view_alert_panel_fixture.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngAlertsPanel.jsx'), 'utf8');

test('source: every alert team group carries data-alert-team, and only the future-routed Epic groups carry data-alert-kind', () => {
    const tags = source.match(/<div\b[^>]*className="alert-team-group"[^>]*>/g) || [];
    assert.equal(tags.length, 11);
    for (const tag of tags) assert.match(tag, /data-alert-team=\{group\.id\}/);
    const epicTags = tags.filter(tag => tag.includes('data-alert-kind'));
    assert.equal(epicTags.length, 1);
    assert.match(epicTags[0], /key=\{`future-epic-\$\{group\.id\}`\}/);
    assert.match(epicTags[0], /data-alert-kind="epic"/);
});

test('rendered: each card holds its groups by Team id, Epic groups say so, and a hostile id stays inside its attribute', () => {
    const hostile = 'x"] .alert-card [a="';
    const html = renderAlertsPanel({ ids: { emptyEpicTeams: hostile } });
    const cards = html.split(/(?=<div class="alert-card )/).slice(1);
    const groupsByCard = Object.fromEntries(cards.map((card) => {
        const cardId = card.match(/ id="(eng-alert-[a-z-]+)"/)[1];
        const groups = Array.from(card.matchAll(/<div class="alert-team-group"((?: data-[a-z-]+="[^"]*")*)>/g), (match) => ({
            team: match[1].match(/data-alert-team="([^"]*)"/)?.[1].replaceAll('&quot;', '"'),
            kind: match[1].match(/data-alert-kind="([^"]*)"/)?.[1],
        }));
        return [cardId, groups];
    }));
    assert.deepEqual(groupsByCard, {
        'eng-alert-missing': [{ team: 't1', kind: undefined }],
        'eng-alert-blocked': [{ team: 't2', kind: undefined }],
        'eng-alert-followup': [{ team: 't3', kind: undefined }, { team: 't3', kind: 'epic' }],
        'eng-alert-backlog': [{ team: 't4', kind: undefined }],
        'eng-alert-missing-team': [{ team: 't5', kind: undefined }],
        'eng-alert-missing-labels': [{ team: 't6', kind: undefined }],
        'eng-alert-needs-stories': [{ team: 't7', kind: undefined }],
        'eng-alert-waiting': [{ team: 't8', kind: undefined }],
        'eng-alert-empty': [{ team: hostile, kind: undefined }],
        'eng-alert-done': [{ team: 't10', kind: undefined }],
    });
});
