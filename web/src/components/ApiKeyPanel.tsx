/**
 * ApiKeyPanel — API ACCESS section of SYS // CALIBRATION.
 *
 * Users can generate a bearer token for the external REST API (GET /api/v1/*)
 * and copy it from this panel. The raw key is shown once on creation and then
 * never again — only the prefix is stored. Generating a new key revokes the
 * previous one.
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ApiKeyInfo, ApiKeyResponse, NewApiKeyResponse } from '../lib/api';
import { Icon } from './Icon';

const SECTION_HEADER: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.26em',
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
};

export function ApiKeyPanel() {
  const qc = useQueryClient();
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const keysQ = useQuery({
    queryKey: ['apikeys'],
    queryFn: () => api.get<ApiKeyResponse>('/api/apikeys').then(r => r.keys),
  });

  const generate = useMutation({
    mutationFn: () => api.post<NewApiKeyResponse>('/api/apikeys'),
    onSuccess: (data) => {
      setFreshKey(data.rawKey);
      setCopied(false);
      qc.invalidateQueries({ queryKey: ['apikeys'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api/apikeys/${id}`),
    onSuccess: () => {
      setFreshKey(null);
      qc.invalidateQueries({ queryKey: ['apikeys'] });
    },
  });

  const copyKey = async () => {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard unavailable */ }
  };

  const activeKey: ApiKeyInfo | undefined = (keysQ.data ?? [])[0];
  const isPending = generate.isPending || revoke.isPending;

  return (
    <div className="ncx-panel">
      {/* Header row */}
      <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={SECTION_HEADER}>API ACCESS</span>
        <span className="ncx-serial" style={{ color: isPending ? 'var(--amber)' : activeKey ? 'var(--lime)' : 'var(--text-ghost)' }}>
          {isPending ? '▴ WORKING…' : activeKey ? '● KEY ACTIVE' : '○ NO KEY'}
        </span>
      </div>

      {/* Active key info */}
      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {activeKey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 13, color: 'var(--cyan)', letterSpacing: '0.06em' }}>
                {activeKey.keyPrefix}…
              </div>
              <div style={{ ...SECTION_HEADER, marginTop: 4 }}>
                CREATED {new Date(activeKey.createdAt).toLocaleDateString()}
                {activeKey.lastUsedAt ? ` · LAST USED ${new Date(activeKey.lastUsedAt).toLocaleDateString()}` : ' · NEVER USED'}
              </div>
            </div>
            <button
              type="button"
              className="btn"
              style={{ padding: '7px 12px', fontSize: 11, color: 'var(--red)', borderColor: 'var(--red)' }}
              disabled={isPending}
              onClick={() => revoke.mutate(activeKey.id)}
            >
              <Icon name="trash-2" size={12} /> REVOKE
            </button>
          </div>
        ) : (
          <div style={{ ...SECTION_HEADER, color: 'var(--text-ghost)' }}>
            NO ACTIVE KEY — GENERATE ONE TO ENABLE API ACCESS
          </div>
        )}
      </div>

      {/* Newly-generated key display */}
      {freshKey && (
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--amber)', background: 'rgba(var(--amber-rgb, 255,160,0), 0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ ...SECTION_HEADER, color: 'var(--amber)' }}>
            ⚠ COPY NOW — NOT SHOWN AGAIN
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code
              className="mono"
              style={{
                flex: 1,
                fontSize: 12,
                wordBreak: 'break-all',
                background: 'var(--bg-panel)',
                border: '1px solid var(--line)',
                padding: '8px 10px',
                color: 'var(--text)',
                userSelect: 'all',
              }}
            >
              {freshKey}
            </code>
            <button
              type="button"
              className={`btn${copied ? ' btn-primary' : ''}`}
              style={{ padding: '8px 14px', fontSize: 11, flexShrink: 0 }}
              onClick={copyKey}
            >
              <Icon name={copied ? 'check' : 'copy'} size={13} />
              {copied ? 'COPIED' : 'COPY'}
            </button>
          </div>
          <div style={{ ...SECTION_HEADER, color: 'var(--text-dim)' }}>
            USE AS: Authorization: Bearer {'<key>'}  ·  ENDPOINT: GET /api/v1/today
          </div>
        </div>
      )}

      {/* Generate button */}
      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: '8px 16px', fontSize: 11 }}
          disabled={isPending}
          onClick={() => generate.mutate()}
        >
          <Icon name="key" size={13} />
          {activeKey ? 'ROTATE KEY' : 'GENERATE KEY'}
        </button>
      </div>

      {generate.isError && (
        <div style={{ padding: '8px 18px', borderTop: '1px solid var(--line)' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>
            {(generate.error as Error)?.message ?? 'Key generation failed'}
          </span>
        </div>
      )}
    </div>
  );
}
