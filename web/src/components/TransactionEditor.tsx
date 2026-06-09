import { useState } from 'react';
import { Icon } from './Icon';
import type { Transaction } from '../types';

interface TransactionEditorProps {
  transaction: Transaction;
  onSave: (updated: Transaction) => void;
  onCancel: () => void;
  categories: string[];
}

export function TransactionEditor({ transaction, onSave, onCancel, categories }: TransactionEditorProps) {
  const [editedTransaction, setEditedTransaction] = useState<Transaction>({
    ...transaction
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(editedTransaction);
  };

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form 
        onSubmit={handleSubmit}
        className="panel hud"
        style={{
          width: '100%',
          maxWidth: 500,
          padding: 24
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 12, 
          marginBottom: 20 
        }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Icon name="edit" size={16} style={{ color: 'white' }} />
          </div>
          <h3 style={{
            fontSize: 18, 
            fontWeight: 600, 
            margin: 0,
            color: 'var(--text)',
            fontFamily: 'var(--font-display)'
          }}>
            Edit Transaction
          </h3>
          <button
            type="button"
            onClick={onCancel}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              padding: 4
            }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ 
              display: 'block',
              fontSize: 12,
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.05em',
              marginBottom: 6
            }}>
              DESCRIPTION
            </label>
            <input
              type="text"
              value={editedTransaction.description}
              onChange={(e) => setEditedTransaction(prev => ({ 
                ...prev, 
                description: e.target.value 
              }))}
              style={{
                width: '100%',
                padding: 10,
                background: 'var(--panel-2)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                color: 'var(--text)',
                fontSize: 14,
                fontFamily: 'var(--font-ui)'
              }}
            />
          </div>

          <div>
            <label style={{ 
              display: 'block',
              fontSize: 12,
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.05em',
              marginBottom: 6
            }}>
              CATEGORY
            </label>
            <select
              value={editedTransaction.category || ''}
              onChange={(e) => setEditedTransaction(prev => ({ 
                ...prev, 
                category: e.target.value || undefined 
              }))}
              style={{
                width: '100%',
                padding: 10,
                background: 'var(--panel-2)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                color: 'var(--text)',
                fontSize: 14,
                fontFamily: 'var(--font-ui)'
              }}
            >
              <option value="">Select Category...</option>
              {categories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ 
              display: 'block',
              fontSize: 12,
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.05em',
              marginBottom: 6
            }}>
              VENDOR
            </label>
            <input
              type="text"
              value={editedTransaction.vendor || ''}
              onChange={(e) => setEditedTransaction(prev => ({ 
                ...prev, 
                vendor: e.target.value || undefined 
              }))}
              style={{
                width: '100%',
                padding: 10,
                background: 'var(--panel-2)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                color: 'var(--text)',
                fontSize: 14,
                fontFamily: 'var(--font-ui)'
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ 
                display: 'block',
                fontSize: 12,
                color: 'var(--text-dim)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em',
                marginBottom: 6
              }}>
                DATE
              </label>
              <input
                type="date"
                value={editedTransaction.date.toISOString().split('T')[0]}
                onChange={(e) => setEditedTransaction(prev => ({ 
                  ...prev, 
                  date: new Date(e.target.value) 
                }))}
                style={{
                  width: '100%',
                  padding: 10,
                  background: 'var(--panel-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  color: 'var(--text)',
                  fontSize: 14,
                  fontFamily: 'var(--font-mono)'
                }}
              />
            </div>

            <div>
              <label style={{ 
                display: 'block',
                fontSize: 12,
                color: 'var(--text-dim)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em',
                marginBottom: 6
              }}>
                AMOUNT
              </label>
              <input
                type="number"
                step="0.01"
                value={editedTransaction.amount}
                onChange={(e) => setEditedTransaction(prev => ({ 
                  ...prev, 
                  amount: parseFloat(e.target.value) || 0 
                }))}
                style={{
                  width: '100%',
                  padding: 10,
                  background: 'var(--panel-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  color: 'var(--text)',
                  fontSize: 14,
                  fontFamily: 'var(--font-mono)'
                }}
              />
            </div>
          </div>

          <div style={{ 
            display: 'flex', 
            gap: 12, 
            justifyContent: 'flex-end',
            marginTop: 8 
          }}>
            <button
              type="button"
              onClick={onCancel}
              className="btn"
              style={{ padding: '10px 20px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '10px 20px' }}
            >
              Save Changes
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}