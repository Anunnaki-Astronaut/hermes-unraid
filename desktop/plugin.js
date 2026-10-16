import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import {
  Button,
  ErrorState,
  GlyphSpinner,
  host,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  StatusDot,
} from '@hermes/plugin-sdk';

const ROUTE = '/unraid';
let pluginContext = null;

const CSS = `
.unraid-deck{--ud-good:var(--ui-success);--ud-warn:var(--ui-yellow);--ud-bad:var(--ui-red);--ud-info:var(--ui-accent);box-sizing:border-box;width:100%;max-width:90rem;margin:0 auto;padding:1.25rem;display:flex;flex-direction:column;gap:1rem;overflow-x:hidden;color:var(--ui-text-primary)}
.unraid-deck *{box-sizing:border-box}.ud-header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.ud-brand{display:flex;align-items:center;gap:.75rem;min-width:0}.ud-mark{width:2.75rem;height:2.75rem;flex:0 0 auto;display:grid;place-items:center;border:1px solid var(--ui-stroke-secondary);border-radius:.75rem;background:var(--ui-bg-card);color:var(--ui-accent)}.ud-mark svg{width:1.55rem;height:1.55rem}.ud-title{margin:0;font-size:1.5rem;line-height:1.15;font-weight:700;letter-spacing:-.025em}.ud-subtitle{margin:.25rem 0 0;color:var(--ui-text-secondary);font-size:.82rem}.ud-header-actions{display:flex;align-items:center;gap:.75rem}.ud-connection{display:flex;align-items:center;gap:.45rem;font-size:.82rem;white-space:nowrap}.ud-tabs{display:flex;gap:.25rem;overflow-x:auto;border-bottom:1px solid var(--ui-stroke-secondary);scrollbar-width:thin}.ud-tab{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--ui-text-secondary);padding:.65rem .85rem;white-space:nowrap;cursor:pointer;font:inherit}.ud-tab:hover{color:var(--ui-text-primary);background:var(--ui-row-hover-background)}.ud-tab:focus-visible,.ud-link:focus-visible,.ud-chip:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}.ud-tab[aria-selected="true"]{color:var(--ui-text-primary);border-color:var(--ui-accent)}.ud-tab-count{display:inline-block;margin-left:.35rem;padding:.05rem .4rem;border-radius:999px;background:color-mix(in srgb,var(--ud-bad) 14%,transparent);color:var(--ud-bad);font-size:.68rem;font-weight:700}.ud-panel{border:1px solid var(--ui-stroke-secondary);border-radius:.9rem;background:var(--ui-bg-card)}.ud-hero{display:grid;grid-template-columns:minmax(20rem,1.3fr) minmax(17rem,.7fr);gap:.85rem}.ud-server{position:relative;min-height:14.5rem;padding:1.3rem;overflow:hidden}.ud-attention-line{display:flex;align-items:center;gap:.5rem;color:var(--ud-warn);font-size:.82rem;margin-bottom:1.65rem}.ud-server h2{margin:0;max-width:62%;font-size:1.8rem;line-height:1.15;letter-spacing:-.03em}.ud-server-copy{margin:.4rem 0 0;max-width:58%;color:var(--ui-text-secondary);font-size:.84rem}.ud-rack{position:absolute;right:1.25rem;bottom:1.15rem;width:13rem;height:7.2rem;color:var(--ui-accent);opacity:.78}.ud-capacity{padding:1.3rem;display:flex;flex-direction:column;justify-content:space-between;gap:1.4rem}.ud-label{color:var(--ui-text-tertiary);font-size:.68rem;font-weight:650;letter-spacing:.085em;text-transform:uppercase}.ud-capacity strong{display:block;margin-top:.4rem;font-size:2rem;letter-spacing:-.035em}.ud-secondary{color:var(--ui-text-secondary);font-size:.78rem}.ud-progress{height:.68rem;overflow:hidden;border-radius:999px;background:var(--ui-bg-secondary)}.ud-progress>span{display:block;height:100%;border-radius:inherit;background:var(--bar-color,var(--ui-accent))}.ud-legend{display:flex;justify-content:space-between;gap:.75rem;margin-top:.5rem;color:var(--ui-text-secondary);font-size:.73rem}.ud-vitals{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.85rem}.ud-metric{padding:1rem;min-height:7.3rem}.ud-metric-value{margin:.85rem 0 0;font-size:1.65rem;font-weight:720;letter-spacing:-.03em}.ud-metric-detail{margin-top:.25rem;color:var(--ui-text-secondary);font-size:.75rem}.ud-mini{height:.32rem;margin-top:.8rem;border-radius:999px;background:var(--ui-bg-secondary);overflow:hidden}.ud-mini>span{display:block;height:100%;border-radius:inherit;background:var(--bar-color,var(--ui-accent))}.ud-split{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(18rem,.8fr);gap:.85rem}.ud-panel-body{padding:1.05rem}.ud-panel-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.5rem}.ud-panel-head h3{margin:0;font-size:.9rem}.ud-link{border:0;background:transparent;color:var(--ui-accent);padding:.25rem;cursor:pointer;font:inherit;font-size:.75rem}.ud-row{display:grid;grid-template-columns:minmax(8rem,1.3fr) minmax(7rem,1fr) auto;gap:.75rem;align-items:center;padding:.72rem 0;border-top:1px solid var(--ui-stroke-tertiary)}.ud-row:first-child{border-top:0}.ud-name{font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ud-meta{color:var(--ui-text-secondary);font-size:.72rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ud-state{display:inline-flex;align-items:center;justify-self:end;gap:.42rem;font-size:.74rem;white-space:nowrap}.ud-tone-good{color:var(--ud-good)}.ud-tone-warn{color:var(--ud-warn)}.ud-tone-bad{color:var(--ud-bad)}.ud-tone-muted{color:var(--ui-text-secondary)}.ud-pill{display:inline-flex;align-items:center;gap:.35rem;border:1px solid color-mix(in srgb,var(--tone) 40%,var(--ui-stroke-secondary));border-radius:999px;background:color-mix(in srgb,var(--tone) 11%,transparent);color:var(--tone);padding:.2rem .48rem;font-size:.68rem;font-weight:650;white-space:nowrap}.ud-incident{display:grid;grid-template-columns:1.65rem minmax(0,1fr) auto;gap:.65rem;align-items:start;padding:.72rem 0;border-top:1px solid var(--ui-stroke-tertiary)}.ud-incident:first-of-type{border-top:0}.ud-incident-mark{width:1.65rem;height:1.65rem;border-radius:.5rem;display:grid;place-items:center;background:color-mix(in srgb,var(--tone) 14%,transparent);color:var(--tone);font-weight:800}.ud-incident strong{display:block;font-size:.8rem}.ud-incident small{display:block;margin-top:.12rem;color:var(--ui-text-secondary);font-size:.7rem}.ud-empty{padding:1rem;color:var(--ui-text-secondary);font-size:.82rem}.ud-section{display:grid;gap:.75rem}.ud-section-head{display:flex;align-items:center;justify-content:space-between;gap:1rem}.ud-section-head h2{margin:0;font-size:1rem}.ud-section-copy{color:var(--ui-text-secondary);font-size:.76rem}.ud-detail-list{display:grid;gap:.55rem}.ud-detail-row{display:grid;grid-template-columns:minmax(8rem,1.2fr) minmax(7rem,1fr) auto auto;gap:.75rem;align-items:center;padding:.85rem 1rem}.ud-detail-row+.ud-detail-row{border-top:1px solid var(--ui-stroke-tertiary)}.ud-filters{display:flex;gap:.4rem;flex-wrap:wrap}.ud-chip{border:1px solid var(--ui-stroke-secondary);border-radius:999px;background:transparent;color:var(--ui-text-secondary);padding:.35rem .65rem;cursor:pointer;font:inherit;font-size:.72rem}.ud-chip[aria-pressed="true"]{border-color:color-mix(in srgb,var(--ui-accent) 55%,var(--ui-stroke-secondary));background:color-mix(in srgb,var(--ui-accent) 12%,transparent);color:var(--ui-text-primary)}.ud-alert-list{display:grid}.ud-alert-full{padding:.9rem 1rem;border-top:1px solid var(--ui-stroke-tertiary)}.ud-alert-full:first-child{border-top:0}.ud-alert-title{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap}.ud-alert-description{margin:.35rem 0 0;color:var(--ui-text-secondary);font-size:.8rem}.ud-alert-time{margin-top:.3rem;color:var(--ui-text-tertiary);font-size:.7rem}.ud-loading{display:flex;align-items:center;gap:.5rem;color:var(--ui-text-secondary);font-size:.82rem}.ud-safety{display:flex;align-items:center;justify-content:space-between;gap:1rem;color:var(--ui-text-tertiary);font-size:.72rem;padding:.15rem .1rem .5rem}.ud-error{margin-bottom:.25rem}
@media(max-width:56rem){.unraid-deck{padding:1rem}.ud-hero,.ud-split{grid-template-columns:1fr}.ud-vitals{grid-template-columns:repeat(2,minmax(0,1fr))}.ud-server h2,.ud-server-copy{max-width:70%}.ud-detail-row{grid-template-columns:minmax(8rem,1fr) auto}.ud-detail-row>*:nth-child(2),.ud-detail-row>*:nth-child(3){display:none}}
@media(max-width:34rem){.unraid-deck{padding:.8rem}.ud-header{align-items:center}.ud-header-actions{flex:0 0 auto}.ud-header-actions .ud-connection,.ud-header .ud-subtitle{display:none}.ud-hero{grid-template-columns:1fr}.ud-vitals{grid-template-columns:1fr}.ud-server{min-height:12rem}.ud-server h2,.ud-server-copy{max-width:100%}.ud-rack{display:none}.ud-row{grid-template-columns:minmax(0,1fr) auto}.ud-row>*:nth-child(2){display:none}.ud-panel-head{align-items:flex-start}.ud-safety{align-items:flex-start;flex-direction:column}.ud-label{font-size:.74rem}.ud-secondary,.ud-meta,.ud-metric-detail,.ud-section-copy,.ud-server-copy{font-size:.8rem}}
`;

