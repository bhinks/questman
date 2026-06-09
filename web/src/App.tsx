import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Transaction, SpendingAnalysis } from './types';
import { analyzeSpending } from './utils/analyzer';
import { categorizeTransactions } from './utils/categorizer';
import { api } from './lib/api';
import type { ApiTransaction, TransactionListResponse, ImportPreviewResponse, ImportResultResponse } from './lib/api';
import { AppShell } from './components/AppShell';
import { OverviewCards } from './components/OverviewCards';
import { SavingsMissions } from './components/SavingsMissions';
import { CategoryChart } from './components/CategoryChart';
import { CategoryTransactions } from './components/CategoryTransactions';
import { SpendingChart } from './components/SpendingChart';
import { TransactionEditor } from './components/TransactionEditor';
import { Icon } from './components/Icon';
import { LoginScreen } from './components/LoginScreen';
import { TodayView } from './components/TodayView';
import { RecurringList } from './components/RecurringList';
import { WorkoutLogger } from './components/WorkoutLogger';
import { useAuth } from './context/AuthContext';

function App() {
  const { isAuthed, loading } = useAuth();

  // Brief splash while we probe /me on mount. Tiny and themed.
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-faint)', letterSpacing: '0.1em' }}>
          BOOTING<span className="cursor-blink">_</span>
        </div>
      </div>
    );
  }
  if (!isAuthed) return <LoginScreen />;

  return <HubApp />;
}

/** Map a persisted (API) transaction to the local presentational shape. */
function mapApiTransaction(t: ApiTransaction): Transaction {
  return {
    id: t.id,
    date: new Date(t.date),
    description: t.description,
    amount: t.amount,
    category: t.category?.name ?? undefined,
    vendor: t.vendor?.name ?? undefined,
    isWasteful: t.isWasteful,
    notes: t.notes ?? undefined,
  };
}

