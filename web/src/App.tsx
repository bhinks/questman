import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Transaction, SpendingAnalysis } from './types';
import { analyzeSpending } from './utils/analyzer';
import { categorizeTransactions } from './utils/categorizer';
import { api } from './lib/api';
import type { ApiTransaction, TransactionListResponse, ImportPreviewResponse, ImportResultResponse, PlayerResponse } from './lib/api';
import { AppShell } from './components/AppShell';
import { OverviewCards } from './components/OverviewCards';
import { PeriodFramingProvider, PeriodBar } from './components/PeriodFraming';
import { SavingsMissions } from './components/SavingsMissions';
import { CategoryChart } from './components/CategoryChart';
import { SpendingChart } from './components/SpendingChart';
import { TransactionEditor } from './components/TransactionEditor';
import { Icon } from './components/Icon';
import { LoginScreen } from './components/LoginScreen';
import { TodayView } from './components/TodayView';
import { HabitsView } from './components/HabitsView';
import { StreetCredView } from './components/StreetCredView';
import { OperationsView } from './components/OperationsView';
import { MediaView } from './components/MediaView';
import { HealthView } from './components/HealthView';
import { NpcsView } from './components/NpcsView';
import { ShopView } from './components/ShopView';
import { BossesView } from './components/BossesView';
import { HandlerView } from './components/HandlerView';
import { BudgetsView } from './components/BudgetsView';
import { BillsView } from './components/BillsView';
import { TransactionsView } from './components/TransactionsView';
import { CalibrationView } from './components/CalibrationView';
import { FocusView } from './components/FocusView';
import type { FocusSeed } from './components/FocusView';
import { LevelUpOverlay } from './components/LevelUpOverlay';
import type { SettingsResponse } from './lib/api';
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
    categoryId: t.categoryId ?? t.category?.id ?? undefined,
    vendor: t.vendor?.name ?? undefined,
    isWasteful: t.isWasteful,
    notes: t.notes ?? undefined,
    excluded: t.excluded ?? false,
    projectId: t.projectId ?? undefined,
    choreId: t.choreId ?? undefined,
    projectName: t.project?.name ?? undefined,
    choreName: t.chore?.title ?? undefined,
    account: t.account ?? undefined,
  };
}