const mutedStyle = { color: 'var(--ui-text-secondary)' };

function errorText(error) {
  const raw = String(error?.message || error || 'Unknown error');
  const start = raw.indexOf('{');
  if (start >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(start));
      return parsed?.detail?.message || parsed?.message || raw;
    } catch (_) {}
  }
  return raw;
}

function useEndpoint(path, enabled = true, refreshMs = 15000) {
  const [state, setState] = useState({ loading: enabled, data: null, error: null, updatedAt: null });
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setState((current) => ({ ...current, loading: current.data == null, error: null }));
    try {
      const response = await pluginContext.rest(path, { timeoutMs: 15000 });
      setState({ loading: false, data: response, error: null, updatedAt: new Date() });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: errorText(error) }));
    }
  }, [path, enabled]);

  useEffect(() => {
    refresh();
    if (!enabled || !refreshMs) return undefined;
    const timer = window.setInterval(refresh, refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh, enabled, refreshMs]);
  return { ...state, refresh };
}

function numberText(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Unknown';
  return numeric.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function percentText(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numberText(numeric, 1)}%` : 'Unknown';
}

function formatBytesFromKb(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Unknown';
  let bytes = numeric * 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let index = 0;
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024;
    index += 1;
  }
  return `${bytes.toFixed(index < 3 ? 0 : 1)} ${units[index]}`;
}

function capacityPercent(capacity) {
  const used = Number(capacity?.used);
  const total = Number(capacity?.total);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

function toneForState(value) {
  const state = String(value || '').toUpperCase();
  if (!state) return 'muted';
  if (state.includes('ERROR') || state.includes('FAIL') || state.includes('ALERT') || state.includes('ORPHAN')) return 'bad';
  if (state.includes('RUNNING') || state.includes('STARTED') || state.includes('ONLINE') || state === 'OK' || state.includes('_OK') || state.includes('ACTIVE')) return 'good';
  if (state.includes('STOPPED') || state.includes('EXITED') || state.includes('OFFLINE') || state.includes('SHUTOFF')) return 'muted';
  return 'warn';
}

function displayState(value, fallback = 'Unknown') {
  const text = String(value || fallback).toUpperCase();
  if (text === 'DISK_OK') return 'OK';
  if (text === 'SHUTOFF') return 'SHUT OFF';
  return text.replaceAll('_', ' ');
}

function toneColor(tone) {
  if (tone === 'good') return 'var(--ud-good)';
  if (tone === 'warn') return 'var(--ud-warn)';
  if (tone === 'bad') return 'var(--ud-bad)';
  return 'var(--ui-text-secondary)';
}

function importanceTone(value) {
  const importance = String(value || '').toUpperCase();
  return importance.includes('ALERT') || importance.includes('CRITICAL') || importance.includes('ERROR') ? 'bad' : 'warn';
}

function alertLabel(value) {
  return importanceTone(value) === 'bad' ? 'Alert' : 'Warning';
}

function groupAlerts(items) {
  const groups = new Map();
  for (const item of items || []) {
    const title = item.title || item.subject || 'Unraid notification';
    const description = item.description || item.subject || 'No description.';
    const label = alertLabel(item.importance);
    const key = `${label}\u0000${title}\u0000${description}`;
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      if (item.timestamp && (!current.timestamp || item.timestamp > current.timestamp)) current.timestamp = item.timestamp;
    } else {
      groups.set(key, { ...item, title, description, label, tone: importanceTone(item.importance), count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === 'bad' ? -1 : 1;
    return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
  });
}

function attentionCount(summary) {
  if (!summary) return null;
  return Number(summary.warning || 0) + Number(summary.alert || 0);
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatUpdated(value) {
  if (!(value instanceof Date)) return 'Waiting for data';
  return `Updated ${value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function StatusPill({ tone = 'muted', children }) {
  return jsx('span', { className: 'ud-pill', style: { '--tone': toneColor(tone) }, children });
}

function StateLabel({ value, fallback = 'Unknown' }) {
  const text = value || fallback;
  const tone = toneForState(text);
  return jsxs('span', {
    className: `ud-state ud-tone-${tone}`,
    children: [jsx(StatusDot, { tone }), jsx('span', { children: displayState(text, fallback) })],
  });
}

function ProgressBar({ value, label, tone = 'info', small = false }) {
  const numeric = Number(value);
  const determinate = Number.isFinite(numeric);
  const safe = determinate ? Math.max(0, Math.min(100, numeric)) : 0;
  const color = tone === 'good' ? 'var(--ud-good)' : tone === 'warn' ? 'var(--ud-warn)' : tone === 'bad' ? 'var(--ud-bad)' : 'var(--ud-info)';
  return jsx('div', {
    className: small ? 'ud-mini' : 'ud-progress',
    role: 'progressbar',
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': determinate ? Math.round(safe * 10) / 10 : undefined,
    'aria-valuetext': determinate ? `${numberText(safe, 1)}%` : 'Unknown',
    children: jsx('span', { style: { width: `${safe}%`, backgroundColor: color } }),
  });
}

function ServerRackGraphic() {
  return jsx('svg', {
    className: 'ud-rack',
    viewBox: '0 0 220 120',
    'aria-hidden': true,
    children: jsxs('g', {
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      children: [
        jsx('rect', { x: 1, y: 1, width: 218, height: 118, rx: 14, opacity: 0.5 }),
        jsx('rect', { x: 16, y: 17, width: 188, height: 22, rx: 6, opacity: 0.65 }),
        jsx('rect', { x: 16, y: 49, width: 188, height: 22, rx: 6, opacity: 0.65 }),
        jsx('rect', { x: 16, y: 81, width: 188, height: 22, rx: 6, opacity: 0.65 }),
        jsx('circle', { cx: 29, cy: 28, r: 3, fill: 'var(--ud-good)', stroke: 'none' }),
        jsx('circle', { cx: 29, cy: 60, r: 3, fill: 'var(--ud-good)', stroke: 'none' }),
        jsx('circle', { cx: 29, cy: 92, r: 3, fill: 'var(--ud-good)', stroke: 'none' }),
        jsx('path', { d: 'M44 28h132M44 60h132M44 92h132', opacity: 0.5 }),
      ],
    }),
  });
}

function Metric({ label, value, detail, progress, tone = 'info', valueTone = null }) {
  return jsxs('article', {
    className: 'ud-panel ud-metric',
    children: [
      jsx('div', { className: 'ud-label', children: label }),
      jsx('div', { className: `ud-metric-value${valueTone ? ` ud-tone-${valueTone}` : ''}`, children: value ?? 'Unknown' }),
      detail ? jsx('div', { className: 'ud-metric-detail', children: detail }) : null,
      progress != null ? jsx(ProgressBar, { value: progress, label: `${label}: ${percentText(progress)}`, tone, small: true }) : null,
    ].filter(Boolean),
  });
}

function CapacityCard({ capacity }) {
  const percent = capacityPercent(capacity);
  const tone = percent != null && percent >= 80 ? 'warn' : 'good';
  return jsxs('article', {
    className: 'ud-panel ud-capacity',
    children: [
      jsxs('div', {
        children: [
          jsx('div', { className: 'ud-label', children: 'Array capacity' }),
          jsx('strong', { children: formatBytesFromKb(capacity?.used) }),
          jsx('div', { className: 'ud-secondary', children: `of ${formatBytesFromKb(capacity?.total)} used` }),
        ],
      }),
      jsxs('div', {
        children: [
          jsx(ProgressBar, { value: percent, label: 'Array capacity used', tone }),
          jsxs('div', {
            className: 'ud-legend',
            children: [
              jsx('span', { children: percent == null ? 'Usage unknown' : `${numberText(percent, 1)}% used` }),
              jsx('span', { children: `${formatBytesFromKb(capacity?.free)} free` }),
            ],
          }),
        ],
      }),
    ],
  });
}

function ServicesPanel({ containers, onViewAll }) {
  const visible = (containers || []).slice(0, 3);
  return jsxs('article', {
    className: 'ud-panel ud-panel-body',
    children: [
      jsxs('div', {
        className: 'ud-panel-head',
        children: [jsx('h3', { children: 'Services' }), jsx('button', { type: 'button', className: 'ud-link', onClick: onViewAll, children: 'View Docker →' })],
      }),
      visible.length
        ? jsx('div', {
            children: visible.map((container, index) => {
              const name = container.names?.[0]?.replace(/^\//, '') || container.image || 'Container';
              const endpoint = container.lanIpPorts?.[0] || container.image || 'No endpoint returned';
              return jsxs('div', {
                className: 'ud-row',
                children: [
                  jsxs('div', { children: [jsx('div', { className: 'ud-name', children: name }), jsx('div', { className: 'ud-meta', children: endpoint })] }),
                  jsx('div', { className: 'ud-meta', children: container.status || 'Status unavailable' }),
                  jsx(StateLabel, { value: container.state }),
                ],
              }, container.id || `${name}-${index}`);
            }),
          })
        : jsx('div', { className: 'ud-empty', children: 'No Docker containers were returned.' }),
    ],
  });
}

function IncidentPanel({ groups, summary, onViewAll }) {
  const visible = groups.slice(0, 3);
  const total = attentionCount(summary);
  return jsxs('article', {
    className: 'ud-panel ud-panel-body',
    children: [
      jsxs('div', {
        className: 'ud-panel-head',
        children: [
          jsx('h3', { children: 'Needs attention' }),
          jsx('button', { type: 'button', className: 'ud-link', onClick: onViewAll, children: total ? `View all ${total} →` : 'View all →' }),
        ],
      }),
      visible.length
        ? jsx('div', {
            children: visible.map((item, index) => jsxs('div', {
              className: 'ud-incident',
              style: { '--tone': toneColor(item.tone) },
              children: [
                jsx('div', { className: 'ud-incident-mark', children: '!' }),
                jsxs('div', {
                  children: [
                    jsx('strong', { children: item.title }),
                    jsx('small', { children: item.count > 1 ? `${item.count} occurrences` : item.description }),
                  ],
                }),
                jsx(StatusPill, { tone: item.tone, children: item.label }),
              ],
            }, item.id || `${item.title}-${index}`)),
          })
        : jsx('div', { className: 'ud-empty', children: 'No unread warnings or alerts.' }),
    ],
  });
}

function OverviewView({ overview, containers, alertGroups, alertSummary, onTab }) {
  const info = overview?.info;
  const metrics = overview?.metrics;
  const array = overview?.array;
  const capacity = array?.capacity?.kilobytes;
  const cpu = metrics?.cpu?.percentTotal;
  const memory = metrics?.memory?.percentTotal;
  const attentionTotal = attentionCount(alertSummary);
  const unreadTotal = Number(alertSummary?.total || 0);
  const model = info?.system?.model || 'Unraid server';
  const serverDetail = [info?.os?.release, info?.cpu?.brand, info?.cpu?.cores ? `${info.cpu.cores} cores` : null].filter(Boolean).join(' · ');

  return jsxs('section', {
    className: 'ud-section',
    children: [
      jsxs('div', {
        className: 'ud-hero',
        children: [
          jsxs('article', {
            className: 'ud-panel ud-server',
            children: [
              jsxs('div', {
                className: attentionTotal ? 'ud-attention-line' : 'ud-attention-line ud-tone-good',
                children: [jsx(StatusDot, { tone: attentionTotal ? 'warn' : 'good' }), jsx('span', { children: unreadTotal ? `${unreadTotal} unread notifications · ${attentionTotal || 0} warnings or alerts` : 'No unread warnings or alerts' })],
              }),
              jsx('h2', { children: model }),
              jsx('p', { className: 'ud-server-copy', children: serverDetail || 'System details unavailable' }),
              jsx(ServerRackGraphic, {}),
            ],
          }),
          jsx(CapacityCard, { capacity }),
        ],
      }),
      jsx('div', {
        className: 'ud-vitals',
        children: [
          jsx(Metric, { label: 'CPU usage', value: percentText(cpu), progress: cpu, tone: 'info' }),
          jsx(Metric, { label: 'Memory', value: percentText(memory), detail: memory == null ? null : 'used', progress: memory, tone: 'good' }),
          jsx(Metric, { label: 'Array', value: array?.state || 'Unknown', detail: 'Current API state', valueTone: toneForState(array?.state) }),
          jsx(Metric, {
            label: 'Needs attention',
            value: attentionTotal ?? 'Unknown',
            detail: alertSummary ? `${alertSummary.warning || 0} warnings · ${alertSummary.alert || 0} alerts` : null,
            valueTone: attentionTotal ? 'bad' : null,
          }),
        ],
      }),
      jsxs('div', {
        className: 'ud-split',
        children: [
          jsx(ServicesPanel, { containers, onViewAll: () => onTab('docker') }),
          jsx(IncidentPanel, { groups: alertGroups, summary: alertSummary, onViewAll: () => onTab('alerts') }),
        ],
      }),
    ],
  });
}

function parityDetail(status) {
  if (!status) return null;
  const progress = Number(status.progress);
  const active = String(status.status || '').toUpperCase().includes('RUN');
  if (active && Number.isFinite(progress)) return `${numberText(progress, 1)}% complete`;
  if (status.errors != null) return `${status.errors} errors reported`;
  return null;
}

function ArrayView({ payload }) {
  const array = payload?.data?.array;
  if (!array) return jsx('p', { className: 'ud-empty', children: 'Array data is unavailable on this API version or key.' });
  const capacity = array.capacity?.kilobytes;
  return jsxs('section', {
    className: 'ud-section',
    children: [
      jsxs('div', {
        className: 'ud-section-head',
        children: [
          jsx('h2', { children: 'Array and pools' }),
          jsx('div', { className: 'ud-section-copy', children: `${array.disks?.length || 0} storage devices` }),
        ],
      }),
      jsx('div', {
        className: 'ud-vitals',
        children: [
          jsx(Metric, { label: 'Array state', value: array.state || 'Unknown' }),
          jsx(Metric, { label: 'Used', value: formatBytesFromKb(capacity?.used), detail: `of ${formatBytesFromKb(capacity?.total)}` }),
          jsx(Metric, { label: 'Free', value: formatBytesFromKb(capacity?.free) }),
          jsx(Metric, { label: 'Parity', value: array.parityCheckStatus?.status || 'Unknown', detail: parityDetail(array.parityCheckStatus) }),
        ],
      }),
      jsx('div', {
        className: 'ud-panel ud-detail-list',
        children: (array.disks || []).map((disk, index) => jsxs('div', {
          className: 'ud-detail-row',
          children: [
            jsxs('div', { children: [jsx('div', { className: 'ud-name', children: disk.name || disk.device || 'Disk' }), jsx('div', { className: 'ud-meta', children: `${disk.device || 'unknown device'} · ${disk.type || 'disk'}` })] }),
            jsx('div', { className: 'ud-secondary', children: disk.temp == null ? 'Temperature unknown' : `${disk.temp}°C` }),
            jsx('div', { className: 'ud-secondary', children: disk.numErrors == null ? 'Errors unknown' : `${disk.numErrors} errors` }),
            jsx(StatusPill, { tone: toneForState(disk.status), children: displayState(disk.status) }),
          ],
        }, disk.id || disk.name || `disk-${index}`)),
      }),
    ],
  });
}

function DockerView({ payload }) {
  const containers = payload?.data?.docker?.containers || [];
  const [filter, setFilter] = useState('all');
  const filtered = containers.filter((container) => filter === 'all' || (filter === 'running' ? container.state === 'RUNNING' : container.state !== 'RUNNING'));
  const running = containers.filter((container) => container.state === 'RUNNING').length;
  return jsxs('section', {
    className: 'ud-section',
    children: [
      jsxs('div', {
        className: 'ud-section-head',
        children: [
          jsxs('div', { children: [jsx('h2', { children: 'Docker' }), jsx('div', { className: 'ud-section-copy', children: `${running} running · ${containers.length - running} not running` })] }),
          jsx('div', {
            className: 'ud-filters',
            children: ['all', 'running', 'stopped'].map((name) => jsx('button', {
              type: 'button',
              className: 'ud-chip',
              'aria-pressed': filter === name,
              onClick: () => setFilter(name),
              children: name[0].toUpperCase() + name.slice(1),
            }, name)),
          }),
        ],
      }),
      filtered.length
        ? jsx('div', {
            className: 'ud-panel ud-detail-list',
            children: filtered.map((container, index) => {
              const name = container.names?.[0]?.replace(/^\//, '') || container.image || 'Container';
              return jsxs('div', {
                className: 'ud-detail-row',
                children: [
                  jsxs('div', { children: [jsx('div', { className: 'ud-name', children: name }), jsx('div', { className: 'ud-meta', children: container.image || 'Image unavailable' })] }),
                  jsx('div', { className: 'ud-secondary', children: container.lanIpPorts?.join(' · ') || 'No published endpoint' }),
                  jsx('div', { className: 'ud-secondary', children: container.status || 'Status unavailable' }),
                  jsx(StateLabel, { value: container.state }),
                ],
              }, container.id || `${name}-${index}`);
            }),
          })
        : jsx('div', { className: 'ud-panel ud-empty', children: containers.length ? 'No containers match this filter.' : 'No Docker containers were returned.' }),
    ],
  });
}

function VmView({ payload }) {
  const domains = payload?.data?.vms?.domains || [];
  return jsxs('section', {
    className: 'ud-section',
    children: [
      jsxs('div', { className: 'ud-section-head', children: [jsx('h2', { children: 'Virtual machines' }), jsx('div', { className: 'ud-section-copy', children: `${domains.length} ${domains.length === 1 ? 'VM' : 'VMs'}` })] }),
      domains.length
        ? jsx('div', {
            className: 'ud-panel ud-detail-list',
            children: domains.map((vm, index) => jsxs('div', {
              className: 'ud-detail-row',
              children: [jsx('div', { className: 'ud-name', children: vm.name || 'Virtual machine' }), jsx('div', { className: 'ud-secondary', children: 'Virtual machine' }), jsx('span', {}), jsx(StateLabel, { value: vm.state })],
            }, vm.id || vm.name || `vm-${index}`)),
          })
        : jsx('div', { className: 'ud-panel ud-empty', children: 'No virtual machines were returned.' }),
    ],
  });
}

function AlertView({ groups, summary }) {
  return jsxs('section', {
    className: 'ud-section',
    children: [
      jsxs('div', {
        className: 'ud-section-head',
        children: [
          jsxs('div', { children: [jsx('h2', { children: 'Notifications requiring attention' }), jsx('div', { className: 'ud-section-copy', children: summary ? `${summary.alert || 0} alerts · ${summary.warning || 0} warnings` : 'Unread severity totals unavailable' })] }),
          jsx('div', { className: 'ud-section-copy', children: 'Grouped by severity, title, and description' }),
        ],
      }),
      groups.length
        ? jsx('div', {
            className: 'ud-panel ud-alert-list',
            children: groups.map((item, index) => jsxs('article', {
              className: 'ud-alert-full',
              children: [
                jsxs('div', { className: 'ud-alert-title', children: [jsx(StatusPill, { tone: item.tone, children: item.label }), jsx('strong', { children: item.title }), item.count > 1 ? jsx('span', { className: 'ud-secondary', children: `${item.count} occurrences` }) : null].filter(Boolean) }),
                jsx('p', { className: 'ud-alert-description', children: item.description }),
                item.timestamp ? jsx('div', { className: 'ud-alert-time', children: formatTimestamp(item.timestamp) }) : null,
              ].filter(Boolean),
            }, item.id || `${item.title}-${index}`)),
          })
        : jsx('div', { className: 'ud-panel ud-empty', children: 'No unread warnings or alerts.' }),
    ],
  });
}

function UnraidPage() {
  const health = useEndpoint('/health', true, 30000);
  const configured = Boolean(health.data?.configured);
  const overview = useEndpoint('/overview', configured, 15000);
  const arrayData = useEndpoint('/array', configured, 30000);
  const docker = useEndpoint('/docker', configured, 15000);
  const vms = useEndpoint('/vms', configured, 15000);
  const alerts = useEndpoint('/notifications', configured, 15000);
  const [tab, setTab] = useState('overview');
  const [refreshing, setRefreshing] = useState(false);

  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const tasks = [health.refresh()];
      if (configured) tasks.push(overview.refresh(), arrayData.refresh(), docker.refresh(), vms.refresh(), alerts.refresh());
      await Promise.all(tasks);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, configured, health.refresh, overview.refresh, arrayData.refresh, docker.refresh, vms.refresh, alerts.refresh]);

  const anyError = health.error || overview.error || arrayData.error || docker.error || vms.error || alerts.error;
  const overviewData = overview.data?.data;
  const containers = docker.data?.data?.docker?.containers || [];
  const alertItems = alerts.data?.data?.notifications?.warningsAndAlerts || overviewData?.notifications?.warningsAndAlerts || [];
  const alertGroups = useMemo(() => groupAlerts(alertItems), [alertItems]);
  const alertSummary = alerts.data?.data?.notifications?.overview?.unread || overviewData?.notifications?.overview?.unread;
  const alertCount = attentionCount(alertSummary);
  const latestUpdate = [health, overview, arrayData, docker, vms, alerts]
    .map((entry) => entry.updatedAt)
    .filter((value) => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const initialLoading = configured && !overviewData && (overview.loading || arrayData.loading || docker.loading || vms.loading || alerts.loading);
  const tabs = ['overview', 'array', 'docker', 'vms', 'alerts'];
  const connectionTone = !configured ? 'muted' : anyError ? 'warn' : 'good';
  const connectionText = !configured ? 'Not configured' : anyError ? 'Degraded' : 'Configured';

  return jsxs('main', {
    className: 'unraid-deck',
    children: [
      jsx('style', { children: CSS }),
      jsxs('header', {
        className: 'ud-header',
        children: [
          jsxs('div', {
            className: 'ud-brand',
            children: [
              jsx('div', {
                className: 'ud-mark',
                'aria-hidden': true,
                children: jsx('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, children: jsxs('g', { children: [jsx('rect', { x: 4, y: 3, width: 16, height: 6, rx: 2 }), jsx('rect', { x: 4, y: 15, width: 16, height: 6, rx: 2 }), jsx('path', { d: 'M8 6h.01M8 18h.01M12 9v6' })] }) }),
              }),
              jsxs('div', { children: [jsx('h1', { className: 'ud-title', children: 'Unraid' }), jsx('p', { className: 'ud-subtitle', children: 'Official GraphQL API · read-only monitoring' })] }),
            ],
          }),
          jsxs('div', {
            className: 'ud-header-actions',
            children: [
              jsxs('span', { className: `ud-connection ud-tone-${connectionTone}`, role: 'status', 'aria-live': 'polite', children: [jsx(StatusDot, { tone: connectionTone }), connectionText] }),
              jsx(Button, { onClick: refreshAll, disabled: refreshing, style: { minHeight: 44 }, children: refreshing ? 'Refreshing…' : 'Refresh' }),
            ],
          }),
        ],
      }),
      !configured && !health.loading ? jsxs('section', {
        className: 'ud-panel ud-panel-body',
        children: [
          jsx('strong', { children: 'Connect a read-only Unraid API key' }),
          jsx('p', { className: 'ud-alert-description', children: health.data?.message || 'Open Settings → Plugins → Unraid to enter the server URL and API key.' }),
          jsx('p', { className: 'ud-alert-description', children: 'Use the masked API-key field, retain any custom WebGUI port in the /graphql URL, save, then return here and press Refresh.' }),
          jsx('p', { className: 'ud-alert-time', children: 'The API key is stored by the Hermes backend and is never returned to this page.' }),
        ],
      }) : null,
      anyError ? jsx('div', { className: 'ud-error', children: jsx(ErrorState, { title: 'Some Unraid data could not be loaded', description: anyError, onRetry: refreshAll }) }) : null,
      configured ? jsxs(React.Fragment, {
        children: [
          jsx('nav', {
            className: 'ud-tabs',
            role: 'tablist',
            'aria-label': 'Unraid sections',
            children: tabs.map((name) => jsx('button', {
              type: 'button',
              role: 'tab',
              className: 'ud-tab',
              'aria-selected': tab === name,
              onClick: () => setTab(name),
              children: name === 'alerts'
                ? jsxs(React.Fragment, { children: ['Alerts', alertCount ? jsx('span', { className: 'ud-tab-count', children: alertCount }) : null] })
                : name === 'vms' ? 'VMs' : name[0].toUpperCase() + name.slice(1),
            }, name)),
          }),
          initialLoading ? jsxs('div', { className: 'ud-loading', children: [jsx(GlyphSpinner, {}), 'Loading Unraid data…'] }) : null,
          !initialLoading && tab === 'overview' ? jsx(OverviewView, { overview: overviewData, containers, alertGroups, alertSummary, onTab: setTab }) : null,
          !initialLoading && tab === 'array' ? jsx(ArrayView, { payload: arrayData.data }) : null,
          !initialLoading && tab === 'docker' ? jsx(DockerView, { payload: docker.data }) : null,
          !initialLoading && tab === 'vms' ? jsx(VmView, { payload: vms.data }) : null,
          !initialLoading && tab === 'alerts' ? jsx(AlertView, { groups: alertGroups, summary: alertSummary }) : null,
        ],
      }) : null,
      jsxs('footer', {
        className: 'ud-safety',
        children: [jsx('span', { children: 'Read-only safety mode · No MCP · No SSH · No GraphQL mutations' }), jsx('span', { children: formatUpdated(latestUpdate) })],
      }),
    ].filter(Boolean),
  });
}

export default {
  id: 'unraid',
  name: 'Unraid',
  defaultEnabled: false,
  register(ctx) {
    pluginContext = ctx;
    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => jsx(UnraidPage, {}) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: ROUTE, label: 'Unraid', codicon: 'server' } },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: { id: 'unraid.open', label: 'Open Unraid', keywords: ['server', 'nas', 'docker'], run: () => host.navigate(ROUTE) },
      },
    ]);
  },
};