function HubApp() {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState('today');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  // Transactions now live in the DB. Pull the full set (single-user hub;
  // a high limit is fine) and map to the presentational shape the finance
  // views already consume.
  const txQuery = useQuery({
    queryKey: ['transactions'],
    queryFn: () =>
      api.get<TransactionListResponse>('/api/transactions?limit=5000&sortBy=date&sortOrder=desc')
        .then(r => r.transactions.map(mapApiTransaction)),
  });
  const transactions = txQuery.data ?? [];

  // Two-step import: preview to auto-detect the column mapping, then
  // upload with that mapping. The backend persists + de-dupes.
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const preview = await api.upload<ImportPreviewResponse>('/api/import/preview', { file });
      return api.upload<ImportResultResponse>('/api/import/upload', {
        file,
        columnMapping: JSON.stringify(preview.suggestedMapping),
        options: JSON.stringify({ skipDuplicates: true, autoCategorize: true }),
      });
    },
    onSuccess: (res) => {
      const r = res.result;
      setErrors([]);
      setImportStatus(
        `Imported ${r.imported} of ${r.totalProcessed}` +
        (r.duplicatesSkipped ? ` · ${r.duplicatesSkipped} duplicate(s) skipped` : '') +
        (r.errors ? ` · ${r.errors} error(s)` : ''),
      );
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setActiveTab('overview');
    },
    onError: (err: any) => {
      setImportStatus(null);
      setErrors([err?.message ?? 'Import failed']);
    },
  });

  // Persist scalar edits (description/amount/date/notes/wasteful).
  // Category/vendor are relations the editor edits by name; remapping
  // those to ids is a follow-up, so we don't push them here.
  const editMutation = useMutation({
    mutationFn: (t: Transaction) =>
      api.put(`/api/transactions/${t.id}`, {
        description: t.description,
        amount: t.amount,
        date: t.date.toISOString(),
        notes: t.notes ?? null,
        isWasteful: t.isWasteful ?? false,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
    onError: (err: any) => setErrors([err?.message ?? 'Save failed']),
  });

  const categorizedTransactions = useMemo(() =>
    categorizeTransactions(transactions),
    [transactions]
  );

  const analysis: SpendingAnalysis = useMemo(() => 
    analyzeSpending(categorizedTransactions), 
    [categorizedTransactions]
  );

  // Prepare chart data
  const chartData = useMemo(() => {
    console.log('Preparing chart data for', categorizedTransactions.length, 'transactions');
    
    const expenses = categorizedTransactions.filter(t => t.amount < 0);
    const income = categorizedTransactions.filter(t => t.amount > 0);
    
    console.log('Filtered:', { expenses: expenses.length, income: income.length });
    
    // Monthly data
    const monthlyData = expenses.reduce((acc, transaction) => {
      const month = transaction.date.toISOString().substring(0, 7); // YYYY-MM
      if (!acc[month]) {
        acc[month] = { month, spending: 0, income: 0, net: 0 };
      }
      acc[month].spending += Math.abs(transaction.amount);
      return acc;
    }, {} as Record<string, any>);
    
    income.forEach(transaction => {
      const month = transaction.date.toISOString().substring(0, 7);
      if (!monthlyData[month]) {
        monthlyData[month] = { month, spending: 0, income: 0, net: 0 };
      }
      monthlyData[month].income += transaction.amount;
    });
    
    Object.values(monthlyData).forEach((month: any) => {
      month.net = month.income - month.spending;
    });
    
    // Daily data for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const dailyData = expenses
      .filter(t => t.date >= thirtyDaysAgo)
      .reduce((acc, transaction) => {
        const date = transaction.date.toISOString().substring(0, 10); // YYYY-MM-DD
        if (!acc[date]) {
          acc[date] = { date, amount: 0 };
        }
        acc[date].amount += Math.abs(transaction.amount);
        return acc;
      }, {} as Record<string, any>);
    
    const result = {
      monthly: Object.values(monthlyData).sort((a: any, b: any) => a.month.localeCompare(b.month)),
      daily: Object.values(dailyData).sort((a: any, b: any) => a.date.localeCompare(b.date))
    };
    
    console.log('Chart data prepared:', result);
    return result;
  }, [categorizedTransactions]);

  // Topbar upload button → open the OS file picker. The hidden input's
  // onChange kicks off the import mutation.
  const handleUpload = () => {
    setImportStatus(null);
    setErrors([]);
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportStatus('Importing…');
      importMutation.mutate(file);
    }
    e.target.value = ''; // allow re-selecting the same file
  };

  const handleEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction);
  };

  const handleSaveTransaction = (updatedTransaction: Transaction) => {
    editMutation.mutate(updatedTransaction);
    setEditingTransaction(null);
  };

  const handleCancelEdit = () => {
    setEditingTransaction(null);
  };

  // Get available categories for the editor
  const availableCategories = useMemo(() => {
    const categories = new Set(
      categorizedTransactions
        .map(t => t.category)
        .filter((category): category is string => Boolean(category))
    );
    return Array.from(categories).sort();
  }, [categorizedTransactions]);

  // (The old "no transactions → FileUpload" gate is gone. FileUpload
  // now lives behind the upload button in the topbar / a future
  // Finance → Import view. The hub lands on the Today tab.)

  const renderTabContent = () => {
    switch (activeTab) {
      // --- Life-hub tabs ---
      case 'today':
        return <TodayView />;

      case 'habits':
        return <RecurringList kind="habit" />;

      case 'chores':
        return <RecurringList kind="chore" />;

      case 'workouts':
        return <WorkoutLogger />;

      // --- Existing finance tabs (still local-CSV mode for now) ---
      case 'overview':
        return (
          <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <OverviewCards analysis={analysis} />
            
            {/* Spending trends chart */}
            {chartData.monthly.length > 0 && (
              <SpendingChart 
                monthlyData={chartData.monthly}
                dailyData={chartData.daily}
              />
            )}
            
            {/* Category breakdown chart */}
            {analysis.topCategories.length > 0 && (
              <CategoryChart
                categories={analysis.topCategories}
                onCategoryClick={setSelectedCategory}
                selectedCategory={selectedCategory}
                showAll={false}
              />
            )}

            {/* Drill-down: transactions for the clicked category */}
            {selectedCategory && (
              <CategoryTransactions
                category={selectedCategory}
                transactions={categorizedTransactions}
                onClose={() => setSelectedCategory(null)}
              />
            )}
          </div>
        );

      case 'categories':
        return (
          <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {analysis.topCategories.length > 0 ? (
              <CategoryChart
                categories={analysis.topCategories}
                onCategoryClick={setSelectedCategory}
                selectedCategory={selectedCategory}
                showAll={true}
              />
            ) : (
              <div className="panel hud" style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>
                <div className="mono" style={{ fontSize: 13 }}>NO CATEGORY DATA AVAILABLE</div>
              </div>
            )}

            {/* Drill-down: transactions for the clicked category */}
            {selectedCategory && (
              <CategoryTransactions
                category={selectedCategory}
                transactions={categorizedTransactions}
                onClose={() => setSelectedCategory(null)}
              />
            )}
          </div>
        );

      case 'savings':
        return (
          <div className="fade-up">
            <SavingsMissions analysis={analysis} />
          </div>
        );
      
      case 'transactions':
        return (
          <div className="fade-up">
            <div className="panel hud" style={{ padding: 24 }}>
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
                    background: 'linear-gradient(135deg, var(--lime), var(--cyan))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <span style={{ color: 'white', fontSize: 16, fontWeight: 600 }}>📊</span>
                </div>
                <h3 style={{
                  fontSize: 18, 
                  fontWeight: 600, 
                  margin: 0,
                  color: 'var(--text)',
                  fontFamily: 'var(--font-display)'
                }}>
                  Transaction Log
                </h3>
                <div 
                  className="mono"
                  style={{ 
                    marginLeft: 'auto',
                    fontSize: 11,
                    color: 'var(--text-dim)',
                    padding: '4px 8px',
                    background: 'var(--panel-2)',
                    borderRadius: 6,
                    border: '1px solid var(--line)'
                  }}
                >
                  {categorizedTransactions.length} RECORDS
                </div>
              </div>
              
              {categorizedTransactions.length > 0 ? (
                <div style={{ 
                  maxHeight: 400, 
                  overflow: 'auto',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r)'
                }}>
                  <div style={{ 
                    display: 'grid',
                    gridTemplateColumns: '1fr 2fr 1fr 1fr 40px',
                    gap: 12,
                    padding: 12,
                    background: 'var(--panel-2)',
                    borderBottom: '1px solid var(--line)',
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-dim)',
                    fontWeight: 600,
                    letterSpacing: '0.05em'
                  }}>
                    <div>DATE</div>
                    <div>DESCRIPTION</div>
                    <div>CATEGORY</div>
                    <div style={{ textAlign: 'right' }}>AMOUNT</div>
                    <div></div>
                  </div>
                  {categorizedTransactions.slice(0, 50).map((transaction, index) => (
                    <div 
                      key={transaction.id || index}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 2fr 1fr 1fr 40px',
                        gap: 12,
                        padding: 12,
                        borderBottom: index < 49 ? '1px solid var(--line)' : 'none',
                        fontSize: 13,
                        color: 'var(--text)',
                        transition: 'background 0.15s ease',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => {
                        (e.target as HTMLElement).style.background = 'var(--panel-2)';
                      }}
                      onMouseLeave={(e) => {
                        (e.target as HTMLElement).style.background = 'transparent';
                      }}
                    >
                      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        {transaction.date.toLocaleDateString()}
                      </div>
                      <div style={{ 
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {transaction.description}
                      </div>
                      <div style={{ 
                        fontSize: 11,
                        color: 'var(--text-faint)',
                        fontFamily: 'var(--font-mono)'
                      }}>
                        {transaction.category || 'Other'}
                      </div>
                      <div 
                        className="mono"
                        style={{ 
                          textAlign: 'right',
                          fontWeight: 600,
                          color: transaction.amount >= 0 ? 'var(--lime)' : 'var(--text)'
                        }}
                      >
                        {transaction.amount >= 0 ? '+' : ''}${Math.abs(transaction.amount).toLocaleString()}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditTransaction(transaction);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-dim)',
                          cursor: 'pointer',
                          padding: 4,
                          borderRadius: 4,
                          transition: 'color 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          (e.target as HTMLElement).style.color = 'var(--cyan)';
                        }}
                        onMouseLeave={(e) => {
                          (e.target as HTMLElement).style.color = 'var(--text-dim)';
                        }}
                      >
                        <Icon name="edit" size={14} />
                      </button>
                    </div>
                  ))}
                  {categorizedTransactions.length > 50 && (
                    <div style={{
                      padding: 16,
                      textAlign: 'center',
                      color: 'var(--text-faint)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      borderTop: '1px solid var(--line)',
                      background: 'var(--panel-2)'
                    }}>
                      SHOWING FIRST 50 OF {categorizedTransactions.length} TRANSACTIONS
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ 
                  padding: 40, 
                  textAlign: 'center', 
                  color: 'var(--text-faint)' 
                }}>
                  <div className="mono" style={{ fontSize: 13 }}>NO TRANSACTIONS LOADED</div>
                </div>
              )}
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <AppShell
      analysis={analysis}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onUpload={handleUpload}
    >
      {/* Hidden file input driven by the topbar upload button. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFileSelected}
        style={{ display: 'none' }}
      />

      {renderTabContent()}

      {/* Import status toast (success / in-flight). */}
      {importStatus && errors.length === 0 && (
        <div
          style={{
            position: 'fixed', bottom: 16, right: 16, maxWidth: 320, padding: 16,
            background: 'var(--panel)', border: '1px solid var(--cyan)',
            borderRadius: 'var(--r)', color: 'var(--text)', fontSize: 13, zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <Icon name="upload" size={14} style={{ color: 'var(--cyan)' }} />
          <span>{importMutation.isPending ? 'Importing…' : importStatus}</span>
          {!importMutation.isPending && (
            <button
              onClick={() => setImportStatus(null)}
              className="btn btn-ghost"
              style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: 11 }}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      {/* Errors Display */}
      {errors.length > 0 && (
        <div 
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            maxWidth: 320,
            padding: 16,
            background: 'var(--panel)',
            border: '1px solid var(--amber)',
            borderRadius: 'var(--r)',
            color: 'var(--text)',
            fontSize: 13,
            zIndex: 1000
          }}
        >
          <div style={{ 
            fontWeight: 600, 
            color: 'var(--amber)', 
            marginBottom: 8,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.05em'
          }}>
            DATA IMPORT WARNINGS
          </div>
          <div style={{ color: 'var(--text-dim)', lineHeight: 1.4 }}>
            {errors.slice(0, 3).map((error, index) => (
              <div key={index}>• {error}</div>
            ))}
            {errors.length > 3 && (
              <div>... and {errors.length - 3} more issues</div>
            )}
          </div>
        </div>
      )}

      {/* Transaction Editor Modal */}
      {editingTransaction && (
        <TransactionEditor
          transaction={editingTransaction}
          onSave={handleSaveTransaction}
          onCancel={handleCancelEdit}
          categories={availableCategories}
        />
      )}
    </AppShell>
  );
}

export default App;
