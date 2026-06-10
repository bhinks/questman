import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from './Icon';
import { api } from '../lib/api';
import type { CategoriesResponse, FinanceCategory, Project, Habit } from '../lib/api';
import type { Transaction } from '../types';

interface TransactionEditorProps {
  transaction: Transaction;
  onSave: (updated: Transaction) => void;
  onCancel: () => void;
  categories?: string[]; // legacy prop, unused — categories are fetched by id now
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, color: 'var(--text-dim)',
  fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', marginBottom: 6,
};
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: 10, background: '#070811',
  border: '1px solid var(--line-2)', borderRadius: 0, color: 'var(--text)',
  fontSize: 14, fontFamily: 'var(--font-ui)',
};

/**
 * Transaction editor — finance depth. Beyond scalars it now persists the
 * CATEGORY (by id, the manual re-categorize prerequisite), an EXCLUDE toggle
 * (drop transfers from totals), and PROJECT / CHORE links (spend rollups).
 * Category/project/chore lists are fetched here so the modal is self-contained.
 */
export function TransactionEditor({ transaction, onSave, onCancel }: TransactionEditorProps) {
  const [t, setT] = useState<Transaction>({ ...transaction });

  const catQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoriesResponse>('/api/categories').then(r => r.categories),
  });
  const projQ = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[] }>('/api/projects').then(r => r.projects),
  });
  const choreQ = useQuery({
    queryKey: ['habits', 'chore'],
    queryFn: () => api.get<{ habits: Habit[] }>('/api/habits?kind=chore').then(r => r.habits),
  });
  // Known account labels — datalist suggestions for the free-text field.
  const acctQ = useQuery({
    queryKey: ['transactions', 'accounts'],
    queryFn: () => api.get<{ accounts: string[] }>('/api/transactions/accounts').then(r => r.accounts),
    staleTime: 5 * 60_000,
  });

  const cats: FinanceCategory[] = catQ.data ?? [];
  const projects: Project[] = projQ.data ?? [];
  const chores: Habit[] = choreQ.data ?? [];
  const accounts: string[] = acctQ.data ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(t);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20, overflowY: 'auto',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="panel hud"
        style={{ width: '100%', maxWidth: 520, padding: 24, margin: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div className="ncx-chip" style={{ width: 34, height: 34, color: 'var(--cyan)' }}>
            <Icon name="edit" size={15} />
          </div>
          <h3 className="ncx-chroma" style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text)', fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>
            Edit Transaction
          </h3>
          <span className="ncx-serial">TXN.EDIT</span>
          <button type="button" onClick={onCancel}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>DESCRIPTION</label>
            <input type="text" value={t.description}
              onChange={(e) => setT(p => ({ ...p, description: e.target.value }))} style={fieldStyle} />
          </div>

          <div>
            <label style={labelStyle}>CATEGORY</label>
            <select
              value={t.categoryId ?? ''}
              onChange={(e) => {
                const id = e.target.value || undefined;
                const name = cats.find(c => c.id === id)?.name;
                setT(p => ({ ...p, categoryId: id, category: name }));
              }}
              style={fieldStyle}
            >
              <option value="">Uncategorized</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>LINK PROJECT</label>
              <select
                value={t.projectId ?? ''}
                onChange={(e) => {
                  const id = e.target.value || undefined;
                  setT(p => ({ ...p, projectId: id, projectName: projects.find(x => x.id === id)?.name }));
                }}
                style={fieldStyle}
              >
                <option value="">— none —</option>
                {projects.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>LINK CHORE</label>
              <select
                value={t.choreId ?? ''}
                onChange={(e) => {
                  const id = e.target.value || undefined;
                  setT(p => ({ ...p, choreId: id, choreName: chores.find(x => x.id === id)?.title }));
                }}
                style={fieldStyle}
              >
                <option value="">— none —</option>
                {chores.map(ch => <option key={ch.id} value={ch.id}>{ch.title}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>VENDOR</label>
              <input type="text" value={t.vendor || ''}
                onChange={(e) => setT(p => ({ ...p, vendor: e.target.value || undefined }))} style={fieldStyle} />
            </div>
            <div>
              {/* Source-account label (free text; cleared field unsets it). */}
              <label style={labelStyle}>ACCOUNT</label>
              <input type="text" value={t.account || ''} list="txn-account-options"
                placeholder="— none —"
                onChange={(e) => setT(p => ({ ...p, account: e.target.value || undefined }))}
                style={{ ...fieldStyle, fontFamily: 'var(--font-mono)' }} />
              <datalist id="txn-account-options">
                {accounts.map(a => <option key={a} value={a} />)}
              </datalist>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>DATE</label>
              <input type="date" value={t.date.toISOString().split('T')[0]}
                onChange={(e) => setT(p => ({ ...p, date: new Date(e.target.value) }))}
                style={{ ...fieldStyle, fontFamily: 'var(--font-mono)' }} />
            </div>
            <div>
              <label style={labelStyle}>AMOUNT</label>
              <input type="number" step="0.01" value={t.amount}
                onChange={(e) => setT(p => ({ ...p, amount: parseFloat(e.target.value) || 0 }))}
                style={{ ...fieldStyle, fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>NOTES</label>
            <input type="text" value={t.notes || ''}
              onChange={(e) => setT(p => ({ ...p, notes: e.target.value || undefined }))} style={fieldStyle} />
          </div>

          {/* Toggles: exclude (transfer) + wasteful */}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={!!t.excluded}
                onChange={(e) => setT(p => ({ ...p, excluded: e.target.checked }))} />
              Exclude from totals (transfer)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={!!t.isWasteful}
                onChange={(e) => setT(p => ({ ...p, isWasteful: e.target.checked }))} />
              Flag as wasteful
            </label>
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={onCancel} className="btn" style={{ padding: '10px 20px' }}>Cancel</button>
            <button type="submit" className="btn-primary" style={{ padding: '10px 20px' }}>Save Changes</button>
          </div>
        </div>
      </form>
    </div>
  );
}
