#!/usr/bin/env python3
"""Validate a sanitized ENG Board diagnostic result and print one verdict line."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
from urllib.parse import urlparse
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener


SCHEMA_VERSION = 2
PROFILES = (
    'legacy_selected_sprint', 'candidate_selected_sprint', 'candidate_all_work',
    'candidate_team_fallback_selected_sprint',
)
ROUND_PROFILE_ORDER = (
    PROFILES,
    PROFILES[1:] + PROFILES[:1],
    PROFILES[2:] + PROFILES[:2],
    PROFILES[3:] + PROFILES[:3],
    (PROFILES[0], PROFILES[3], PROFILES[2], PROFILES[1]),
)
STOP_CODES = {
    'oauth_unavailable', 'csrf_unavailable', 'invalid_scope', 'invalid_campaign',
    'campaign_busy', 'campaign_expired', 'user_aborted', 'configuration_drift',
    'membership_drift', 'content_drift', 'cache_miss', 'rate_limited',
    'breaker_contaminated', 'scope_ceiling', 'candidate_incomplete', 'jira_rejected',
    'storage_unavailable', 'memory_sample_unavailable', 'unrepresentative_scope',
    'sensitive_output', 'sample_deadline', 'deadline_bound_unproven',
}
PHASES = {'preflight', 'auth', 'config', 'reserve', 'cache', 'catalog', 'index',
          'qualification', 'bootstrap', 'remaining', 'shape', 'body', 'finish', 'cleanup'}
LIMITS = {'none', 'epics', 'children', 'pages', 'batches', 'url_bytes',
          'candidate_cache_bytes', 'metadata_cache_bytes', 'deadline', 'memory'}
BUCKETS = {'unknown', 'zero', 'below_80', 'near_limit', 'at_limit', 'over_limit'}
STAGE_KEYS = ('config', 'cache', 'epicIndex', 'sprintMembership', 'bootstrapChildren',
              'remainingChildren', 'shape', 'total')
COUNTER_KEYS = ('jiraLogicalRequestCount', 'jiraCatalogCallCount', 'jiraSearchCallCount',
                'jiraPageCount', 'jiraBatchCount', 'jiraAttemptCount', 'jiraRetryCount',
                'jiraFailureAttemptCount', 'jiraRateLimitCount', 'jiraFastFailCount',
                'jiraRetrySleepMs', 'jiraRetryAfterMs', 'jiraResponseBytes',
                'jiraFailedResponseBytes', 'oauthRefreshCount', 'oauthAttemptCount',
                'oauthRetryCount', 'oauthRateLimitCount')
METRIC_KEYS = (
    'wallMs', 'indexReadyMs', 'bootstrapColumnReadyMs', 'fullReadyMs', 'stageMs',
    'serverTimingMs', 'candidateEpicCount', 'epicCount', 'fetchedChildCount', 'childCount',
    'bootstrapChildCount', 'productChildCount', 'techChildCount', 'otherChildCount',
    'projectCount', 'componentCount', 'teamCount', 'columnCount', 'terminalEpicCount',
    'unmappedEpicCount', 'emptyEpicCount', 'maxPagesPerSearch', 'maxBatchesPerColumn',
    *COUNTER_KEYS, 'shapedResponseBytes', 'candidateCacheBytes', 'metadataCacheBytes',
    'maxBatchSize', 'maxConcurrency', 'maxEncodedRequestBytes', 'memoryPeakDeltaBytes',
    'memoryRetainedDeltaBytes', 'metricAvailability', 'legacyCapped', 'legacyDenominator',
    'complete', 'membershipStable', 'contentStable', 'ceilingHeadroomLow',
)
SAMPLE_KEYS = {'profile', 'cacheIntent', 'candidateCacheState', 'metadataCacheState',
               'result', 'metrics'}
STOP_CONTEXT_KEYS = {'round', 'step', 'profile', 'phase', 'limit', 'observedBucket',
                     'elapsedMs', 'jiraAttemptCount', 'jiraRetryCount', 'jiraRateLimitCount',
                     'jiraRetrySleepMs', 'jiraFailedResponseBytes', 'jiraFastFailCount',
                     'oauthAttemptCount', 'oauthRateLimitCount'}
SENSITIVE_FRAGMENTS = ('campaignid', 'groupid', 'teamids', 'teamlabels', 'jql', 'url',
                       'header', 'token', 'secret', 'credential', 'issuekey', 'cloudid',
                       'workspaceid', 'userid', 'connectionid')


class InvalidDocument(ValueError):
    pass


class SensitiveDocument(ValueError):
    pass


def empty_stop_context():
    return {'round': 0, 'step': -1, 'profile': 'none', 'phase': 'preflight', 'limit': 'none',
            'observedBucket': 'unknown', 'elapsedMs': None, 'jiraAttemptCount': None,
            'jiraRetryCount': None, 'jiraRateLimitCount': None, 'jiraRetrySleepMs': None,
            'jiraFailedResponseBytes': None, 'jiraFastFailCount': None,
            'oauthAttemptCount': None, 'oauthRateLimitCount': None}


def _keys(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise InvalidDocument('closed schema mismatch')


def _number(value, *, integer=False, nullable=False):
    if nullable and value is None:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise InvalidDocument('invalid numeric value')
    if integer and not isinstance(value, int):
        raise InvalidDocument('integer required')


def _scan_sensitive(value, key=''):
    normalized = key.replace('_', '').lower()
    if any(fragment in normalized for fragment in SENSITIVE_FRAGMENTS):
        raise SensitiveDocument('sensitive key')
    if isinstance(value, dict):
        for child_key, child in value.items():
            _scan_sensitive(child, str(child_key))
    elif isinstance(value, list):
        for child in value:
            _scan_sensitive(child)
    elif isinstance(value, str):
        lower = value.lower()
        if '://' in lower or 'bearer ' in lower or 'atlassian.net' in lower:
            raise SensitiveDocument('sensitive value')


def _validate_stop(document):
    _keys(document, {'schemaVersion', 'result', 'stopCode', 'context', 'rounds'})
    if document['rounds'] != [] or document['stopCode'] not in STOP_CODES:
        raise InvalidDocument('invalid stop')
    context = document['context']
    _keys(context, STOP_CONTEXT_KEYS)
    if context['phase'] not in PHASES or context['limit'] not in LIMITS or context['observedBucket'] not in BUCKETS:
        raise InvalidDocument('invalid stop context')
    for key in STOP_CONTEXT_KEYS - {'profile', 'phase', 'limit', 'observedBucket', 'step'}:
        _number(context[key], integer=key not in {'elapsedMs', 'jiraRetrySleepMs'}, nullable=True)
    if isinstance(context['step'], bool) or not isinstance(context['step'], int):
        raise InvalidDocument('invalid step')
    if context['step'] == -1:
        if context['round'] != 0 or context['profile'] != 'none':
            raise InvalidDocument('invalid preflight context')
    elif not (0 <= context['step'] < 40):
        raise InvalidDocument('invalid step')
    else:
        expected_round = context['step'] // 8 + 1
        pair = (context['step'] % 8) // 2
        expected_profile = ROUND_PROFILE_ORDER[expected_round - 1][pair]
        if context['round'] != expected_round or context['profile'] != expected_profile:
            raise InvalidDocument('stop sequence mismatch')
    return ('FAIL ' if document['stopCode'] == 'sample_deadline' else 'STOP ') + document['stopCode']


def _validate_candidate(metrics, cache_intent, cold):
    for key in METRIC_KEYS:
        if key in {'stageMs', 'serverTimingMs', 'metricAvailability', 'legacyCapped',
                   'legacyDenominator', 'complete', 'membershipStable', 'contentStable',
                   'ceilingHeadroomLow'}:
            continue
        _number(metrics[key], integer=key not in {'wallMs', 'indexReadyMs', 'bootstrapColumnReadyMs',
                                                  'fullReadyMs', 'jiraRetrySleepMs', 'jiraRetryAfterMs'})
    for stage_key in ('stageMs', 'serverTimingMs'):
        _keys(metrics[stage_key], STAGE_KEYS)
        for value in metrics[stage_key].values():
            _number(value)
    if metrics['metricAvailability'] != 'complete' or metrics['legacyCapped'] is not False or metrics['legacyDenominator'] is not None:
        raise InvalidDocument('candidate ownership mismatch')
    if any(metrics[key] is not True for key in ('complete', 'membershipStable', 'contentStable')):
        raise InvalidDocument('candidate incomplete')
    if metrics['otherChildCount'] != 0:
        raise InvalidDocument('unexpected project classification')
    if not (metrics['epicCount'] <= metrics['candidateEpicCount'] <= 1000):
        raise InvalidDocument('epic bounds')
    if not (metrics['bootstrapChildCount'] <= metrics['childCount'] <= metrics['fetchedChildCount'] <= 10000):
        raise InvalidDocument('child bounds')
    if metrics['productChildCount'] + metrics['techChildCount'] != metrics['childCount']:
        raise InvalidDocument('child equation')
    if any(metrics[key] > metrics['epicCount'] for key in ('terminalEpicCount', 'unmappedEpicCount', 'emptyEpicCount')):
        raise InvalidDocument('epic subset')
    if metrics['maxConcurrency'] > 2 or metrics['maxBatchSize'] > 40 or metrics['maxEncodedRequestBytes'] > 7000:
        raise InvalidDocument('operational ceiling')
    if metrics['maxPagesPerSearch'] > 101 or metrics['jiraPageCount'] > 2600:
        raise InvalidDocument('paging ceiling')
    if metrics['jiraCatalogCallCount'] + metrics['jiraSearchCallCount'] != metrics['jiraLogicalRequestCount']:
        raise InvalidDocument('logical equation')
    if metrics['jiraAttemptCount'] != metrics['jiraLogicalRequestCount'] - metrics['jiraFastFailCount'] + metrics['jiraRetryCount']:
        raise InvalidDocument('attempt equation')
    if not (metrics['jiraRateLimitCount'] <= metrics['jiraFailureAttemptCount'] <= metrics['jiraAttemptCount']):
        raise InvalidDocument('failure equation')
    if metrics['jiraFailedResponseBytes'] > metrics['jiraResponseBytes']:
        raise InvalidDocument('byte equation')
    if metrics['memoryRetainedDeltaBytes'] > metrics['memoryPeakDeltaBytes']:
        raise InvalidDocument('memory equation')
    if not (metrics['maxBatchesPerColumn'] <= metrics['jiraBatchCount'] <= metrics['jiraSearchCallCount'] and
            metrics['maxPagesPerSearch'] <= metrics['jiraPageCount'] and
            metrics['maxConcurrency'] <= min(2, metrics['jiraBatchCount'])):
        raise InvalidDocument('batch equation')
    if (metrics['maxBatchSize'] > 0) is not (metrics['jiraBatchCount'] > 0):
        raise InvalidDocument('batch size ownership')
    if metrics['candidateCacheBytes'] > 32 * 1024 * 1024 or metrics['metadataCacheBytes'] > 2 * 1024 * 1024:
        raise InvalidDocument('cache ceiling')
    if metrics['ceilingHeadroomLow'] is not (metrics['candidateEpicCount'] >= 800 or metrics['fetchedChildCount'] >= 8000):
        raise InvalidDocument('headroom mismatch')
    if not (metrics['indexReadyMs'] <= metrics['bootstrapColumnReadyMs'] <= metrics['fullReadyMs'] <= metrics['stageMs']['total'] <= metrics['wallMs'] + 1):
        raise InvalidDocument('timing order')
    if abs(sum(metrics['stageMs'][key] for key in STAGE_KEYS if key != 'total') - metrics['stageMs']['total']) > 1:
        raise InvalidDocument('stage equation')
    for key in STAGE_KEYS:
        if abs(metrics['stageMs'][key] - metrics['serverTimingMs'][key]) > .1:
            raise InvalidDocument('header timing mismatch')
    if cold:
        if metrics['jiraCatalogCallCount'] != 2 or metrics['jiraSearchCallCount'] < 1 or metrics['maxPagesPerSearch'] < 1:
            raise InvalidDocument('cold request ownership')
        if (metrics['jiraFailureAttemptCount'] != metrics['jiraRetryCount'] or
                metrics['jiraFastFailCount'] != 0 or metrics['jiraRateLimitCount'] != 0 or
                any(metrics[key] != 0 for key in ('oauthRefreshCount', 'oauthAttemptCount', 'oauthRetryCount', 'oauthRateLimitCount'))):
            raise InvalidDocument('completed diagnostic failure evidence')
        if metrics['candidateEpicCount'] > 0 and metrics['jiraBatchCount'] < 1:
            raise InvalidDocument('missing child batches')
        if metrics['epicCount'] > 0 and metrics['shapedResponseBytes'] <= 0:
            raise InvalidDocument('missing shaped bytes')
    else:
        zero = set(COUNTER_KEYS) | {'maxPagesPerSearch', 'maxBatchesPerColumn', 'maxBatchSize',
                                   'maxConcurrency', 'maxEncodedRequestBytes'}
        if any(metrics[key] != 0 for key in zero):
            raise InvalidDocument('warm upstream work')


def _validate_legacy(metrics):
    if metrics['metricAvailability'] != 'legacy_partial' or not isinstance(metrics['legacyCapped'], bool):
        raise InvalidDocument('legacy ownership')
    for key in METRIC_KEYS:
        if key in {'wallMs', 'epicCount', 'childCount', 'legacyDenominator', 'legacyCapped',
                   'metricAvailability', *COUNTER_KEYS}:
            continue
        if metrics[key] is not None:
            raise InvalidDocument('legacy metric leakage')
    for key in ('wallMs', 'epicCount', 'childCount', 'legacyDenominator', *COUNTER_KEYS):
        _number(metrics[key], integer=key not in {'wallMs', 'jiraRetrySleepMs', 'jiraRetryAfterMs'},
                nullable=key == 'jiraBatchCount')
    if metrics['legacyDenominator'] != metrics['epicCount'] + metrics['childCount']:
        raise InvalidDocument('legacy denominator')
    if (metrics['jiraCatalogCallCount'] + metrics['jiraSearchCallCount'] != metrics['jiraLogicalRequestCount'] or
            metrics['jiraAttemptCount'] != metrics['jiraLogicalRequestCount'] - metrics['jiraFastFailCount'] + metrics['jiraRetryCount'] or
            not metrics['jiraRateLimitCount'] <= metrics['jiraFailureAttemptCount'] <= metrics['jiraAttemptCount'] or
            metrics['jiraFailedResponseBytes'] > metrics['jiraResponseBytes']):
        raise InvalidDocument('legacy transport equation')


def _validate_complete(document):
    _keys(document, {'schemaVersion', 'result', 'deadlineMode', 'configSource',
                     'componentNamePolicy', 'authorizedScope', 'legacyComparison', 'rounds'})
    if (document['deadlineMode'], document['configSource'], document['componentNamePolicy'],
        document['authorizedScope'], document['legacyComparison']) != (
            'cooperative', 'workspace_db', 'broadcast_exact_name',
            'configured_product_tech_28d', 'context_only'):
        raise InvalidDocument('campaign constants')
    if not isinstance(document['rounds'], list) or len(document['rounds']) != 5:
        raise InvalidDocument('round count')
    representative = True
    cold_by_profile = {profile: [] for profile in PROFILES if profile != 'legacy_selected_sprint'}
    warm_by_profile = {profile: [] for profile in cold_by_profile}
    prior_cold = {}
    for round_index, round_value in enumerate(document['rounds'], 1):
        _keys(round_value, {'round', 'samples'})
        if round_value['round'] != round_index or not isinstance(round_value['samples'], list) or len(round_value['samples']) != 8:
            raise InvalidDocument('round shape')
        expected = [item for profile in ROUND_PROFILE_ORDER[round_index - 1]
                    for item in ((profile, 'refresh'), (profile, 'reuse'))]
        concurrency = False
        exercised = False
        for sample, (profile, intent) in zip(round_value['samples'], expected):
            _keys(sample, SAMPLE_KEYS)
            if sample['profile'] != profile or sample['cacheIntent'] != intent or sample['result'] != 'success':
                raise InvalidDocument('sample sequence')
            cold = intent == 'refresh'
            expected_states = ('not_applicable', 'unverified') if profile == 'legacy_selected_sprint' else (('miss', 'miss') if cold else ('hit', 'hit'))
            if (sample['candidateCacheState'], sample['metadataCacheState']) != expected_states:
                raise InvalidDocument('cache state')
            _keys(sample['metrics'], METRIC_KEYS)
            metrics = sample['metrics']
            if profile == 'legacy_selected_sprint':
                _validate_legacy(metrics)
            else:
                _validate_candidate(metrics, intent, cold)
                (cold_by_profile if cold else warm_by_profile)[profile].append(metrics['wallMs'])
                if cold:
                    prior_cold[profile] = metrics
                    representative &= all(metrics[key] >= 1 for key in ('candidateEpicCount', 'epicCount', 'childCount', 'bootstrapChildCount', 'productChildCount', 'techChildCount'))
                    concurrency |= metrics['maxConcurrency'] == 2
                    exercised |= metrics['maxPagesPerSearch'] >= 2 or metrics['maxBatchesPerColumn'] >= 2
                    if profile == 'candidate_all_work':
                        representative &= metrics['terminalEpicCount'] >= 1 and metrics['unmappedEpicCount'] >= 1
                else:
                    cold_metrics = prior_cold.get(profile)
                    if cold_metrics is None:
                        raise InvalidDocument('warm without cold')
                    stable_keys = ('candidateEpicCount', 'epicCount', 'fetchedChildCount', 'childCount',
                                   'bootstrapChildCount', 'productChildCount', 'techChildCount', 'otherChildCount',
                                   'projectCount', 'componentCount', 'teamCount', 'columnCount', 'terminalEpicCount',
                                   'unmappedEpicCount', 'emptyEpicCount', 'shapedResponseBytes')
                    if any(metrics[key] != cold_metrics[key] for key in stable_keys):
                        raise InvalidDocument('warm shape drift')
        representative &= concurrency and exercised
    if not representative:
        return 'STOP unrepresentative_scope'
    cold_values = [value for values in cold_by_profile.values() for value in values]
    if max(cold_values) > 6000:
        return 'FAIL cold_candidate_max'
    all_work = sorted(cold_by_profile['candidate_all_work'])
    if all_work[len(all_work) // 2] > 3000:
        return 'FAIL cold_all_work_median'
    for values in warm_by_profile.values():
        ordered = sorted(values)
        if ordered[len(ordered) // 2] > 1000:
            return 'FAIL warm_candidate_median'
    return 'STOP deadline_bound_unproven'


def check_document(document):
    if not isinstance(document, dict) or document.get('schemaVersion') != SCHEMA_VERSION:
        return 'STOP invalid_campaign'
    try:
        _scan_sensitive(document)
        if document.get('result') == 'stopped':
            return _validate_stop(document)
        if document.get('result') == 'complete':
            return _validate_complete(document)
        raise InvalidDocument('invalid result')
    except SensitiveDocument:
        return 'STOP sensitive_output'
    except (InvalidDocument, KeyError, TypeError, ValueError):
        return 'STOP invalid_campaign'


def validate_output_path(path, *, repo_root=None):
    target = Path(path).resolve()
    root = (repo_root or Path(__file__).resolve().parents[1]).resolve()
    if target == root or root in target.parents:
        raise ValueError('--output must be outside the repository')
    return target


def _check_base_url(raw_url):
    parsed = urlparse(raw_url)
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError('--base-url has an invalid port') from error
    if (parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost', '::1'} or
            port is None or parsed.username is not None or parsed.password is not None or
            parsed.path not in {'', '/'} or parsed.query or parsed.fragment):
        raise ValueError('--base-url must be loopback HTTP with an explicit port and no path')
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, request, file_pointer, code, message, headers, new_url):
            return None
    request = Request(raw_url.rstrip('/') + '/health', method='GET')
    try:
        response = build_opener(NoRedirect).open(request, timeout=5)
    except HTTPError as error:
        raise ValueError('health check failed') from error
    with response:
        if response.status != 200:
            raise ValueError('health check failed')
        try:
            body = json.loads(response.read().decode('utf-8'))
        except Exception as error:
            raise ValueError('health check failed') from error
        if not isinstance(body, dict) or body.get('status') != 'OK':
            raise ValueError('health check failed')
    print(raw_url.rstrip('/') + '/api/dev/eng-board-measurement')


def main(argv=None):
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--input', type=Path)
    source.add_argument('--base-url')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(argv)
    if args.base_url:
        _check_base_url(args.base_url)
        return 0
    try:
        document = json.loads(args.input.read_text(encoding='utf-8'))
    except Exception:
        verdict = 'STOP invalid_campaign'
    else:
        verdict = check_document(document)
    if args.output:
        target = validate_output_path(args.output)
        target.write_text(verdict + '\n', encoding='utf-8')
    print(verdict)
    return 1 if verdict.startswith('FAIL ') else 0


if __name__ == '__main__':
    sys.exit(main())