function HubApp() {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState('today');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Finance drill: clicking a month in the burn chart filters the log below.
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  // FOCUS CHAMBER (JACK IN): when open, FocusView replaces the whole shell
  // (distraction-free). A run left active in localStorage (reload mid-run)
  // re-opens the chamber on mount; FocusView resumes the clock from it.
  const [focusOpen, setFocusOpen] = useState(() => localStorage.getItem('qm-focus-active') != null);
  const [focusSeed, setFocusSeed] = useState<FocusSeed | null>(null);
  const openFocus = (seed: FocusSeed | null = null) => {
    setFocusSeed(seed);
    setFocusOpen(true);
  };

  // Player snapshot (shared via react-query cache with TodayView/Shop/etc.).
  // We read it here only to apply the equipped cosmetic theme to the whole
  // app: setting data-theme on <html> swaps the neon palette in index.css.
  const playerQuery = useQuery({
    queryKey: ['player'],
    queryFn: () => api.get<PlayerResponse>('/api/player').then(r => r.player),
  });
  const equippedTheme = playerQuery.data?.equippedTheme ?? null;
  // OS shell (Night Market v2): a deep interface rewire applied as
  // <html data-shell>. Shells LOCK the palette (index.css puts their var
  // blocks after every [data-theme]), so the equipped skin is ignored
  // while a non-default shell is booted — per the design handoff.
  const equippedShell = playerQuery.data?.equippedShell ?? null;
  const energyTier = playerQuery.data?.energy?.tier ?? null;
  const themeInitRef = useRef(false);
  useEffect(() => {
    const el = document.documentElement;
    if (equippedTheme) el.dataset.theme = equippedTheme;
    else delete el.dataset.theme;
    if (equippedShell) el.dataset.shell = equippedShell;
    else delete el.dataset.shell;
    // Theme/shell-equip pulse (design handoff): a ~450ms global color
    // transition so the reskin sweeps rather than snaps. Skipped on mount.
    if (themeInitRef.current) {
      el.classList.add('theming');
      const t = setTimeout(() => el.classList.remove('theming'), 450);
      return () => { clearTimeout(t); el.classList.remove('theming'); };
    }
    themeInitRef.current = true;
  }, [equippedTheme, equippedShell]);
  useEffect(() => {
    const el = document.documentElement;
    // World mechanics: a low battery visibly dims the UI (index.css).
    if (energyTier) el.dataset.energy = energyTier;
    else delete el.dataset.energy;
  }, [energyTier]);

  // Night Market display-font pack applies as a data attribute (index.css
  // ships a [data-font] block per pack). Visual FX are no longer a data-fx
  // attribute: the v2 system is STACKABLE component overlays rendered by
  // AppShell (FxOverlays.tsx) from PlayerSnapshot.fxActive.
  const equippedFont = playerQuery.data?.equippedFont ?? null;
  useEffect(() => {
    const el = document.documentElement;
    if (equippedFont) el.dataset.font = equippedFont;
    else delete el.dataset.font;
    // One-time cleanup: drop any stale data-fx left by the legacy system.
    delete el.dataset.fx;
  }, [equippedFont]);

  // Night City display calibration: apply the per-user CRT knobs as CSS vars
  // on the root. CRT % fans out to the scanline/sweep alphas (handoff formula).
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/api/settings').then(r => r.settings),
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    const el = document.documentElement;
    el.style.setProperty('--cut', `${s.displayCut}px`);
    el.style.setProperty('--cut-sm', `${Math.round(s.displayCut * 0.56)}px`);
    el.style.setProperty('--chroma', `${s.displayChroma}px`);
    el.style.setProperty('--scan-a', String((s.displayCrt / 100) * 0.035));
    el.style.setProperty('--sweep-a', String((s.displayCrt / 100) * 0.14));
  }, [settingsQuery.data]);

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
        // Finance depth: these now persist (manual re-categorize, exclude, links).
        categoryId: t.categoryId ?? null,
        excluded: t.excluded ?? false,
        projectId: t.projectId ?? null,
        choreId: t.choreId ?? null,
        account: t.account?.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      // A category/exclude/link change shifts budget math too.
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['budgets', 'history'] });
    },
    onError: (err: any) => setErrors([err?.message ?? 'Save failed']),
  });

  const categorizedTransactions = useMemo(() =>
    categorizeTransactions(transactions),
    [transactions]
  );

  // Finance depth: excluded rows (transfers) drop out of the charts.
  // analyzeSpending already filters them internally; chartData reads the
  // transaction list directly, so filter them out here too. (The transaction
  // log below keeps the FULL list — it greys excluded rows in place.)
  const includedTransactions = useMemo(
    () => categorizedTransactions.filter(t => !t.excluded),
    [categorizedTransactions],
  );

  const analysis: SpendingAnalysis = useMemo(() => 
    analyzeSpending(categorizedTransactions), 
    [categorizedTransactions]
  );

  // Prepare chart data (excluded transactions already filtered out)
  const chartData = useMemo(() => {
    const expenses = includedTransactions.filter(t => t.amount < 0);
    const income = includedTransactions.filter(t => t.amount > 0);

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
    
    return result;
  }, [includedTransactions]);

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
        return <TodayView onJackIn={openFocus} />;

      case 'habits':
        return <HabitsView />;

      case 'health':
        return <HealthView />;

      case 'operations':
        return <OperationsView />;

      case 'media':
        return <MediaView onJackIn={openFocus} />;

      case 'social':
        return <NpcsView />;

      case 'progress':
        return <StreetCredView />;

      case 'shop':
        return <ShopView />;

      case 'bosses':
        return <BossesView />;

      case 'handler':
        return <HandlerView />;

      case 'budgets':
        return <BudgetsView />;

      case 'bills':
        return <BillsView />;

      // --- Existing finance tabs (still local-CSV mode for now) ---
      // Finance is now the unified vault page: overview + burn chart + the full
      // category breakdown + the transaction log, all cross-filtered. Clicking a
      // month (burn chart) or a category drills the log below; a text search
      // narrows it further. (Categories + Transactions are no longer separate.)
      case 'overview':
        return (
          <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <PeriodBar period={analysis.period} />
            <OverviewCards analysis={analysis} />

            {/* Monthly burn — click a month to filter the log below */}
            {chartData.monthly.length > 0 && (
              <SpendingChart
                monthlyData={chartData.monthly}
                dailyData={chartData.daily}
                selectedMonth={selectedMonth}
                onSelectMonth={setSelectedMonth}
              />
            )}

            {/* Full category breakdown — click a category to filter the log */}
            {analysis.topCategories.length > 0 && (
              <CategoryChart
                categories={analysis.topCategories}
                onCategoryClick={cat => setSelectedCategory(prev => (prev === cat ? null : cat))}
                selectedCategory={selectedCategory}
                showAll
                period={analysis.period}
              />
            )}

            {/* The transaction log, cross-filtered by the selections above + text */}
            <TransactionsView
              transactions={categorizedTransactions}
              onEdit={handleEditTransaction}
              monthFilter={selectedMonth}
              categoryFilter={selectedCategory}
              onClearMonth={() => setSelectedMonth(null)}
              onClearCategory={() => setSelectedCategory(null)}
            />
          </div>
        );

      case 'savings':
        return (
          <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <PeriodBar period={analysis.period} />
            <SavingsMissions analysis={analysis} />
          </div>
        );
      
      case 'calibration':
        return <CalibrationView />;

      default:
        return null;
    }
  };

  // Distraction-free deep work: the chamber replaces the entire shell.
  if (focusOpen) {
    return (
      <FocusView
        seed={focusSeed}
        onExit={() => { setFocusOpen(false); setFocusSeed(null); }}
      />
    );
  }

  return (
    <PeriodFramingProvider>
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onUpload={handleUpload}
      onJackIn={() => openFocus(null)}
    >
      {/* Hidden file input driven by the topbar upload button. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFileSelected}
        style={{ display: 'none' }}
      />

      {/* Keyed by screen so the entrance stagger re-runs on every nav. */}
      <div key={activeTab} className="qm-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {renderTabContent()}
      </div>

      <LevelUpOverlay />

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
    </PeriodFramingProvider>
  );
}

export default App;
